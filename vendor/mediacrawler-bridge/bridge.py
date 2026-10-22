"""仅处理登记来源的有限只读动作，并以 JSONL 与主进程通信。"""

from __future__ import annotations

import asyncio
from html.parser import HTMLParser
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlencode

import httpx

PROTOCOL_VERSION = 1
SOURCE_ID = "mediacrawler-lite"
SOURCE_VERSION = "1.1.0"
PLATFORMS = {"xiaohongshu", "bilibili", "weibo", "zhihu"}
ACTIONS = {"health", "session", "detail", "comments"}
PLATFORM_ACTIONS = {
    "xiaohongshu": ACTIONS,
    "bilibili": ACTIONS,
    "weibo": ACTIONS,
    "zhihu": {"health", "detail"},
}
PROFILE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
REQUEST_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
TASK_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
START_URLS = {
    "xiaohongshu": "https://www.xiaohongshu.com/",
    "bilibili": "https://www.bilibili.com/",
    "weibo": "https://m.weibo.cn/",
    "zhihu": "https://www.zhihu.com/",
}

_VENDOR_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_VENDOR_ROOT / "mediacrawler"))

from mediacrawler_lite.platforms.xhs.exception import (
    DataFetchError as XhsDataFetchError,
    IPBlockError,
    NoteNotFoundError,
    PlatformAccessError,
)
from mediacrawler_lite.platforms.bilibili.exception import DataFetchError as BilibiliDataFetchError


