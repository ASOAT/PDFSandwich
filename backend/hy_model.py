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
from cancellation import stream_lines
from translation_quality import translation_prompt, translation_problem
from model_download import download

MODEL_FILE='HY-MT1.5-1.8B-Q4_K_M.gguf'
MODEL_URL='https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/265b2e615a7dc9b06c435dc878829ad99a512ba2/'+MODEL_FILE
MODEL_SHA='4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7'
RUNTIME_URL='https://github.com/ggml-org/llama.cpp/releases/download/b11243/llama-b11243-bin-win-vulkan-x64.zip'
RUNTIME_SHA='147f88e011cb04cbaea45917b6f5f639b76c53d3b15e3e077d1458963af61b25'
MODEL_VERSION='hy-mt1.5-1.8b-q4-v1'

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

    def translate(self,text,custom='',use_builtin=True,context=None,control=None):
        payload={'model':'local','messages':[{'role':'user','content':translation_prompt(text,custom,use_builtin,context)}],
            'temperature':.2,'top_p':.6,'top_k':20,'repeat_penalty':1.1,'max_tokens':min(1536,max(160,len(text)*2)), 'stream':True,'cache_prompt':True}
        request=urllib.request.Request(self.url+'/v1/chat/completions',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+self.key})
        pieces=[];finish=None
        for line in stream_lines(request,control):
            if not line.startswith(b'data:'):continue
            data=line[5:].strip()
            if data==b'[DONE]':break
            event=json.loads(data)
            if not event.get('choices'):continue
            choice=event['choices'][0]
            pieces.append(choice.get('delta',{}).get('content') or '')
            finish=choice.get('finish_reason') or finish
        output=''.join(pieces).strip()
        problem=translation_problem(text,output)
        if finish=='length':problem='译文长度超限'
        if problem:raise ValueError(problem)
        return output

    def save_alignment(self,file):
        Path(file).write_text('[]',encoding='utf-8')
