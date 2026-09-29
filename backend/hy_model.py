"""Pinned official HY-MT model with a loopback-only llama.cpp Vulkan runtime."""
import atexit
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import urllib.error
import urllib.request
import zipfile
from translation_quality import translation_prompt, translation_problem

MODEL_FILE='HY-MT1.5-1.8B-Q4_K_M.gguf'
MODEL_URL='https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/265b2e615a7dc9b06c435dc878829ad99a512ba2/'+MODEL_FILE
MODEL_SHA='4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7'
RUNTIME_URL='https://github.com/ggml-org/llama.cpp/releases/download/b11243/llama-b11243-bin-win-vulkan-x64.zip'
RUNTIME_SHA='147f88e011cb04cbaea45917b6f5f639b76c53d3b15e3e077d1458963af61b25'
MODEL_VERSION='hy-mt1.5-1.8b-q4-v1'

def download(url, target, digest, progress):
    target=Path(target)
    verified=target.with_suffix(target.suffix+'.verified')
    if target.exists() and verified.exists() and verified.read_text() == digest:
        return
    target.parent.mkdir(parents=True,exist_ok=True)
    partial=target.with_suffix(target.suffix+'.download')
    offset=partial.stat().st_size if partial.exists() else 0
    if offset:
        with partial.open('rb') as stream:complete=hashlib.file_digest(stream,'sha256').hexdigest()==digest
        if complete:
            os.replace(partial,target);verified.write_text(digest);return
    size=None;last=0;failures=0
    while size is None or offset<size:
        request=urllib.request.Request(url,headers={'Range':f'bytes={offset}-{offset+32*1024*1024-1}'})
        try:
            with urllib.request.urlopen(request,timeout=90) as response:
                content_range=response.headers.get('Content-Range','')
                if offset and (response.status!=206 or not content_range.startswith(f'bytes {offset}-')):
                    raise ValueError('下载服务器不支持续传，请稍后重试。')
                size=int(content_range.rsplit('/',1)[1]) if content_range else int(response.headers.get('Content-Length',0))
                if not size:raise ValueError('下载服务器未返回文件大小。')
                remaining=min(size-offset,32*1024*1024);received=0
                with partial.open('ab' if offset else 'wb') as stream:
                    while received<remaining:
                        chunk=response.read(min(1024*1024,remaining-received))
                        if not chunk:raise OSError('下载连接提前结束')
                        stream.write(chunk);offset+=len(chunk);received+=len(chunk)
                        if time.monotonic()-last>2:
                            progress(f'下载本地高质量模型/运行时 {offset//1048576} / {size//1048576} MB（仅首次需要）');last=time.monotonic()
                failures=0
        except OSError:
            failures+=1
            if failures>=3:raise
            offset=partial.stat().st_size if partial.exists() else 0
            time.sleep(1)
    with partial.open('rb') as stream: actual=hashlib.file_digest(stream,'sha256').hexdigest()
    if actual!=digest:
        partial.unlink(missing_ok=True);raise ValueError('模型下载校验失败，请重试。')
    os.replace(partial,target);target.with_suffix(target.suffix+'.verified').write_text(digest)

def prepare(directory,progress):
    root=Path(directory)/MODEL_VERSION
    download(MODEL_URL,root/MODEL_FILE,MODEL_SHA,progress)
    archive=root/'llama-b11243-vulkan.zip'
    download(RUNTIME_URL,archive,RUNTIME_SHA,progress)
    runtime=root/'runtime'
    if not (runtime/'llama-server.exe').is_file():
        runtime.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as package:
            for item in package.infolist():
                if not (runtime/item.filename).resolve().is_relative_to(runtime.resolve()):
                    raise ValueError('运行时压缩包路径无效。')
            package.extractall(runtime)
    return root,runtime/'llama-server.exe'

class HyModel:
    def __init__(self,directory,progress=lambda message:None):
        self.root,exe=prepare(directory,progress)
        self.key=secrets.token_hex(24)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        self.url=f'http://127.0.0.1:{port}'
        progress('正在加载高质量翻译模型并启用显卡加速…')
        self.log=(self.root/'runtime.log').open('w',encoding='utf-8')
        self.child=subprocess.Popen([str(exe),'-m',str(self.root/MODEL_FILE),'--host','127.0.0.1','--port',str(port),
            '-ngl','99','-c','4096','--parallel','1','--threads','6','--api-key',self.key,'--no-webui'],
            stdout=self.log,stderr=self.log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        atexit.register(self.close)
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            if self.child.poll() is not None: raise RuntimeError('本地高质量引擎启动失败，请检查显卡驱动；可切换轻量引擎。')
            try:
                with urllib.request.urlopen(self.url+'/health',timeout=2) as response:
                    if response.status==200:break
            except (OSError,urllib.error.URLError): time.sleep(.3)
        else:
            self.close();raise RuntimeError('本地模型加载超时。')
        self.records=[]

    def close(self):
        if self.child.poll() is None:
            self.child.terminate()
            try:self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:self.child.kill()
        self.log.close()

    def translate(self,text,custom='',use_builtin=True):
        payload={'model':'local','messages':[{'role':'user','content':translation_prompt(text,custom,use_builtin)}],
            'temperature':.2,'top_p':.6,'top_k':20,'repeat_penalty':1.1,'max_tokens':min(1536,max(160,len(text)*2)), 'stream':False}
        request=urllib.request.Request(self.url+'/v1/chat/completions',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+self.key})
        with urllib.request.urlopen(request,timeout=120) as response: result=json.load(response)
        choice=result['choices'][0];output=choice['message']['content'].strip()
        problem=translation_problem(text,output)
        if choice.get('finish_reason')=='length':problem='译文长度超限'
        if problem:raise ValueError(problem)
        return output

    def save_alignment(self,file):
        Path(file).write_text('[]',encoding='utf-8')