class BridgeFailure(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _exact_object(value: Any, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == keys


def _deadline_epoch(value: Any) -> float:
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value):
        try:
            from datetime import datetime

            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except (TypeError, ValueError, OverflowError):
            pass
    raise BridgeFailure("INVALID_REQUEST")


def _validate_content_id(platform: str, action: str, content: Any) -> Optional[dict]:
    if action not in {"detail", "comments"}:
        if content is not None:
            raise BridgeFailure("INVALID_REQUEST")
        return None
    if not isinstance(content, dict):
        raise BridgeFailure("INVALID_REQUEST")

    if platform == "xiaohongshu":
        allowed = {"noteId", "xsecSource", "xsecToken", "cursor"}
        if set(content) - allowed or not isinstance(content.get("noteId"), str):
            raise BridgeFailure("INVALID_REQUEST")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", content["noteId"]):
            raise BridgeFailure("INVALID_REQUEST")
        for key in ("xsecSource", "xsecToken", "cursor"):
            item = content.get(key)
            if item is not None and (not isinstance(item, str) or len(item) > 512 or any(ch in item for ch in "\r\n\0")):
                raise BridgeFailure("INVALID_REQUEST")
        return dict(content)

    if platform == "weibo":
        if set(content) - {"postId", "cursor"} or not re.fullmatch(r"[A-Za-z0-9]{1,32}", str(content.get("postId", ""))):
            raise BridgeFailure("INVALID_REQUEST")
        cursor = content.get("cursor")
        if cursor is not None and (not isinstance(cursor, str) or len(cursor) > 64
                                   or not re.fullmatch(r"[0-9]*", cursor)):
            raise BridgeFailure("INVALID_REQUEST")
        if cursor is not None and action != "comments":
            raise BridgeFailure("INVALID_REQUEST")
        return dict(content)

    if platform == "zhihu":
        if action != "detail":
            raise BridgeFailure("INVALID_REQUEST")
        if set(content) == {"questionId", "answerId"}:
            if not all(isinstance(content[key], str) and re.fullmatch(r"[1-9][0-9]{0,29}", content[key])
                       for key in ("questionId", "answerId")):
                raise BridgeFailure("INVALID_REQUEST")
        elif set(content) == {"articleId"}:
            if not isinstance(content["articleId"], str) or not re.fullmatch(r"[1-9][0-9]{0,29}", content["articleId"]):
                raise BridgeFailure("INVALID_REQUEST")
        else:
            raise BridgeFailure("INVALID_REQUEST")
        return dict(content)

    allowed = {"bvid", "aid", "cursor"}
    if set(content) - allowed or bool(content.get("bvid")) == bool(content.get("aid")):
        raise BridgeFailure("INVALID_REQUEST")
    if "bvid" in content and (not isinstance(content["bvid"], str)
                               or not re.fullmatch(r"BV[A-Za-z0-9]{10}", content["bvid"])):
        raise BridgeFailure("INVALID_REQUEST")
    if "aid" in content and not (
        isinstance(content["aid"], int) and not isinstance(content["aid"], bool) and 0 < content["aid"] <= 2**53 - 1
        or isinstance(content["aid"], str) and re.fullmatch(r"[1-9][0-9]{0,19}", content["aid"])
    ):
        raise BridgeFailure("INVALID_REQUEST")
    cursor = content.get("cursor")
    if cursor is not None and not (
        isinstance(cursor, str) and len(cursor) <= 128 and not any(ch in cursor for ch in "\r\n\0")
        or isinstance(cursor, int) and not isinstance(cursor, bool) and cursor >= 0
    ):
        raise BridgeFailure("INVALID_REQUEST")
    if cursor is not None and action != "comments":
        raise BridgeFailure("INVALID_REQUEST")
    return dict(content)


def validate_request(value: Any, wall_time: Callable[[], float] = time.time) -> dict:
    keys = {
        "requestId", "protocolVersion", "sourceId", "action", "capability", "platform",
        "profileId", "taskId", "contentId", "budget",
    }
    if not _exact_object(value, keys):
        raise BridgeFailure("INVALID_REQUEST")
    if (not isinstance(value["sourceId"], str) or value["sourceId"] != SOURCE_ID
            or value["protocolVersion"] != PROTOCOL_VERSION
            or not isinstance(value["requestId"], str) or not REQUEST_PATTERN.fullmatch(value["requestId"])
            or not isinstance(value["taskId"], str) or not TASK_PATTERN.fullmatch(value["taskId"])
            or not isinstance(value["profileId"], str) or not PROFILE_PATTERN.fullmatch(value["profileId"])
            or not isinstance(value["platform"], str) or value["platform"] not in PLATFORMS
            or not isinstance(value["action"], str) or value["action"] not in PLATFORM_ACTIONS.get(value["platform"], set())
            or not isinstance(value["capability"], str) or value["capability"] != value["action"]):
        raise BridgeFailure("INVALID_REQUEST")
    budget = value["budget"]
    if not _exact_object(budget, {"maxRequests", "maxItems", "deadlineAt"}):
        raise BridgeFailure("INVALID_REQUEST")
    deadline = _deadline_epoch(budget["deadlineAt"])
    if (not isinstance(budget["maxRequests"], int) or isinstance(budget["maxRequests"], bool)
            or not 1 <= budget["maxRequests"] <= 10
            or not isinstance(budget["maxItems"], int) or isinstance(budget["maxItems"], bool)
            or not 1 <= budget["maxItems"] <= 20
            or deadline <= wall_time() or deadline > wall_time() + 15 * 60):
        raise BridgeFailure("INVALID_REQUEST")
    content_id = _validate_content_id(value["platform"], value["action"], value["contentId"])
    return {
        **value,
        "contentId": content_id,
        "budget": {**budget, "deadlineAt": deadline},
    }


class RequestBudget:
    """每次只读 HTTP send 都必须通过此回调；超限时回调不执行 send。"""

    def __init__(self, request: dict, emit: Callable[[dict], None], *, wall_time=time.time,
                 monotonic=time.monotonic):
        self.request = request
        self.emit = emit
        self.wall_time = wall_time
        self.monotonic = monotonic
        self.deadline_monotonic = monotonic() + max(0.0, request["budget"]["deadlineAt"] - wall_time())
        self.used_requests = 0
        self.used_items = 0
        self.in_flight = 0
        self.unknown_requests = 0

    def _report(self) -> None:
        self.emit({
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": self.request["requestId"],
            "type": "budget",
            "usedRequests": self.used_requests,
            "usedItems": self.used_items,
            "inFlight": self.in_flight > 0,
        })

    async def __call__(self, send: Callable[[], Any]) -> Any:
        if self.wall_time() >= self.request["budget"]["deadlineAt"] or self.monotonic() >= self.deadline_monotonic:
            raise BridgeFailure("TIMEOUT")
        if self.used_requests >= self.request["budget"]["maxRequests"]:
            raise BridgeFailure("BUDGET_EXCEEDED")
        self.used_requests += 1
        self.in_flight += 1
        self._report()
        try:
            return await send()
        except BaseException:
            self.unknown_requests += 1
            raise
        finally:
            self.in_flight -= 1
            self._report()

    def add_items(self, count: int) -> None:
        if not isinstance(count, int) or count < 0:
            raise BridgeFailure("INVALID_RESPONSE")
        self.used_items = min(count, self.request["budget"]["maxItems"])
        self._report()

    def response(self) -> dict:
        return {
            "usedRequests": self.used_requests,
            "usedItems": self.used_items,
            "unknownRequests": self.unknown_requests,
        }


async def load_profile_cookies(platform: str, profile_id: str) -> dict:
    """只读取此来源自己的 Playwright profile；不连接 Electron session 或读取 Electron Cookie。"""
    from playwright.async_api import async_playwright

    profile_directory = Path(os.environ["SOCIAL_SOURCE_PROFILE_DIR"]).resolve()
    source_root = Path(os.environ["SOCIAL_SOURCE_ROOT"]).resolve()
    expected_directory = (source_root / "profiles" / platform / profile_id).resolve()
    if (not PROFILE_PATTERN.fullmatch(profile_id)
            or os.environ.get("SOCIAL_SOURCE_PROFILE_ID") != profile_id
            or profile_directory != expected_directory):
        raise BridgeFailure("INVALID_REQUEST")
    if os.environ.get("SOCIAL_SOURCE_PLATFORM") != platform:
        raise BridgeFailure("INVALID_REQUEST")

    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            user_data_dir=str(profile_directory), headless=True
        )
        try:
            cookies = await context.cookies(START_URLS[platform])
            return {item["name"]: item["value"] for item in cookies if item.get("name") and item.get("value")}
        finally:
            await context.close()


