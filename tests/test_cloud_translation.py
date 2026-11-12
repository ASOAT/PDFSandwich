import asyncio
import json
import ssl

import httpx
import pytest

from test_translation_recovery import engine_at
from cancellation import PageCancelled, PageControl
from cloud_translation import CloudClient, CloudError
from translation_context import envelope


def completion(text):
    return httpx.Response(200, json={'choices': [{'message': {'content': text}, 'finish_reason': 'stop'}]})


async def request(handler, **options):
    client = CloudClient({'baseUrl': 'https://api.deepseek.com', 'model': 'deepseek-flash', 'apiKey': 'test-only'},
                         transport=httpx.MockTransport(handler))
    try:
        return await client.complete([{'role': 'user', 'content': 'Translate this.'}], 300, **options)
    finally:
        await client.close()


def test_tls_eof_then_rate_limit_then_success():
    attempts, retries = [], []

    def handle(req):
        attempts.append(json.loads(req.content))
        if len(attempts) == 1:
            raise httpx.ConnectError('UNEXPECTED_EOF_WHILE_READING', request=req)
        if len(attempts) == 2:
            return httpx.Response(429, headers={'Retry-After': '0'})
        return completion('译文。')

    assert asyncio.run(request(handle, on_retry=retries.append)) == '译文。'
    assert len(retries) == 2 and attempts == [attempts[0]] * 3
    assert attempts[0]['thinking'] == {'type': 'disabled'}


@pytest.mark.parametrize(('failure', 'message'), [('auth', 'HTTP 401'), ('cert', '证书校验失败')])
def test_permanent_errors_do_not_retry(failure, message):
    calls = []

    def handle(req):
        calls.append(req)
        if failure == 'cert':
            raise httpx.ConnectError('TLS connection failed', request=req) from ssl.SSLCertVerificationError()
        return httpx.Response(401, text='server details should not leak')

    with pytest.raises(CloudError, match=message) as error:
        asyncio.run(request(handle))
    assert len(calls) == 1 and 'server details' not in str(error.value)


def test_cancel_stalled_cloud_call(tmp_path):
    async def verify():
        cancel_file = tmp_path / 'cancel'
        control = PageControl({'cancelFile': str(cancel_file)})
        stopped = asyncio.Event()

        async def handle(req):
            cancel_file.touch()
            try:
                await asyncio.sleep(30)
            finally:
                stopped.set()

        with pytest.raises(PageCancelled):
            await asyncio.wait_for(request(handle, control=control), timeout=1)
        assert stopped.is_set()

    asyncio.run(verify())


def test_batch_keeps_valid_ids_and_repairs_only_bad_formula(tmp_path):
    engine = engine_at(tmp_path)
    first = 'We use matrix {v1} in the linear system.'
    second = 'where {v2} denotes the coefficient.'
    third = 'The system stays stable under this condition.'
    inputs = [first, envelope(second, {'before': first, 'precededByFormula': True}), third]
    calls = []

    def complete(messages, max_tokens):
        paragraphs = json.loads(messages[-1]['content'])['paragraphs']
        assert paragraphs[1]['context']['before'] == first
        assert 'where' not in paragraphs[1]['text']
        calls.append(paragraphs)
        return json.dumps({'translations': [
            {'id': 2, 'text': '该系统在这个条件下保持稳定。'},
            {'id': 1, 'text': '系数'},
            {'id': 0, 'text': '我们在线性系统中使用矩阵 {v1}。'},
        ]})

    repairs = []
    engine.cloud_complete = complete
    engine.generate = lambda text: repairs.append(text) or '{v3} {v2} 表示系数。'
    try:
        translated = list(engine.translate_group(inputs))
        assert translated == ['我们在线性系统中使用矩阵 {v1}。', '其中 {v2} 表示系数。', '该系统在这个条件下保持稳定。']
        assert len(calls) == 1 and len(repairs) == 1
        assert [r['source'] for r in engine.records] == [first, second, third]
        assert list(engine.translate_group(inputs)) == translated
        assert len(calls) == 1 and len(repairs) == 1
    finally:
        engine.close()
