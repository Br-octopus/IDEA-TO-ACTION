import asyncio
import json
import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

project_root = Path(__file__).resolve().parents[1]
bridge_directory = project_root / 'vendor' / 'mediacrawler-bridge'
sys.path.insert(0, str(project_root / 'vendor' / 'mediacrawler'))
sys.path.insert(0, str(bridge_directory))

import httpx
import bridge as source_bridge
from mediacrawler_lite.platforms.bilibili.client import BilibiliClient
from mediacrawler_lite.platforms.xhs.client import XiaoHongShuClient


class FakeResponse:
    text = '<html></html>'

    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request('GET', 'https://test.invalid/session')
            httpx.Response(self.status_code, request=request).raise_for_status()
        return None

    def json(self):
        return self.payload


class FakeAsyncClient:
    sent = []
    response_status = 200
    response_payload = None
    request_error = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def request(self, method, url, **kwargs):
        self.sent.append((method, url))
        if self.request_error is not None:
            raise self.request_error
        if self.response_payload is not None:
            return FakeResponse(self.response_payload, self.response_status)
        if '/x/web-interface/nav' in url:
            payload = {
                'code': 0,
                'data': {
                    'wbi_img': {
                        'img_url': 'https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png',
                        'sub_url': 'https://i0.hdslb.com/bfs/wbi/fedcba9876543210fedcba9876543210.png',
                    }
                },
            }
        elif '/selfinfo' in url:
            payload = {'success': True, 'data': {'result': {'success': True}}}
        elif 'xiaohongshu' in url or 'edith.xiaohongshu' in url:
            payload = {'success': True, 'data': {'items': []}}
        elif 'bilibili' in url:
            payload = {'code': 0, 'data': {'replies': []}}
        else:
            payload = {'success': True, 'data': {'items': []}}
        return FakeResponse(payload, self.response_status)

    async def get(self, url, **kwargs):
        return await self.request('GET', url, **kwargs)


class RequestBudget:
    def __init__(self, limit):
        self.limit = limit
        self.attempts = 0
        self.used = 0

    async def __call__(self, send):
        self.attempts += 1
        if self.used >= self.limit:
            raise RuntimeError('request budget exceeded')
        self.used += 1
        return await send()


class RequestBudgetTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeAsyncClient.sent = []
        FakeAsyncClient.response_status = 200
        FakeAsyncClient.response_payload = None
        FakeAsyncClient.request_error = None
        self.http_patch = patch('httpx.AsyncClient', FakeAsyncClient)
        self.http_patch.start()
        self.addCleanup(self.http_patch.stop)

    @staticmethod
    def disable_signing(client):
        async def plain_headers(uri, params=None, payload=None):
            return dict(client.headers)

        client._pre_headers = plain_headers

    async def test_xhs_comment_send_runs_inside_budget_callback(self):
        budget = RequestBudget(1)
        client = XiaoHongShuClient(headers={}, request_budget=budget)
        self.disable_signing(client)
        await client.get_note_comments('note-1', 'token')
        self.assertEqual(len(FakeAsyncClient.sent), 1)
        self.assertEqual((budget.attempts, budget.used), (1, 1))

    async def test_xhs_detail_post_runs_inside_budget_callback(self):
        budget = RequestBudget(1)
        client = XiaoHongShuClient(headers={}, request_budget=budget)

        async def plain_headers(uri, params=None, payload=None):
            return {}

        client._pre_headers = plain_headers
        await client.get_note_by_id('note-1', 'pc_search', 'token')
        self.assertEqual(len(FakeAsyncClient.sent), 1)
        self.assertEqual(FakeAsyncClient.sent[0][0], 'POST')
        self.assertEqual((budget.attempts, budget.used), (1, 1))

    async def test_xhs_html_and_session_sends_run_inside_budget_callback(self):
        budget = RequestBudget(2)
        client = XiaoHongShuClient(headers={}, request_budget=budget)
        self.disable_signing(client)
        await client.get_note_by_id_from_html('note-1', 'pc_search', 'token')
        await client.query_self()
        self.assertEqual(len(FakeAsyncClient.sent), 2)
        self.assertEqual((budget.attempts, budget.used), (2, 2))

    async def test_bilibili_wbi_and_comments_are_counted_as_two_sends(self):
        budget = RequestBudget(2)
        client = BilibiliClient(headers={}, request_budget=budget)
        await client.get_video_comments('123')
        self.assertEqual(len(FakeAsyncClient.sent), 2)
        self.assertIn('/x/web-interface/nav', FakeAsyncClient.sent[0][1])
        self.assertIn('/x/v2/reply/wbi/main', FakeAsyncClient.sent[1][1])
        self.assertEqual((budget.attempts, budget.used), (2, 2))

    async def test_budget_denial_stops_before_the_next_bilibili_http_send(self):
        budget = RequestBudget(1)
        client = BilibiliClient(headers={}, request_budget=budget)
        with self.assertRaisesRegex(RuntimeError, 'request budget exceeded'):
            await client.get_video_comments('123')
        self.assertEqual(len(FakeAsyncClient.sent), 1)
        self.assertEqual((budget.attempts, budget.used), (2, 1))

    async def test_cancellation_stops_before_the_next_bilibili_http_send(self):
        client = BilibiliClient(headers={}, request_budget=cancel_second_request)
        with self.assertRaises(asyncio.CancelledError):
            await client.get_video_comments('123')
        self.assertEqual(len(FakeAsyncClient.sent), 1)

    async def test_pong_returns_false_for_explicit_logged_out_responses(self):
        xhs = XiaoHongShuClient(headers={}, request_budget=RequestBudget(1))
        self.disable_signing(xhs)
        FakeAsyncClient.response_payload = {
            'success': True, 'data': {'result': {'success': False}}
        }
        self.assertFalse(await xhs.pong())

        FakeAsyncClient.response_payload = {'code': 0, 'data': {'isLogin': False}}
        bilibili = BilibiliClient(headers={}, request_budget=RequestBudget(1))
        self.assertFalse(await bilibili.pong())

    async def test_pong_propagates_timeout_and_rate_limit_for_error_classification(self):
        xhs = XiaoHongShuClient(headers={}, request_budget=RequestBudget(3))
        self.disable_signing(xhs)
        bilibili = BilibiliClient(headers={}, request_budget=RequestBudget(3))
        for client in (xhs, bilibili):
            with self.subTest(client=type(client).__name__, failure='timeout'):
                FakeAsyncClient.request_error = httpx.TimeoutException('network timeout')
                with self.assertRaises(httpx.TimeoutException) as timeout:
                    await client.pong()
                self.assertEqual(source_bridge._map_failure(timeout.exception), 'TIMEOUT')

            with self.subTest(client=type(client).__name__, failure='429'):
                FakeAsyncClient.request_error = None
                FakeAsyncClient.response_payload = None
                FakeAsyncClient.response_status = 429
                with self.assertRaises(httpx.HTTPStatusError) as limited:
                    await client.pong()
                self.assertEqual(source_bridge._map_failure(limited.exception), 'RATE_LIMITED')

            FakeAsyncClient.response_status = 200

    async def test_pong_propagates_service_errors_instead_of_reporting_logged_out(self):
        xhs = XiaoHongShuClient(headers={}, request_budget=RequestBudget(1))
        self.disable_signing(xhs)
        bilibili = BilibiliClient(headers={}, request_budget=RequestBudget(1))
        FakeAsyncClient.response_payload = {
            'success': False, 'code': '500', 'msg': 'service unavailable'
        }
        for client in (xhs, bilibili):
            with self.subTest(client=type(client).__name__):
                with self.assertRaises(httpx.RequestError) as failure:
                    await client.pong()
                self.assertEqual(source_bridge._map_failure(failure.exception), 'REQUEST_FAILED')

    async def test_xhs_detail_and_comments_http_access_and_verification_statuses_are_classified_by_bridge(self):
        def unsigned_client_factory(platform, cookies, budget):
            client = XiaoHongShuClient(headers={}, request_budget=budget)

            async def plain_headers(uri, params=None, payload=None):
                return {}

            client._pre_headers = plain_headers
            return client

        async def cookie_loader(platform, profile_id):
            return {}

        expected_codes = {
            401: 'LOGIN_EXPIRED',
            403: 'PERMISSION_DENIED',
            429: 'RATE_LIMITED',
            461: 'MANUAL_VERIFICATION_REQUIRED',
            471: 'MANUAL_VERIFICATION_REQUIRED',
        }
        for action in ('detail', 'comments'):
            for status, expected_code in expected_codes.items():
                with self.subTest(action=action, status=status):
                    FakeAsyncClient.response_status = status
                    FakeAsyncClient.response_payload = None
                    deadline = datetime.fromtimestamp(time.time() + 60, timezone.utc)
                    value = {
                        'requestId': 'request-1',
                        'protocolVersion': 1,
                        'sourceId': 'mediacrawler-lite',
                        'action': action,
                        'capability': action,
                        'platform': 'xiaohongshu',
                        'profileId': 'profile_a',
                        'taskId': 'task_a',
                        'contentId': {
                            'noteId': 'note-1', 'xsecSource': 'pc_search', 'xsecToken': 'token'
                        },
                        'budget': {
                            'maxRequests': 2,
                            'maxItems': 20,
                            'deadlineAt': deadline.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                        },
                    }
                    frames = []
                    await source_bridge.process_line(
                        json.dumps(value), frames.append,
                        cookie_loader=cookie_loader,
                        client_factory=unsigned_client_factory,
                    )
                    self.assertEqual(frames[-1]['type'], 'error')
                    self.assertEqual(frames[-1]['error']['code'], expected_code)
        FakeAsyncClient.response_status = 200


async def cancel_second_request(send):
    if len(FakeAsyncClient.sent) == 1:
        raise asyncio.CancelledError()
    return await send()


if __name__ == '__main__':
    unittest.main()