def _make_client(platform: str, cookies: dict, request_budget: RequestBudget):
    cookie_header = "; ".join(f"{key}={value}" for key, value in cookies.items())
    headers = {"User-Agent": "Mozilla/5.0", "Cookie": cookie_header} if cookie_header else {"User-Agent": "Mozilla/5.0"}
    if platform == "xiaohongshu":
        from mediacrawler_lite.platforms.xhs.client import XiaoHongShuClient

        return XiaoHongShuClient(headers=headers, cookie_dict=cookies, request_budget=request_budget)
    from mediacrawler_lite.platforms.bilibili.client import BilibiliClient

    return BilibiliClient(headers=headers, cookie_dict=cookies, request_budget=request_budget)


def _limit_items(data: Any, max_items: int) -> tuple[Any, int]:
    if isinstance(data, list):
        return {"items": data[:max_items], "truncated": len(data) > max_items}, min(len(data), max_items)
    if not isinstance(data, dict):
        raise BridgeFailure("PAGE_STRUCTURE_CHANGED")
    for key in ("comments", "replies", "items"):
        entries = data.get(key)
        if isinstance(entries, list):
            result = dict(data)
            result[key] = entries[:max_items]
            result["truncated"] = len(entries) > max_items
            return result, min(len(entries), max_items)
    return data, 0


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden_depth += 1
        elif tag in {"br", "p", "div", "li"} and not self.hidden_depth:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.hidden_depth:
            self.hidden_depth -= 1
        elif tag in {"p", "div", "li"} and not self.hidden_depth:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden_depth:
            self.parts.append(data)


def _plain_text(value: Any) -> str:
    parser = _TextExtractor()
    parser.feed(value if isinstance(value, str) else "")
    return re.sub(r"[ \t\r\f\v]+", " ", "".join(parser.parts)).strip()


async def _http_get(url: str, cookies: dict, budget: RequestBudget, *, headers: Optional[dict] = None):
    request_headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"}
    if cookies:
        request_headers["Cookie"] = "; ".join(f"{name}={value}" for name, value in cookies.items())
    request_headers.update(headers or {})

    async def send():
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            return await client.get(url, headers=request_headers)

    response = await budget(send)
    if response.status_code != 200:
        error = RuntimeError("platform request failed")
        error.status_code = response.status_code
        raise error
    return response


