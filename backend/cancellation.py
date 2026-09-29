"""Cooperative page cancellation keeps the expensive model process alive."""
from pathlib import Path
import threading


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
