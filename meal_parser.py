#!/usr/bin/env python3
"""welliv 식단표 파서 — 오늘(또는 지정일) 중식 메뉴 추출.

구조: 날짜 행마다 <td> 안에 중첩 테이블이 있고, 각 중첩 테이블이
조식 → 중식 → 석식 순서. 코너 라벨(A(한식), 건강식, B(양식) 등)은
style3 span으로 표시되므로 그 기준으로 코너를 나눈다.

사용:
  python3 meal_parser.py           # 오늘 중식
  python3 meal_parser.py --json    # JSON
  python3 meal_parser.py --all     # 오늘 3식 전체
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

URL = "http://m.welliv.co.kr/mobile/mealmenu_list.jsp"
KST = timezone(timedelta(hours=9))

CORNER_RE = re.compile(r"\d{1,2}/\d{1,2}\s*<br>|\n")


def fetch_html() -> str:
    req = urllib.request.Request(
        URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
            "Accept-Language": "ko-KR,ko;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        raw = r.read()
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def strip_tags(chunk: str) -> str:
    chunk = re.sub(r"<img[^>]*>", "", chunk)
    chunk = re.sub(r"<[^>]+>", "\n", chunk)
    return (chunk.replace("&nbsp;", " ").replace("&amp;", "&")
                 .replace("&lt;", "<").replace("&gt;", ">"))


def parse_nested_table(table_html: str) -> list[dict]:
    """중첩 테이블 하나(조식 또는 중식 또는 석식)를 코너별 메뉴로 변환."""
    corners: list[dict] = []
    # 코너 라벨 위치 기준으로 분할
    parts = re.split(r"(<span class='style3'>.*?</span>)", table_html, flags=re.S)
    current = {"corner": "", "items": []}
    for part in parts:
        if part.startswith("<span class='style3'>"):
            label = strip_tags(part).strip()
            label = re.sub(r"\s+", " ", label)
            if current["items"]:
                corners.append(current)
            current = {"corner": label, "items": []}
        else:
            for line in strip_tags(part).split("\n"):
                line = line.strip()
                if not line or len(line) > 60:
                    continue
                if re.fullmatch(r"[\d/()\s월화수목금토일]+", line):
                    continue
                current["items"].append(line)
    if current["items"]:
        corners.append(current)
    return corners


def parse(html: str) -> list[dict]:
    """날짜별 조식/중식/석식 파싱."""
    days: list[dict] = []
    # 날짜 셀: <center>10/30<br>(금)</center>
    date_iter = list(re.finditer(
        r"<center>\s*(\d{1,2}/\d{1,2})\s*<br>\s*\(([월화수목금토일])\)\s*</center>", html))
    for idx, m in enumerate(date_iter):
        date_s, dow = m.group(1), m.group(2)
        start = m.end()
        end = date_iter[idx + 1].start() if idx + 1 < len(date_iter) else len(html)
        body = html[start:end]
        # 중첩 테이블 3개(조식/중식/석식)
        tables = re.findall(r"<table[^>]*>(.*?)</table>", body, re.S)
        meals = [parse_nested_table(t) for t in tables[:3]]
        while len(meals) < 3:
            meals.append([])
        days.append({
            "date": date_s,
            "dow": dow,
            "breakfast": meals[0],
            "lunch": meals[1],
            "dinner": meals[2],
        })
    return days


def today_menu(days: list[dict]) -> dict | None:
    now = datetime.now(KST)
    key = f"{now.month}/{now.day}"
    for d in days:
        if d["date"] == key:
            return d
    return days[0] if days else None


def format_corners(corners: list[dict]) -> list[str]:
    out: list[str] = []
    for c in corners:
        if not c["items"]:
            continue
        label = c["corner"] or "메뉴"
        out.append(f"<b>{label}</b>")
        out.extend(f"• {item}" for item in c["items"])
        out.append("")
    return out


def format_message(day: dict | None, show_all: bool = False) -> str:
    if not day:
        return "🍱 오늘 식단 정보를 찾지 못했습니다."
    now = datetime.now(KST)
    lines = [f"🍱 <b>{now.month}월 {now.day}일 ({day['dow']}) 중식 메뉴</b>", ""]
    lunch = format_corners(day["lunch"])
    lines += lunch if lunch else ["• 등록된 중식 메뉴가 없습니다.", ""]
    if show_all:
        for key, name in (("breakfast", "조식"), ("dinner", "석식")):
            body = format_corners(day[key])
            if body:
                lines += [f"<b>── {name} ──</b>", *body]
    lines.append("<i>출처: welliv 식단표</i>")
    return "\n".join(lines)


def main() -> int:
    as_json = "--json" in sys.argv
    show_all = "--all" in sys.argv
    try:
        html = fetch_html()
        days = parse(html)
        day = today_menu(days)
    except Exception as e:
        if as_json:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
        else:
            print(f"⚠️ 식단표를 불러오지 못했습니다: {e}")
        return 1

    if as_json:
        print(json.dumps(day or {}, ensure_ascii=False, indent=2))
    else:
        print(format_message(day, show_all))
    return 0


if __name__ == "__main__":
    sys.exit(main())