async def _run_weibo(request: dict, cookies: dict, budget: RequestBudget) -> dict:
    content = request["contentId"]
    if request["action"] == "session":
        response = await _http_get("https://m.weibo.cn/api/config", cookies, budget)
        try:
            data = response.json()
        except ValueError as error:
            raise BridgeFailure("PAGE_STRUCTURE_CHANGED") from error
        if not isinstance(data, dict) or data.get("ok") not in (0, 1):
            raise BridgeFailure("PAGE_STRUCTURE_CHANGED")
        return {"loggedIn": bool(data.get("data", {}).get("login"))}
    post_id = content["postId"]
    if request["action"] == "detail":
        response = await _http_get(f"https://m.weibo.cn/detail/{post_id}", cookies, budget)
        match = re.search(r"var \$render_data = (\[.*?\])\[0\]", response.text, re.DOTALL)
        if not match:
            raise BridgeFailure("PAGE_STRUCTURE_CHANGED")
        try:
            items = json.loads(match.group(1))
        except ValueError as error:
            raise BridgeFailure("PAGE_STRUCTURE_CHANGED") from error
        post = items[0].get("status") if isinstance(items, list) and items and isinstance(items[0], dict) else None
        if not isinstance(post, dict):
            raise BridgeFailure("CONTENT_NOT_FOUND")
        user = post.get("user") if isinstance(post.get("user"), dict) else {}
        budget.add_items(1)
        return {
            "platform": "weibo", "contentType": "post", "contentId": post_id,
            "url": f"https://weibo.com/detail/{post_id}", "title": "",
            "text": _plain_text(post.get("text")), "author": _plain_text(user.get("screen_name")),
            "createdAt": post.get("created_at"), "sourceCreatedAt": post.get("created_at"),
            "truncated": False,
        }
    params = {"id": post_id, "mid": post_id, "max_id_type": 0}
    cursor = content.get("cursor") or ""
    if cursor:
        params["max_id"] = cursor
    url = "https://m.weibo.cn/comments/hotflow?" + urlencode(params)
    response = await _http_get(url, cookies, budget, headers={"Referer": f"https://m.weibo.cn/detail/{post_id}"})
    try:
        result = response.json()
    except ValueError as error:
        raise BridgeFailure("PAGE_STRUCTURE_CHANGED") from error
    data = result.get("data") if isinstance(result, dict) and result.get("ok") == 1 else None
    comments = data.get("data") if isinstance(data, dict) else None
    if not isinstance(comments, list):
        raise BridgeFailure("PAGE_STRUCTURE_CHANGED")
    limit = request["budget"]["maxItems"]
    items = []
    for item in comments[:limit]:
        if not isinstance(item, dict):
            continue
        user = item.get("user") if isinstance(item.get("user"), dict) else {}
        items.append({
            "id": str(item.get("id") or ""), "text": _plain_text(item.get("text")),
            "author": _plain_text(user.get("screen_name")), "createdAt": item.get("created_at"),
            "likeCount": item.get("like_count", 0),
        })
    budget.add_items(len(items))
    return {"items": items, "sortOrder": "hot", "totalCount": data.get("total_number"),
            "hasMore": bool(data.get("max_id")), "truncated": len(comments) > limit or bool(data.get("max_id"))}


async def _run_zhihu(request: dict, cookies: dict, budget: RequestBudget) -> dict:
    content = request["contentId"]
    if "answerId" in content:
        question_id, answer_id = content["questionId"], content["answerId"]
        url = f"https://www.zhihu.com/question/{question_id}/answer/{answer_id}"
        entity, entity_id, kind = "answers", answer_id, "answer"
    else:
        article_id = content["articleId"]
        url = f"https://zhuanlan.zhihu.com/p/{article_id}"
        entity, entity_id, kind = "articles", article_id, "article"
    response = await _http_get(url, cookies, budget)
    match = re.search(r"<script[^>]+id=[\"']js-initialData[\"'][^>]*>(.*?)</script>", response.text, re.DOTALL | re.IGNORECASE)
    if not match:
        raise BridgeFailure("PAGE_STRUCTURE_CHANGED")
    try:
        payload = json.loads(match.group(1))
    except ValueError as error:
        raise BridgeFailure("PAGE_STRUCTURE_CHANGED") from error
    state = payload.get("initialState") if isinstance(payload, dict) else None
    entities = state.get("entities") if isinstance(state, dict) else None
    records = entities.get(entity) if isinstance(entities, dict) else None
    if not isinstance(records, dict):
        raise BridgeFailure("PAGE_STRUCTURE_CHANGED")
    record = records.get(entity_id)
    if not isinstance(record, dict):
        raise BridgeFailure("CONTENT_NOT_FOUND")
    author = record.get("author") if isinstance(record.get("author"), dict) else {}
    question = record.get("question") if isinstance(record.get("question"), dict) else {}
    budget.add_items(1)
    return {
        "platform": "zhihu", "contentType": kind, "contentId": entity_id,
        "questionId": content.get("questionId", ""), "questionTitle": _plain_text(question.get("title")),
        "title": _plain_text(record.get("title")) if kind == "article" else _plain_text(question.get("title")),
        "text": _plain_text(record.get("content")), "author": _plain_text(author.get("name")),
        "createdAt": record.get("created_time") or record.get("created"),
        "updatedAt": record.get("updated_time") or record.get("updated"), "url": url, "truncated": False,
    }


