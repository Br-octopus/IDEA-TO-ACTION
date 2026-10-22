# -*- coding: utf-8 -*-
# Copyright (c) 2025 relakkes@gmail.com
#
# This file is part of MediaCrawler project.
# Repository: https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/extractor.py
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
import re
from typing import Dict, Optional

import humps


class XiaoHongShuExtractor:
    def __init__(self):
        pass

    @staticmethod
    def _replace_bare_undefined(state: str) -> str:
        normalized = []
        in_string = False
        escaped = False
        previous_non_whitespace = ""
        index = 0

        while index < len(state):
            character = state[index]
            if in_string:
                normalized.append(character)
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == '"':
                    in_string = False
                index += 1
                continue

            if character == '"':
                in_string = True
                normalized.append(character)
                previous_non_whitespace = character
                index += 1
                continue

            if state.startswith("undefined", index):
                next_index = index + len("undefined")
                while next_index < len(state) and state[next_index].isspace():
                    next_index += 1
                next_non_whitespace = (
                    state[next_index] if next_index < len(state) else ""
                )
                if (
                    previous_non_whitespace in {":", ",", "["}
                    and next_non_whitespace in {",", "}", "]"}
                ):
                    normalized.append('""')
                    previous_non_whitespace = '"'
                    index += len("undefined")
                    continue

            normalized.append(character)
            if not character.isspace():
                previous_non_whitespace = character
            index += 1

        return "".join(normalized)

    def extract_note_detail_from_html(self, note_id: str, html: str) -> Optional[Dict]:
        """Extract note details from HTML

        Args:
            html (str): HTML string

        Returns:
            Dict: Note details dictionary
        """
        if "noteDetailMap" not in html:
            # Either a CAPTCHA appeared or the note doesn't exist
            return None

        match = re.search(r"window.__INITIAL_STATE__=({.*})</script>", html)
        if match is None:
            return None

        state = self._replace_bare_undefined(match.group(1))
        try:
            parsed_state = json.loads(state)
        except (json.JSONDecodeError, RecursionError):
            return None
        if not isinstance(parsed_state, dict) or not parsed_state:
            return None

        try:
            note_data = humps.decamelize(parsed_state)
        except RecursionError:
            return None
        if not isinstance(note_data, dict):
            return None
        note = note_data.get("note")
        if not isinstance(note, dict):
            return None
        note_detail_map = note.get("note_detail_map")
        if not isinstance(note_detail_map, dict):
            return None
        note_detail = note_detail_map.get(note_id)
        if not isinstance(note_detail, dict):
            return None
        note = note_detail.get("note")
        return note if isinstance(note, dict) else None
