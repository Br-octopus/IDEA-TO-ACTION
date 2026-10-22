# -*- coding: utf-8 -*-
# Copyright (c) 2025 relakkes@gmail.com
#
# This file is part of MediaCrawler project.
# Repository: https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/bilibili/client.py
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

# -*- coding: utf-8 -*-
# @Author  : relakkes@gmail.com
# @Time    : 2023/12/2 18:44
# @Desc    : bilibili request client

from typing import Any, Awaitable, Callable, Dict, Optional, Tuple, Union
from urllib.parse import urlencode, urlsplit

import httpx

from .exception import DataFetchError
from .field import CommentOrderType
from .help import BilibiliSign


class BilibiliClient:
    """仅保留单次视频详情、单页一级评论和登录状态检查。"""

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
        self._host = "https://api.bilibili.com"
        self._wbi_keys: Optional[Tuple[str, str]] = None

    async def request(self, method: str, url: str, **kwargs: Any) -> Any:
        """执行单次请求，不重试、不使用代理，也不自动分页。"""
        headers = kwargs.pop("headers", self.headers)

        async def send():
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                return await client.request(method, url, headers=headers, **kwargs)

        response = await self.request_budget(send)
        response.raise_for_status()
        try:
            payload = response.json()
        except (TypeError, ValueError) as error:
            raise DataFetchError("Bilibili response is not valid JSON") from error
        if not isinstance(payload, dict):
            raise DataFetchError("Bilibili response must be a JSON object")
        if payload.get("code") != 0:
            raise DataFetchError(str(payload.get("message") or "Bilibili request failed"))
        return payload.get("data", {})

    @staticmethod
    def _extract_wbi_key(url: Any, field_name: str) -> str:
        if not isinstance(url, str):
            raise DataFetchError(f"Bilibili WBI {field_name} must be a string")
        try:
            parsed_url = urlsplit(url)
            hostname = parsed_url.hostname
            _ = parsed_url.port
        except ValueError as error:
            raise DataFetchError(
                f"Bilibili WBI {field_name} is not a valid URL"
            ) from error

        filename = parsed_url.path.rsplit("/", 1)[-1]
        if (
            parsed_url.scheme not in {"http", "https"}
            or not hostname
            or any(character.isspace() for character in parsed_url.netloc)
            or "." not in filename
        ):
            raise DataFetchError(f"Bilibili WBI {field_name} has an invalid structure")

        key, extension = filename.rsplit(".", 1)
        if (
            len(key) != 32
            or not extension
            or any(character not in "0123456789abcdefABCDEF" for character in key)
        ):
            raise DataFetchError(f"Bilibili WBI {field_name} has an invalid key")
        return key

    async def get_wbi_keys(self) -> Tuple[str, str]:
        """从导航接口读取签名键；只缓存当前客户端生命周期内的键。"""
        if self._wbi_keys:
            return self._wbi_keys
        navigation = await self.request(
            "GET",
            f"{self._host}/x/web-interface/nav",
        )
        if not isinstance(navigation, dict):
            raise DataFetchError("Bilibili navigation data must be a JSON object")
        wbi_img = navigation.get("wbi_img")
        if not isinstance(wbi_img, dict):
            raise DataFetchError("Bilibili navigation response has invalid wbi_img")

        self._wbi_keys = (
            self._extract_wbi_key(wbi_img.get("img_url"), "img_url"),
            self._extract_wbi_key(wbi_img.get("sub_url"), "sub_url"),
        )
        return self._wbi_keys

    async def pre_request_data(self, req_data: Optional[Dict]) -> Dict:
        if not req_data:
            return {}
        img_key, sub_key = await self.get_wbi_keys()
        return BilibiliSign(img_key, sub_key).sign(dict(req_data))

    async def get(
        self,
        uri: str,
        params: Optional[Dict] = None,
        enable_params_sign: bool = True,
    ) -> Dict:
        final_uri = uri
        if enable_params_sign:
            params = await self.pre_request_data(params)
        if isinstance(params, dict) and params:
            final_uri = f"{uri}?{urlencode(params)}"
        return await self.request("GET", f"{self._host}{final_uri}")

    async def pong(self) -> bool:
        """检查当前 Cookie 的账号登录状态，不发起登录流程。"""
        response = await self.get(
            "/x/web-interface/nav",
            enable_params_sign=False,
        )
        if not isinstance(response, dict) or type(response.get("isLogin")) is not bool:
            raise DataFetchError("Bilibili navigation response has an invalid login status")
        return response["isLogin"]

    async def get_video_info(
        self,
        aid: Optional[Union[int, str]] = None,
        bvid: Optional[str] = None,
    ) -> Dict:
        if not aid and not bvid:
            raise ValueError("Please provide at least one parameter: aid or bvid")
        params: Dict[str, Union[int, str]] = {}
        if aid:
            params["aid"] = aid
        else:
            params["bvid"] = bvid  # type: ignore[assignment]
        return await self.get(
            "/x/web-interface/view/detail",
            params,
            enable_params_sign=False,
        )

    async def get_video_comments(
        self,
        video_id: str,
        order_mode: CommentOrderType = CommentOrderType.DEFAULT,
        next: Union[int, str] = 0,
    ) -> Dict:
        """只请求一页一级评论；不展开楼中楼。"""
        params = {
            "oid": video_id,
            "mode": order_mode.value,
            "type": 1,
            "ps": 20,
            "next": next,
        }
        return await self.get("/x/v2/reply/wbi/main", params)