_RESPONSE_STRUCTURE_ERRORS = frozenset({
    "XHS response is not valid JSON",
    "XHS response must be a JSON object",
    "XHS account response is not valid JSON",
    "XHS account response must be a JSON object",
    "XHS account response has an invalid login status",
    "Bilibili response is not valid JSON",
    "Bilibili response must be a JSON object",
    "Bilibili navigation data must be a JSON object",
    "Bilibili navigation response has invalid wbi_img",
    "Bilibili navigation response has an invalid login status",
})


def _is_response_structure_error(error: BaseException) -> bool:
    if not isinstance(error, (XhsDataFetchError, BilibiliDataFetchError)):
        return False
    message = str(error)
    return message in _RESPONSE_STRUCTURE_ERRORS or re.fullmatch(
        r"Bilibili WBI (?:img_url|sub_url) (?:must be a string|is not a valid URL|has an invalid structure|has an invalid key)",
        message,
    ) is not None


async def _run_action(request: dict, budget: RequestBudget, cookie_loader, client_factory) -> dict:
    action = request["action"]
    if action == "health":
        return {"healthy": True, "sourceVersion": SOURCE_VERSION, "pythonVersion": sys.version.split()[0]}

    cookies = await cookie_loader(request["platform"], request["profileId"])
    if request["platform"] in {"weibo", "zhihu"}:
        if request["platform"] == "zhihu" and action != "detail":
            raise BridgeFailure("INVALID_REQUEST")
        if request["platform"] == "weibo" and action == "session":
            return await _run_weibo(request, cookies, budget)
        if action == "session":
            raise BridgeFailure("INVALID_REQUEST")
        return await (_run_weibo(request, cookies, budget) if request["platform"] == "weibo"
                      else _run_zhihu(request, cookies, budget))
    client = client_factory(request["platform"], cookies, budget)
    if action == "session":
        return {"loggedIn": bool(await client.pong())}

    content = request["contentId"]
    if request["platform"] == "xiaohongshu":
        if action == "detail":
            data = await client.get_note_by_id(
                content["noteId"], content.get("xsecSource", ""), content.get("xsecToken", "")
            )
            budget.add_items(1 if data else 0)
            return data
        data = await client.get_note_comments(
            content["noteId"], content.get("xsecToken", ""), content.get("cursor", "")
        )
    elif action == "detail":
        data = await client.get_video_info(aid=content.get("aid"), bvid=content.get("bvid"))
        budget.add_items(1 if data else 0)
        return data
    else:
        aid = content.get("aid")
        if aid is None:
            details = await client.get_video_info(bvid=content["bvid"])
            view = details.get("View", details.get("view", details)) if isinstance(details, dict) else {}
            aid = view.get("aid") if isinstance(view, dict) else None
            if not aid:
                raise BridgeFailure("CONTENT_NOT_FOUND")
        data = await client.get_video_comments(str(aid), next=content.get("cursor", 0))

    limited, count = _limit_items(data, request["budget"]["maxItems"])
    budget.add_items(count)
    return limited


