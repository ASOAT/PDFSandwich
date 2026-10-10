"""Verified, resumable model downloads with bounded parallel range requests."""
import hashlib
import os
from pathlib import Path
import re
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BLOCK = 8 * 1024 * 1024


def download(url, target, digest, progress=lambda _:None):
    target=Path(target);target.parent.mkdir(parents=True,exist_ok=True)
    verified=target.with_suffix(target.suffix+'.verified')
    def valid(file):
        with file.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()==digest
    if target.is_file():
        if (verified.is_file() and verified.read_text()==digest) or valid(target):
            verified.write_text(digest);return
    partial=target.with_suffix(target.suffix+'.download')
    if partial.is_file() and valid(partial):
        os.replace(partial,target);verified.write_text(digest);return
    parts=target.with_suffix(target.suffix+'.parts-'+digest[:12])
    lock=threading.Lock();last=[0]
    def notify(count,total):
        with lock:
            now=time.monotonic()
            if now-last[0]>1:
                progress(f'下载资源 {count//1048576} / {total//1048576} MB（支持续传）');last[0]=now
    def request(start,end):
        return urllib.request.urlopen(urllib.request.Request(url,headers={
            'Range':f'bytes={start}-{end}','Accept-Encoding':'identity'}),timeout=60)
    with request(0,0) as response:
        match=re.fullmatch(r'bytes 0-0/(\d+)',response.headers.get('Content-Range',''))
        ranged=response.status==206 and match is not None
        total=int(match[1]) if ranged else int(response.headers.get('Content-Length',0))
    # Old sequential partials remain usable. New range-capable downloads use
    # four independent blocks, so interrupted connections redo at most 8 MiB.
    if ranged and total>BLOCK and not (partial.exists() and not parts.exists()):
        parts.mkdir(exist_ok=True)
        indices=list(range((total+BLOCK-1)//BLOCK))
        completed=[0]
        def block(index):
            start=index*BLOCK;end=min(total,start+BLOCK)-1
            done=parts/f'{index}.ok';work=parts/f'{index}.part'
            if not done.exists() or done.stat().st_size!=end-start+1:
                for attempt in range(3):
                    try:
                        with request(start,end) as response:
                            if response.status!=206 or response.headers.get('Content-Range')!=f'bytes {start}-{end}/{total}':
                                raise ValueError('下载服务器返回了不匹配的分段，请稍后重试。')
                            with work.open('wb') as stream:
                                remaining=end-start+1
                                while remaining:
                                    chunk=response.read(min(1024*1024,remaining))
                                    if not chunk:raise OSError('下载连接提前结束')
                                    stream.write(chunk);remaining-=len(chunk)
                        os.replace(work,done);break
                    except OSError:
                        if attempt==2:raise
                        time.sleep(.25*(attempt+1))
            with lock:
                completed[0]+=end-start+1;count=completed[0]
            notify(count,total)
        with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(block,indices))
        with partial.open('wb') as stream:
            for index in indices:
                with (parts/f'{index}.ok').open('rb') as source:
                    while chunk:=source.read(1024*1024):stream.write(chunk)
    else:
        offset=partial.stat().st_size if ranged and partial.exists() else 0
        for attempt in range(3):
            try:
                with request(offset,max(offset,total-1)) as response:
                    if offset and (response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {offset}-')):
                        raise ValueError('下载服务器不支持续传，请稍后重试。')
                    with partial.open('ab' if offset else 'wb') as stream:
                        while chunk:=response.read(1024*1024):
                            stream.write(chunk);offset+=len(chunk);notify(offset,total or offset)
                if total and offset!=total:raise OSError('下载连接提前结束')
                break
            except OSError:
                if attempt==2:raise
                offset=partial.stat().st_size if ranged and partial.exists() else 0
    ok=valid(partial)
    # Only remove this download's known blocks, never unrelated model files.
    if parts.exists():
        for item in parts.iterdir():
            if re.fullmatch(r'\d+\.(?:ok|part)',item.name):item.unlink()
        if not any(parts.iterdir()):parts.rmdir()
    if not ok:
        partial.unlink(missing_ok=True)
        raise ValueError('模型下载校验失败，请重试。')
    os.replace(partial,target);verified.write_text(digest)
