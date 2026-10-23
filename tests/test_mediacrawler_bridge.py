import asyncio
import json
import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

bridge_directory = Path(__file__).resolve().parents[1] / 'vendor' / 'mediacrawler-bridge'
sys.path.insert(0, str(bridge_directory))
sys.path.insert(0, str(bridge_directory.parent / 'mediacrawler'))

try:
    import bridge
except ImportError:
    bridge = None


def request(action='health', **overrides):
    deadline = datetime.fromtimestamp(time.time() + 60, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    value = {
        'requestId': 'request-1',
        'protocolVersion': 1,
        'sourceId': 'mediacrawler-lite',
        'action': action,
        'capability': action,
        'platform': 'bilibili',
        'profileId': 'profile_a',
        'taskId': 'task_a',
        'contentId': None,
        'budget': {
            'maxRequests': 2,
            'maxItems': 20,
            'deadlineAt': deadline,
        },
    }
    value.update(overrides)
    return value


class FakeClient:
    def __init__(self, cookies, budget):
        self.cookies = cookies
        self.budget = budget

    async def pong(self):
        return True

    async def get_video_comments(self, video_id, next=0):
        async def send():
            return None

        await self.budget(send)
        await self.budget(send)
        return {'replies': [{'rpid': str(index)} for index in range(30)]}


def fake_client_factory(platform, cookies, budget):
    return FakeClient(cookies, budget)


async def fake_cookie_loader(platform, profile_id):
    return {'SESSDATA': 'private-test-cookie'}


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_weibo_session_does_not_require_a_post_id(self):
        response = type('Response', (), {
            'status_code': 200,
            'json': lambda self: {'ok': 1, 'data': {'login': True}},
        })()
        frames = []
        with patch.object(bridge, '_http_get', return_value=response) as get:
            await bridge.process_line(
                json.dumps(request('session', platform='weibo')), frames.append,
                cookie_loader=fake_cookie_loader,
            )
        self.assertEqual(frames[-1]['type'], 'result')
        self.assertEqual(frames[-1]['result']['data'], {'loggedIn': True})
        get.assert_awaited_once()

    async def test_weibo_detail_and_limited_comments_are_parsed_without_network(self):
        detail_response = type('Response', (), {
            'status_code': 200,
            'text': 'var $render_data = [{"status":{"text":"<p>正文</p>","user":{"screen_name":"作者"},"created_at":"2026-01-01"}}][0];',
        })()
        detail_frames = []
        with patch.object(bridge, '_http_get', return_value=detail_response):
            await bridge.process_line(
                json.dumps(request('detail', platform='weibo', contentId={'postId': '123456'})),
                detail_frames.append, cookie_loader=fake_cookie_loader,
            )
        detail = detail_frames[-1]['result']['data']
        self.assertEqual(detail['text'], '正文')
        self.assertEqual(detail['author'], '作者')
        self.assertEqual(detail['contentId'], '123456')

        comment_response = type('Response', (), {
            'status_code': 200,
            'json': lambda self: {'ok': 1, 'data': {
                'data': [{'id': index, 'text': f'<span>评论{index}</span>', 'user': {'screen_name': '读者'}}
                         for index in range(5)],
                'total_number': 18, 'max_id': 88,
            }},
        })()
        comment_frames = []
        payload = request('comments', platform='weibo', contentId={'postId': '123456'}, budget={
            'maxRequests': 1, 'maxItems': 2,
            'deadlineAt': datetime.fromtimestamp(time.time() + 60, timezone.utc)
            .isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        })
        with patch.object(bridge, '_http_get', return_value=comment_response):
            await bridge.process_line(json.dumps(payload), comment_frames.append, cookie_loader=fake_cookie_loader)
        comments = comment_frames[-1]['result']['data']
        self.assertEqual(len(comments['items']), 2)
        self.assertEqual(comments['items'][0]['text'], '评论0')
        self.assertEqual(comments['totalCount'], 18)
        self.assertTrue(comments['truncated'])

    async def test_zhihu_answer_and_article_initial_data_are_parsed(self):
        def html(entity, entity_id, record):
            state = {'initialState': {'entities': {entity: {entity_id: record}}}}
            return type('Response', (), {
                'status_code': 200,
                'text': '<script id="js-initialData">' + json.dumps(state) + '</script>',
            })()

        answer = {'content': '<p>回答正文</p>', 'author': {'name': '答主'},
                  'question': {'title': '问题标题'}, 'created_time': 100, 'updated_time': 200}
        article = {'content': '<p>文章正文</p>', 'title': '文章标题', 'author': {'name': '作者'},
                   'created': 300, 'updated': 400}
        cases = [
            ({'questionId': '123', 'answerId': '456'}, 'answers', '456', answer, 'answer', '问题标题'),
            ({'articleId': '789'}, 'articles', '789', article, 'article', '文章标题'),
        ]
        for content_id, entity, entity_id, record, kind, title in cases:
            with self.subTest(kind=kind):
                frames = []
                with patch.object(bridge, '_http_get', return_value=html(entity, entity_id, record)):
                    await bridge.process_line(
                        json.dumps(request('detail', platform='zhihu', contentId=content_id)),
                        frames.append, cookie_loader=fake_cookie_loader,
                    )
                parsed = frames[-1]['result']['data']
                self.assertEqual(parsed['contentType'], kind)
                self.assertEqual(parsed['title'], title)
                self.assertEqual(parsed['author'], record['author']['name'])
                self.assertIn('正文', parsed['text'])

    async def test_zhihu_unrecognized_initial_data_fails_as_structure_change(self):
        response = type('Response', (), {
            'status_code': 200,
            'text': '<script id="js-initialData">{"unexpected":{}}</script>',
        })()
        frames = []
        with patch.object(bridge, '_http_get', return_value=response):
            await bridge.process_line(
                json.dumps(request('detail', platform='zhihu', contentId={'articleId': '789'})),
                frames.append, cookie_loader=fake_cookie_loader,
            )
        self.assertEqual(frames[-1]['type'], 'error')
        self.assertEqual(frames[-1]['error']['code'], 'PAGE_STRUCTURE_CHANGED')

    async def test_http_get_counts_the_actual_send_against_request_budget(self):
        class FakeResponse:
            status_code = 200

        class FakeAsyncClient:
            def __init__(self, **kwargs):
                self.options = kwargs

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def get(self, url, headers):
                self.url = url
                self.headers = headers
                return FakeResponse()

        frames = []
        limiter = bridge.RequestBudget(bridge.validate_request(request('health')), frames.append)
        with patch.object(bridge.httpx, 'AsyncClient', FakeAsyncClient):
            response = await bridge._http_get('https://example.invalid/read', {'sid': 'secret'}, limiter)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(limiter.used_requests, 1)
        self.assertEqual(limiter.in_flight, 0)
        self.assertEqual(limiter.unknown_requests, 0)

    async def test_health_emits_only_a_schema_valid_jsonl_result(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')
        frames = []
        await bridge.process_line(json.dumps(request()), frames.append)
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0]['type'], 'result')
        self.assertEqual(frames[0]['protocolVersion'], 1)
        self.assertEqual(frames[0]['requestId'], 'request-1')
        self.assertEqual(frames[0]['result']['data']['healthy'], True)
        self.assertEqual(frames[0]['result']['data']['sourceVersion'], '1.1.0')

    async def test_session_false_is_a_successful_logged_out_result(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')

        class LoggedOutClient(FakeClient):
            async def pong(self):
                return False

        frames = []
        await bridge.process_line(
            json.dumps(request('session')), frames.append,
            cookie_loader=fake_cookie_loader,
            client_factory=lambda platform, cookies, budget: LoggedOutClient(cookies, budget),
        )
        self.assertEqual(frames[-1]['type'], 'result')
        self.assertEqual(frames[-1]['result']['data'], {'loggedIn': False})

    async def test_xhs_http_status_attribute_maps_to_jsonl_error_codes(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')
        from mediacrawler_lite.platforms.xhs.exception import PlatformAccessError

        class StatusClient(FakeClient):
            def __init__(self, cookies, budget, status):
                super().__init__(cookies, budget)
                self.status = status

            def failure(self):
                error = PlatformAccessError('structured platform access status')
                error.status_code = self.status
                return error

            async def get_note_by_id(self, note_id, xsec_source, xsec_token):
                raise self.failure()

            async def get_note_comments(self, note_id, xsec_token, cursor=''):
                raise self.failure()

        expected = {401: 'LOGIN_EXPIRED', 403: 'PERMISSION_DENIED', 429: 'RATE_LIMITED'}
        for action in ('detail', 'comments'):
            for status, code in expected.items():
                with self.subTest(action=action, status=status):
                    frames = []
                    value = request(
                        action,
                        platform='xiaohongshu',
                        contentId={'noteId': 'note-1', 'xsecSource': 'pc_search', 'xsecToken': 'token'},
                    )
                    await bridge.process_line(
                        json.dumps(value), frames.append,
                        cookie_loader=fake_cookie_loader,
                        client_factory=lambda platform, cookies, budget: StatusClient(cookies, budget, status),
                    )
                    self.assertEqual(frames[-1]['type'], 'error')
                    self.assertEqual(frames[-1]['error']['code'], code)

    async def test_explicit_response_shape_failures_are_distinct_from_business_failures(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')
        from mediacrawler_lite.platforms.bilibili.exception import DataFetchError as BilibiliDataFetchError
        from mediacrawler_lite.platforms.xhs.exception import DataFetchError as XhsDataFetchError

        cases = [
            ('xiaohongshu', 'XHS response is not valid JSON', XhsDataFetchError, 'PAGE_STRUCTURE_CHANGED'),
            ('xiaohongshu', 'XHS response must be a JSON object', XhsDataFetchError, 'PAGE_STRUCTURE_CHANGED'),
            ('bilibili', 'Bilibili response must be a JSON object', BilibiliDataFetchError, 'PAGE_STRUCTURE_CHANGED'),
            ('bilibili', 'Bilibili navigation response has invalid wbi_img', BilibiliDataFetchError, 'PAGE_STRUCTURE_CHANGED'),
            ('bilibili', 'Bilibili WBI img_url has an invalid key', BilibiliDataFetchError, 'PAGE_STRUCTURE_CHANGED'),
            ('bilibili', 'video unavailable', BilibiliDataFetchError, 'REQUEST_FAILED'),
        ]

        class FailureClient(FakeClient):
            def __init__(self, cookies, budget, error):
                super().__init__(cookies, budget)
                self.error = error

            async def get_note_by_id(self, note_id, xsec_source, xsec_token):
                raise self.error

            async def get_video_comments(self, video_id, next=0):
                raise self.error

        for platform, message, error_type, expected_code in cases:
            with self.subTest(platform=platform, message=message):
                action = 'detail' if platform == 'xiaohongshu' else 'comments'
                content_id = ({'noteId': 'note-1'} if platform == 'xiaohongshu'
                              else {'aid': '123', 'cursor': '0'})
                frames = []
                await bridge.process_line(
                    json.dumps(request(action, platform=platform, contentId=content_id)), frames.append,
                    cookie_loader=fake_cookie_loader,
                    client_factory=lambda selected_platform, cookies, budget: FailureClient(
                        cookies, budget, error_type(message)
                    ),
                )
                self.assertEqual(frames[-1]['type'], 'error')
                self.assertEqual(frames[-1]['error']['code'], expected_code)

        self.assertEqual(
            bridge._map_failure(RuntimeError('Bilibili response must be a JSON object')),
            'REQUEST_FAILED',
            '普通异常不能仅凭相似文案归为页面结构变化',
        )

    async def test_invalid_bilibili_wbi_fields_are_page_structure_changes(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')
        from mediacrawler_lite.platforms.bilibili.client import BilibiliClient
        from mediacrawler_lite.platforms.bilibili.exception import DataFetchError

        valid_sub_url = 'https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png'
        invalid_navigation = [
            {'wbi_img': None},
            {'wbi_img': {'img_url': None, 'sub_url': valid_sub_url}},
            {'wbi_img': {'img_url': 'https://i0.hdslb.com/wbi/not-a-key.png', 'sub_url': valid_sub_url}},
        ]
        for navigation in invalid_navigation:
            with self.subTest(navigation=navigation):
                client = BilibiliClient(headers={}, request_budget=lambda send: send())

                async def return_navigation(*args, **kwargs):
                    return navigation

                client.request = return_navigation
                with self.assertRaises(DataFetchError) as failure:
                    await client.get_wbi_keys()
                self.assertEqual(bridge._map_failure(failure.exception), 'PAGE_STRUCTURE_CHANGED')

    async def test_xhs_structured_access_exceptions_map_to_distinct_jsonl_errors(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')
        from mediacrawler_lite.platforms.xhs.exception import IPBlockError, PlatformAccessError

        class AccessFailureClient(FakeClient):
            def __init__(self, cookies, budget, error_type):
                super().__init__(cookies, budget)
                self.error_type = error_type

            def failure(self):
                return self.error_type('structured XHS access failure')

            async def get_note_by_id(self, note_id, xsec_source, xsec_token):
                raise self.failure()

            async def get_note_comments(self, note_id, xsec_token, cursor=''):
                raise self.failure()

        expected = {
            IPBlockError: 'IP_BLOCKED',
            PlatformAccessError: 'ACCOUNT_RESTRICTED',
        }
        for action in ('detail', 'comments'):
            for error_type, code in expected.items():
                with self.subTest(action=action, error_type=error_type.__name__):
                    frames = []
                    value = request(
                        action,
                        platform='xiaohongshu',
                        contentId={'noteId': 'note-1', 'xsecSource': 'pc_search', 'xsecToken': 'token'},
                    )
                    await bridge.process_line(
                        json.dumps(value), frames.append,
                        cookie_loader=fake_cookie_loader,
                        client_factory=lambda platform, cookies, budget: AccessFailureClient(
                            cookies, budget, error_type
                        ),
                    )
                    self.assertEqual(frames[-1]['type'], 'error')
                    self.assertEqual(frames[-1]['error']['code'], code)

    async def test_invalid_response_uses_a_valid_error_jsonl_frame(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')

        class MalformedClient(FakeClient):
            async def get_video_comments(self, video_id, next=0):
                return 'not an object or list'

        frames = []
        value = request('comments', contentId={'aid': '123', 'cursor': '0'})
        await bridge.process_line(
            json.dumps(value), frames.append,
            cookie_loader=fake_cookie_loader,
            client_factory=lambda platform, cookies, budget: MalformedClient(cookies, budget),
        )
        self.assertEqual(frames[-1]['type'], 'error')
        self.assertEqual(frames[-1]['requestId'], 'request-1')
        self.assertEqual(frames[-1]['error']['code'], 'PAGE_STRUCTURE_CHANGED')
        self.assertEqual(frames[-1]['budget']['unknownRequests'], 0)

    async def test_structured_status_code_takes_precedence_over_response_status(self):
        error = RuntimeError('arbitrary message that must not be parsed')
        error.status_code = 429
        error.response = type('Response', (), {'status_code': 403})()
        self.assertEqual(bridge._map_failure(error), 'RATE_LIMITED')

    async def test_comments_are_single_action_budgeted_and_limited_to_content_cap(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')
        frames = []
        value = request(
            'comments',
            contentId={'aid': '123', 'cursor': '0'},
            budget={
                'maxRequests': 2,
                'maxItems': 3,
                'deadlineAt': datetime.fromtimestamp(time.time() + 60, timezone.utc)
                .isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            },
        )
        await bridge.process_line(json.dumps(value), frames.append,
                                  cookie_loader=fake_cookie_loader,
                                  client_factory=fake_client_factory)
        result = frames[-1]['result']
        self.assertEqual(result['budget']['usedRequests'], 2)
        self.assertEqual(len(result['data']['replies']), 3)
        self.assertTrue(result['data']['truncated'])

    async def test_invalid_action_and_arbitrary_process_fields_are_rejected(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')
        for value in [request('search'), {**request(), 'command': 'python evil.py'}]:
            with self.subTest(value=value):
                frames = []
                await bridge.process_line(json.dumps(value), frames.append)
                self.assertEqual(frames[-1]['type'], 'error')
                self.assertEqual(frames[-1]['error']['code'], 'INVALID_REQUEST')

    async def test_budget_deadline_and_request_limit_block_send_callback(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')
        frames = []
        limiter = bridge.RequestBudget(request('health', budget={
            'maxRequests': 1, 'maxItems': 1, 'deadlineAt': time.time() + 60
        }), frames.append)
        sends = []

        async def send():
            sends.append('sent')

        await limiter(send)
        with self.assertRaises(bridge.BridgeFailure) as denied:
            await limiter(send)
        self.assertEqual(denied.exception.code, 'BUDGET_EXCEEDED')
        self.assertEqual(len(sends), 1)

        expired = bridge.RequestBudget(request('health', budget={
            'maxRequests': 1, 'maxItems': 1, 'deadlineAt': time.time() - 1
        }), frames.append)
        with self.assertRaises(bridge.BridgeFailure) as timed_out:
            await expired(send)
        self.assertEqual(timed_out.exception.code, 'TIMEOUT')
        self.assertEqual(len(sends), 1)

    async def test_failed_http_send_is_reported_as_unknown_in_error_frame(self):
        self.assertIsNotNone(bridge, '应提供独立的 MediaCrawler JSONL 桥接入口')

        class FailedSendClient(FakeClient):
            async def get_video_comments(self, video_id, next=0):
                async def send():
                    raise asyncio.TimeoutError()

                return await self.budget(send)

        frames = []
        value = request('comments', contentId={'aid': '123', 'cursor': '0'})
        await bridge.process_line(
            json.dumps(value), frames.append,
            cookie_loader=fake_cookie_loader,
            client_factory=lambda platform, cookies, budget: FailedSendClient(cookies, budget),
        )
        self.assertEqual(frames[-1]['type'], 'error')
        self.assertEqual(frames[-1]['budget']['usedRequests'], 1)
        self.assertEqual(frames[-1]['budget']['unknownRequests'], 1)
