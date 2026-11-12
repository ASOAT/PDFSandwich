"""OpenAI-compatible transport shared by page translation and the connection test."""
import asyncio
import ssl
from urllib.parse import urlsplit

import httpx


class CloudError(RuntimeError):
    pass


HTTP_ERRORS = {
    400: '请求格式无效，请检查服务地址和模型名称。',
    401: '鉴权失败，请检查 API Key。',
    402: '账户余额不足，请在服务商后台查看。',
    403: '访问被拒绝，请检查密钥权限和网络。',
    404: '找不到接口或模型，请检查服务地址和模型名称。',
    422: '服务不接受当前参数，请检查模型名称。',
    429: '服务限流，请稍后重试。',
}
RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


def certificate_failure(error):
    while error is not None:
        if isinstance(error, ssl.SSLCertVerificationError) or 'CERTIFICATE_VERIFY_FAILED' in str(error):
            return True
        error = error.__cause__
    return False


class CloudClient:
    def __init__(self, settings, *, transport=None):
        self.endpoint = settings['baseUrl'].rstrip('/') + '/chat/completions'
        self.hostname = urlsplit(self.endpoint).hostname
        self.loopback = self.hostname in {'localhost', '127.0.0.1', '::1'}
        self.key = settings.get('apiKey') or ''
        self.model = settings['model']
        self.http = httpx.AsyncClient(
            timeout=httpx.Timeout(45, connect=8), transport=transport,
            trust_env=not self.loopback,
            headers={'Authorization': 'Bearer ' + (self.key or 'local')},
        )

    async def close(self):
        await self.http.aclose()

    async def complete(self, messages, max_tokens, *, control=None, on_retry=None):
        if not self.key and not self.loopback:
            raise CloudError('请先配置 API Key。')
        payload = {'model': self.model, 'messages': messages, 'temperature': 0,
                   'stream': False, 'max_tokens': max_tokens}
        if self.hostname == 'api.deepseek.com':
            payload['thinking'] = {'type': 'disabled'}

        task = asyncio.create_task(self._request(payload, on_retry))
        try:
            if control:
                while not task.done():
                    control.check()
                    await asyncio.wait([task], timeout=.05)
                control.check()
            return await task
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _request(self, payload, on_retry):
        for attempt in range(3):
            delay = .5 * 2**attempt
            try:
                async with asyncio.timeout(55):
                    response = await self.http.post(self.endpoint, json=payload)
            except (httpx.TransportError, TimeoutError) as error:
                if certificate_failure(error):
                    raise CloudError('HTTPS 证书校验失败，请检查系统时间、代理和证书配置。') from None
                timed_out = isinstance(error, (httpx.TimeoutException, TimeoutError))
                retryable = timed_out or isinstance(error, (httpx.NetworkError, httpx.RemoteProtocolError, httpx.ProxyError))
                message = '等待服务响应超时，请检查网络或稍后重试。' if timed_out else '连接未完成或被中断，请检查网络、代理或稍后重试。'
                if not retryable or attempt == 2:
                    raise CloudError(message) from None
            else:
                if response.is_success:
                    return self._content(response)
                status = response.status_code
                if status not in RETRYABLE_STATUS or attempt == 2:
                    raise CloudError(f'HTTP {status}。'+HTTP_ERRORS.get(status, '服务暂不可用，请稍后重试。'))
                retry_after = response.headers.get('retry-after', '')
                if retry_after.isascii() and retry_after.isdecimal() and len(retry_after) <= 5:
                    delay = max(delay, int(retry_after))
                    if delay > 10:
                        raise CloudError(f'HTTP {status}。服务要求等待 {int(delay)} 秒，请稍后重试。')
            if on_retry:
                on_retry(f'云端连接暂时中断或繁忙，正在重试（{attempt+1}/2）…')
            await asyncio.sleep(delay)

    @staticmethod
    def _content(response):
        try:
            choice = response.json()['choices'][0]
            content = choice['message'].get('content')
        except (ValueError, TypeError, KeyError, AttributeError, IndexError):
            raise CloudError('服务返回的内容不符合 Chat Completions 格式。') from None
        if choice.get('finish_reason') == 'length':
            raise ValueError('译文长度超限')
        if choice.get('finish_reason') == 'content_filter':
            raise CloudError('服务过滤了本段内容，未返回译文。')
        if not isinstance(content, str) or not content.strip():
            raise ValueError('服务未返回译文。')
        return content.strip()


def test_connection(settings):
    async def probe():
        client = CloudClient(settings)
        try:
            text = await client.complete([{'role': 'user', 'content':
                'Translate to simplified Chinese. Return only the translation: The reader preserves mathematical formulas.'}], 120)
            return {'text': text}
        finally:
            await client.close()
    return asyncio.run(probe())