def _map_failure(error: BaseException) -> str:
    if isinstance(error, BridgeFailure):
        return error.code
    if isinstance(error, (asyncio.TimeoutError, TimeoutError, httpx.TimeoutException)):
        return "TIMEOUT"
    status = getattr(error, "status_code", None)
    if not isinstance(status, int) or isinstance(status, bool):
        status = getattr(getattr(error, "response", None), "status_code", None)
    if status in {461, 471}:
        return "MANUAL_VERIFICATION_REQUIRED"
    if status == 429:
        return "RATE_LIMITED"
    if status == 401:
        return "LOGIN_EXPIRED"
    if status == 403:
        return "PERMISSION_DENIED"
    if _is_response_structure_error(error):
        return "PAGE_STRUCTURE_CHANGED"
    if status == 404 or isinstance(error, NoteNotFoundError):
        return "CONTENT_NOT_FOUND"
    if isinstance(error, IPBlockError):
        return "IP_BLOCKED"
    if isinstance(error, PlatformAccessError):
        return "ACCOUNT_RESTRICTED"
    return "REQUEST_FAILED"


async def process_line(line: str, emit: Callable[[dict], None], *, cookie_loader=load_profile_cookies,
                       client_factory=_make_client, wall_time=time.time, monotonic=time.monotonic) -> None:
    try:
        request_value = json.loads(line)
    except (TypeError, ValueError):
        request_value = {}
    request_id = request_value.get("requestId", "") if isinstance(request_value, dict) else ""
    protocol_version = request_value.get("protocolVersion", PROTOCOL_VERSION) if isinstance(request_value, dict) else PROTOCOL_VERSION
    request = None
    budget = None
    try:
        request = validate_request(request_value, wall_time=wall_time)
        budget = RequestBudget(request, emit, wall_time=wall_time, monotonic=monotonic)
        data = await _run_action(request, budget, cookie_loader, client_factory)
        emit({
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": request["requestId"],
            "type": "result",
            "result": {
                "status": "ok",
                "action": request["action"],
                "platform": request["platform"],
                "profileId": request["profileId"],
                "data": data,
                "budget": budget.response(),
            },
        })
    except BaseException as error:
        code = _map_failure(error)
        logging.error("source bridge action failed: %s", code)
        emit({
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": request["requestId"] if request else request_id,
            "type": "error",
            "error": {"code": code},
            "budget": budget.response() if budget else {"usedRequests": 0, "usedItems": 0, "unknownRequests": 0},
        })


async def _open_login() -> None:
    platform = os.environ.get("SOCIAL_SOURCE_PLATFORM", "")
    profile_id = os.environ.get("SOCIAL_SOURCE_PROFILE_ID", "")
    profile_directory = Path(os.environ.get("SOCIAL_SOURCE_PROFILE_DIR", "")).resolve()
    source_root = Path(os.environ.get("SOCIAL_SOURCE_ROOT", "")).resolve()
    expected_directory = (source_root / "profiles" / platform / profile_id).resolve()
    if (platform not in PLATFORMS or not PROFILE_PATTERN.fullmatch(profile_id)
            or os.environ.get("SOCIAL_SOURCE_PROFILE_ID") != profile_id
            or profile_directory != expected_directory):
        raise BridgeFailure("INVALID_REQUEST")

    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            user_data_dir=str(profile_directory), headless=False
        )
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto(START_URLS[platform], wait_until="domcontentloaded", timeout=30_000)
            print(json.dumps({
                "protocolVersion": PROTOCOL_VERSION,
                "type": "login-ready",
                "platform": platform,
                "profileId": profile_id,
            }, ensure_ascii=False), flush=True)
            closed = asyncio.Event()
            for current_page in context.pages:
                current_page.on("close", lambda: closed.set())
            await closed.wait()
        finally:
            await context.close()


def main() -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.ERROR, format="%(levelname)s %(message)s")
    if sys.argv[1:] == ["--open-login"]:
        try:
            asyncio.run(_open_login())
            return 0
        except BaseException as error:
            logging.error("login browser failed: %s", _map_failure(error))
            return 1
    if sys.argv[1:]:
        logging.error("unsupported bridge mode: INVALID_REQUEST")
        return 2
    line = sys.stdin.readline()
    if not line:
        return 0
    asyncio.run(process_line(line, lambda frame: print(json.dumps(frame, ensure_ascii=False, separators=(",", ":")), flush=True)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
