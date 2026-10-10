"""Cooperative page cancellation keeps the expensive model process alive."""
from pathlib import Path
import threading
import queue
import urllib.request
import socket


class PageCancelled(Exception):
    pass


class PageControl:
    def __init__(self, request):
        self.file = Path(request['cancelFile']) if request.get('cancelFile') else None
        self.finished = threading.Event()
        self.thread = None

    def cancelled(self):
        return bool(self.file and self.file.exists())

    def check(self):
        if self.cancelled():
            raise PageCancelled('已让出后台任务，优先翻译当前页。')

    def watch(self, config):
        def monitor():
            while not self.finished.wait(.05):
                if self.cancelled():
                    # The progress monitor is attached after async_translate starts.
                    if config.progress_monitor is not None:
                        config.cancel_translation()
                        return
        self.thread = threading.Thread(target=monitor, daemon=True)
        self.thread.start()

    def close(self):
        self.finished.set()
        if self.thread:
            self.thread.join(timeout=1)


def stream_lines(request, control=None, timeout=120):
    """Own blocking HTTP reads in a bounded daemon; cancellation never waits for
    a Windows buffered socket read or HTTPResponse.close to finish.
    """
    messages=queue.Queue(maxsize=16);stopped=threading.Event();connection=[]
    def offer(value):
        while not stopped.is_set():
            try:messages.put(value,timeout=.05);return
            except queue.Full:pass
    def read():
        try:
            with urllib.request.urlopen(request,timeout=timeout) as response:
                connection.append(response.fp.raw._sock)
                if stopped.is_set():return
                for line in response:
                    if stopped.is_set():return
                    offer(('line',line))
        except Exception as error:offer(('error',error))
        finally:offer(('done',None))
    reader=threading.Thread(target=read,daemon=True);reader.start()
    try:
        while True:
            if control:control.check()
            try:kind,value=messages.get(timeout=.05)
            except queue.Empty:continue
            if kind=='done':return
            if kind=='error':raise value
            yield value
    finally:
        stopped.set()
        # Disconnect the local generation so llama.cpp can release its slot.
        # The reader owns response.close; never join its potentially blocked read.
        for sock in connection:
            try:sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
