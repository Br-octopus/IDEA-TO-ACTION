# -*- coding: utf-8 -*-
# Copyright (c) 2025 relakkes@gmail.com
#
# This file is part of MediaCrawler project.
# Repository: https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/client.py
# GitHub: https://github.com/NanmiCoder
# Licensed under NON-COMMERCIAL LEARNING LICENSE 1.1
#

# 声明：本代码仅供学习和研究目的使用。使用者应遵守以下原则：
# 1. 不得用于任何商业用途。
# 2. 使用时应遵守目标平台的使用条款和robots.txt规则。
# 3. 不得进行大规模爬取或对平台造成运营干扰。
# 4. 应合理控制请求频率，避免给目标平台带来不必要的负担。
# 5. 不得用于任何非法或不当的用途。
#
# 详细许可条款请参阅项目根目录下的LICENSE文件。
# 使用本代码即表示您同意遵守上述原则和LICENSE中的所有条款。

import json
from typing import Any, Awaitable, Callable, Dict, Optional
from urllib.parse import quote

import httpx

from .exception import (
    DataFetchError,
    IPBlockError,
    NoteNotFoundError,
    PlatformAccessError,
)
from .extractor import XiaoHongShuExtractor
from .playwright_sign import sign_with_xhshow


class XiaoHongShuClient:
    """仅保留单次详情、单页一级评论和登录状态检查。"""

    def __init__(
        self,
        timeout: float = 30,
        *,
        headers: Dict[str, str],
        cookie_dict: Optional[Dict[str, str]] = None,
        request_budget: Callable[[Callable[[], Awaitable[Any]]], Awaitable[Any]],
    ):
        if not callable(request_budget):
            raise TypeError("request_budget callback is required")
        self.timeout = timeout
        self.headers = dict(headers)
        self.cookie_dict = cookie_dict or {}
        self.request_budget = request_budget
        if not any(name.casefold() == "cookie" for name in self.headers):
            cookie_header = "; ".join(
                f"{name}={value}" for name, value in self.cookie_dict.items()
            )
            if cookie_header:
                self.headers["Cookie"] = cookie_header
        self._host = "https://edith.xiaohongshu.com"
        self._domain = "https://www.xiaohongshu.com"
        self.IP_ERROR_CODE = 300012
        self.SECURITY_LIMIT_CODE = 300011
        self.NOTE_NOT_FOUND_CODE = -510000
        self.NOTE_ABNORMAL_CODE = -510001
        self._extractor = XiaoHongShuExtractor()

    async def _pre_headers(
        self,
        url: str,
        params: Optional[Dict] = None,
        payload: Optional[Dict] = None,
    ) -> Dict:
        """使用上游 xhshow 签名函数准备请求头。"""
        headers = dict(self.headers)
        if params is not None:
            data = params
            method = "GET"
        elif payload is not None:
            data = payload
            method = "POST"
        else:
            raise ValueError("params or payload is required")

        signs = sign_with_xhshow(
            uri=url,
            data=data,
            cookie_str=next(
                (
                    value
                    for name, value in headers.items()
                    if name.casefold() == "cookie"
                ),
                "",
            ),
            method=method,
        )
        headers.update(
            {
                "X-S": signs["x-s"],
                "X-T": signs["x-t"],
                "x-S-Common": signs["x-s-common"],
                "X-B3-Traceid": signs["x-b3-traceid"],
            }
        )
        return headers

    async def request(
        self,
        method: str,
        url: str,
        *,
        return_response: bool = False,
        unwrap: bool = True,
        **kwargs: Any,
    ) -> Any:
        """执行单次请求；不重试、不切换代理、不处理分页。"""
        kwargs.setdefault("headers", self.headers)

        async def send():
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                return await client.request(method, url, **kwargs)

        response = await self.request_budget(send)

        if response.status_code in {401, 403, 429}:
            error = PlatformAccessError(
                f"XHS request blocked with HTTP {response.status_code}"
            )
            error.status_code = response.status_code
            raise error
        if response.status_code in {461, 471}:
            error = PlatformAccessError("XHS requires a user verification step")
            error.status_code = response.status_code
            raise error
        response.raise_for_status()

        if return_response:
            return response.text

        try:
            data = response.json()
        except (TypeError, ValueError) as error:
            raise DataFetchError("XHS response is not valid JSON") from error
        if not isinstance(data, dict):
            raise DataFetchError("XHS response must be a JSON object")

        code = str(data.get("code", ""))
        if code == str(self.IP_ERROR_CODE):
            raise IPBlockError("XHS network access was rejected")
        if code == str(self.SECURITY_LIMIT_CODE):
            raise PlatformAccessError("XHS account security restriction")
        if not unwrap:
            return data
        if data.get("success"):
            return data.get("data", data.get("success", {}))
        if data.get("code") in (self.NOTE_NOT_FOUND_CODE, self.NOTE_ABNORMAL_CODE):
            raise NoteNotFoundError("XHS note not found or abnormal")
        raise DataFetchError(str(data.get("msg") or "XHS request failed"))

    @staticmethod
    def _build_query_string(params: Dict) -> str:
        """保持上游对逗号的编码规则，以便签名与请求一致。"""
        parts = []
        for key, value in params.items():
            value_str = str(value) if value is not None else ""
            parts.append(f"{key}={quote(value_str, safe=',')}")
        return "&".join(parts)

    async def get(self, uri: str, params: Optional[Dict] = None) -> Dict:
        headers = await self._pre_headers(
            uri,
            params if params is not None else {},
        )
        full_url = f"{self._host}{uri}"
        if params:
            full_url = f"{full_url}?{self._build_query_string(params)}"
        return await self.request("GET", full_url, headers=headers)

    async def post(self, uri: str, data: dict) -> Dict:
        headers = await self._pre_headers(uri, payload=data)
        json_str = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        return await self.request(
            "POST",
            f"{self._host}{uri}",
            data=json_str,
            headers=headers,
        )

    async def query_self(self) -> Dict:
        """查询当前账号状态，不触发重新登录。"""
        uri = "/api/sns/web/v1/user/selfinfo"
        headers = await self._pre_headers(uri, params={})

        async def send():
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                return await client.get(f"{self._host}{uri}", headers=headers)

        response = await self.request_budget(send)
        response.raise_for_status()
        try:
            payload = response.json()
        except (TypeError, ValueError):
            raise DataFetchError("XHS account response is not valid JSON")
        if not isinstance(payload, dict):
            raise DataFetchError("XHS account response must be a JSON object")
        if payload.get("success") is not True:
            code = str(payload.get("code", ""))
            if code == str(self.IP_ERROR_CODE):
                raise IPBlockError("XHS network access was rejected")
            if code == str(self.SECURITY_LIMIT_CODE):
                raise PlatformAccessError("XHS account security restriction")
            raise DataFetchError(str(payload.get("msg") or "XHS account check failed"))
        data = payload.get("data")
        result = data.get("result") if isinstance(data, dict) else None
        if not isinstance(result, dict) or type(result.get("success")) is not bool:
            raise DataFetchError("XHS account response has an invalid login status")
        return payload

    async def pong(self) -> bool:
        """检查已提供 Cookie 是否仍可访问账号自检接口。"""
        self_info = await self.query_self()
        return self_info["data"]["result"]["success"]

    async def get_note_by_id(
        self,
        note_id: str,
        xsec_source: str,
        xsec_token: str,
    ) -> Dict:
        if xsec_source == "":
            xsec_source = "pc_search"
        data = {
            "source_note_id": note_id,
            "image_formats": ["jpg", "webp", "avif"],
            "extra": {"need_body_topic": 1},
            "xsec_source": xsec_source,
            "xsec_token": xsec_token,
        }
        result = await self.post("/api/sns/web/v1/feed", data)
        items = result.get("items") if isinstance(result, dict) else None
        if items and isinstance(items[0], dict):
            note_card = items[0].get("note_card")
            return note_card if isinstance(note_card, dict) else {}
        return {}

    async def get_note_comments(
        self,
        note_id: str,
        xsec_token: str,
        cursor: str = "",
    ) -> Dict:
        """只请求一页一级评论；调用方负责上限和下一页预算。"""
        params = {
            "note_id": note_id,
            "cursor": cursor,
            "top_comment_id": "",
            "image_formats": "jpg,webp,avif",
            "xsec_token": xsec_token,
        }
        return await self.get("/api/sns/web/v2/comment/page", params)

    async def get_note_by_id_from_html(
        self,
        note_id: str,
        xsec_source: str,
        xsec_token: str,
        enable_cookie: bool = False,
    ) -> Optional[Dict]:
        """按需从笔记 HTML 提取详情字段，不请求作者资料。"""
        url = (
            f"{self._domain}/explore/{note_id}"
            f"?xsec_token={xsec_token}&xsec_source={xsec_source}"
        )
        headers = {
            name: value
            for name, value in self.headers.items()
            if enable_cookie or name.casefold() != "cookie"
        }
        html = await self.request(
            "GET",
            url,
            return_response=True,
            headers=headers,
        )
        return self._extractor.extract_note_detail_from_html(note_id, html)
