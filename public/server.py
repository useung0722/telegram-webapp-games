#!/usr/bin/env python3
"""
엑셀 경마 웹서버 + SSE (Server-Sent Events) 실시간 브로드캐스터
- active_races.json 기반 100% 실시간 동물 라인업/배당률/서버시간 동기화
"""
import os
import sys
import json
import time
import queue
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = 8083
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

subscribers = {}
subscribers_lock = threading.Lock()

WALLETS_FILE = os.path.join(DIRECTORY, "..", "wallets.json")
ACTIVE_RACES_FILE = os.path.join(DIRECTORY, "..", "active_races.json")

TITLE_DEFINITIONS = [
    {"id": "t_dirt", "name": "💸 흙수저 탈출", "cleanName": "흙수저 탈출", "desc": "잔액 150만 P 이상", "check": lambda w: w.get("points", 0) >= 1500000},
    {"id": "t_mid", "name": "💼 중산층", "cleanName": "중산층", "desc": "잔액 300만 P 이상", "check": lambda w: w.get("points", 0) >= 3000000},
    {"id": "t_rich", "name": "💰 백만장자", "cleanName": "백만장자", "desc": "잔액 1,000만 P 이상", "check": lambda w: w.get("points", 0) >= 10000000},
    {"id": "t_dia", "name": "💎 다이아 수저", "cleanName": "다이아 수저", "desc": "잔액 5,000만 P 이상", "check": lambda w: w.get("points", 0) >= 50000000},
    {"id": "t_mansour", "name": "👑 만수르", "cleanName": "만수르", "desc": "잔액 1억 P 이상", "check": lambda w: w.get("points", 0) >= 100000000},
    {"id": "t_first_win", "name": "🥉 경마 입문자", "cleanName": "경마 입문자", "desc": "경마 1위 3회 적중", "check": lambda w: w.get("wins", 0) >= 3},
    {"id": "t_god", "name": "🏇 승리의 베테랑", "cleanName": "승리의 베테랑", "desc": "경마 1위 20회 적중", "check": lambda w: w.get("wins", 0) >= 20},
    {"id": "t_legend", "name": "🦄 전설의 기수", "cleanName": "전설의 기수", "desc": "경마 1위 50회 적중", "check": lambda w: w.get("wins", 0) >= 50},
    {"id": "t_underdog", "name": "🎯 역배의 제왕", "cleanName": "역배의 제왕", "desc": "배당 10.0배 이상 적중", "check": lambda w: w.get("maxOdds", 0) >= 10.0},
    {"id": "t_miracle", "name": "⚡ 기적의 눈썰미", "cleanName": "기적의 눈썰미", "desc": "배당 30.0배 이상 적중", "check": lambda w: w.get("maxOdds", 0) >= 30.0},
    {"id": "t_jackpot", "name": "🎰 잭팟 마스터", "cleanName": "잭팟 마스터", "desc": "한 판에 100만 P 이상 수익", "check": lambda w: w.get("maxProfit", 0) >= 1000000},
    {"id": "t_bigwin", "name": "🌊 한강 뷰", "cleanName": "한강 뷰", "desc": "한 판에 1,000만 P 이상 수익", "check": lambda w: w.get("maxProfit", 0) >= 10000000},
    {"id": "t_bankrupt", "name": "☠️ 깡통 계좌", "cleanName": "깡통 계좌", "desc": "배팅 후 잔액 0 P 기록", "check": lambda w: bool(w.get("bankruptHit"))},
    {"id": "t_allin", "name": "🎲 인생 한방러", "cleanName": "인생 한방러", "desc": "올인 배팅 승리 경험", "check": lambda w: bool(w.get("allInWon"))},
    {"id": "t_gambler", "name": "🚨 도박 중독", "cleanName": "도박 중독", "desc": "경마 누적 50회 참여", "check": lambda w: w.get("raceCount", 0) >= 50},
    {"id": "t_vip", "name": "💎 마사회 VIP", "cleanName": "마사회 VIP", "desc": "경마 누적 150회 참여", "check": lambda w: w.get("raceCount", 0) >= 150},
    {"id": "t_cleaner", "name": "🧹 탕비실 반장", "cleanName": "탕비실 반장", "desc": "알바(구걸) 5회 달성", "check": lambda w: w.get("begCount", 0) >= 5},
    {"id": "t_worker", "name": "📦 쿠팡 에이스", "cleanName": "쿠팡 에이스", "desc": "알바(구걸) 15회 달성", "check": lambda w: w.get("begCount", 0) >= 15},
    {"id": "t_begking", "name": "🪙 동냥 마스터", "cleanName": "동냥 마스터", "desc": "알바(구걸) 30회 달성", "check": lambda w: w.get("begCount", 0) >= 30}
]

def check_and_unlock_titles(w):
    unlocked = w.get("unlockedTitles") or []
    for t in TITLE_DEFINITIONS:
        try:
            if t["id"] not in unlocked and t["check"](w):
                unlocked.append(t["id"])
        except Exception:
            pass
    w["unlockedTitles"] = unlocked
    return unlocked

def load_wallets():
    try:
        if os.path.exists(WALLETS_FILE):
            with open(WALLETS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def save_wallets(wallets):
    try:
        with open(WALLETS_FILE, "w", encoding="utf-8") as f:
            json.dump(wallets, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def load_active_races():
    try:
        if os.path.exists(ACTIVE_RACES_FILE):
            with open(ACTIVE_RACES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def broadcast(race_id, event_type, data):
    payload = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")
    with subscribers_lock:
        clients = subscribers.get(str(race_id), [])
        for q in list(clients):
            try:
                q.put_nowait(payload)
            except Exception:
                pass

class RaceHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        if path.startswith("/race"):
            path = path[5:]  # strip /race prefix

        # 1. SSE 실시간 이벤트 스트림
        if path == "/api/events":
            query = parse_qs(url.query)
            race_id = query.get("race_id", ["default"])[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            q = queue.Queue(maxsize=100)
            with subscribers_lock:
                if race_id not in subscribers:
                    subscribers[race_id] = []
                subscribers[race_id].append(q)

            try:
                self.wfile.write(b": ping\n\n")
                self.wfile.flush()

                while True:
                    try:
                        msg = q.get(timeout=20)
                        self.wfile.write(msg)
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
            except Exception:
                pass
            finally:
                with subscribers_lock:
                    if race_id in subscribers and q in subscribers[race_id]:
                        subscribers[race_id].remove(q)
            return

        # 2. 내 지갑 포인트 조회
        elif path == "/api/wallet":
            query = parse_qs(url.query)
            user_id = query.get("user_id", [""])[0]
            wallets = load_wallets()
            w = wallets.get(str(user_id), {"points": 10000, "name": "익명"})
            data = json.dumps(w, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return

        # 3. 서버 활성 레이스 상태 조회 (활성 레이스 파일 직접 조회)
        elif path == "/api/room":
            query = parse_qs(url.query)
            race_id = query.get("race_id", ["default"])[0]
            now = int(time.time() * 1000)

            active = load_active_races()
            matched_race = None
            for chat_id, r in active.items():
                if str(r.get("raceNo")) == str(race_id) or race_id == "latest" or race_id == "default":
                    matched_race = r
                    break

            if matched_race:
                created_at = matched_race.get("createdAt", now)
                seed = matched_race.get("seed", 123456)
                duration = 60 # 60초 배팅
                elapsed = (now - created_at) / 1000.0
                remaining = max(0, duration - elapsed)
                resp = {
                    "race_id": str(matched_race.get("raceNo")),
                    "seed": seed,
                    "server_time": now,
                    "created_at": created_at,
                    "duration": duration,
                    "remaining_sec": remaining,
                    "is_started": remaining <= 0 or matched_race.get("state") == "racing",
                    "horses": matched_race.get("horses", []),
                    "bets": matched_race.get("bets", [])
                }
            else:
                resp = {
                    "race_id": race_id,
                    "seed": 123456,
                    "server_time": now,
                    "created_at": now,
                    "duration": 60,
                    "remaining_sec": 60,
                    "is_started": False,
                    "horses": [],
                    "bets": []
                }

            data = json.dumps(resp, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return

        # 4. 부자 랭킹 TOP 10 조회
        elif path == "/api/ranking":
            wallets = load_wallets()
            sorted_wallets = sorted(wallets.values(), key=lambda x: x.get("points", 0), reverse=True)[:10]
            ranking = []
            for idx, item in enumerate(sorted_wallets):
                ranking.append({
                    "rank": idx + 1,
                    "name": item.get("name", "익명"),
                    "points": item.get("points", 0),
                    "activeTitle": item.get("activeTitle", "")
                })
            data = json.dumps(ranking, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return

        # 5. 사용자 칭호 목록 및 장착 상태 조회
        elif path == "/api/titles":
            query = parse_qs(url.query)
            user_id = query.get("user_id", [""])[0]
            wallets = load_wallets()
            w = wallets.get(str(user_id), {"points": 10000, "name": "익명"})
            unlocked = check_and_unlock_titles(w)
            wallets[str(user_id)] = w
            save_wallets(wallets)

            title_list = []
            for t in TITLE_DEFINITIONS:
                title_list.append({
                    "id": t["id"],
                    "name": t["name"],
                    "cleanName": t["cleanName"],
                    "desc": t["desc"],
                    "unlocked": t["id"] in unlocked
                })

            resp = {
                "activeTitle": w.get("activeTitle", ""),
                "unlockedCount": len(unlocked),
                "totalCount": len(TITLE_DEFINITIONS),
                "titles": title_list
            }
            data = json.dumps(resp, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return

        super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path
        if path.startswith("/race"):
            path = path[5:]  # strip /race prefix

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        payload = json.loads(body) if body else {}

        # 4. 실시간 응원 이모지 전송 (인스타 라이브)
        if path == "/api/reaction":
            race_id = str(payload.get("race_id", "default"))
            emoji = payload.get("emoji", "🔥")
            user_name = payload.get("user_name", "팀원")
            horse_id = int(payload.get("horse_id", 0))  # 1, 2, 3 or 0 (미지정)
            broadcast(race_id, "reaction", {
                "emoji": emoji,
                "user_name": user_name,
                "horse_id": horse_id,
                "timestamp": time.time()
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"success": true}')
            return

        # 4-1. 실시간 채팅 메시지 브로드캐스트
        elif path == "/api/chat":
            race_id = str(payload.get("race_id", "default"))
            user_name = payload.get("user_name", "익명")
            active_title = payload.get("active_title", "")
            text = (payload.get("text", "") or "").strip()[:60]
            horse_id = int(payload.get("horse_id", 0))

            if text:
                broadcast(race_id, "chat", {
                    "user_name": user_name,
                    "active_title": active_title,
                    "text": text,
                    "horse_id": horse_id,
                    "timestamp": time.time()
                })

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"success": true}')
            return

        # 5. 시트 내 실시간 배팅 처리
        elif path == "/api/bet":
            race_id = str(payload.get("race_id", "default"))
            user_id = str(payload.get("user_id", ""))
            user_name = payload.get("user_name", "익명")
            horse_id = int(payload.get("horse_id", 1))
            amount = int(payload.get("amount", 1000))

            active = load_active_races()
            matched_race = None
            matched_chat_id = None
            for chat_id, r in active.items():
                if str(r.get("raceNo")) == race_id or race_id == "latest":
                    matched_race = r
                    matched_chat_id = chat_id
                    break

            now = int(time.time() * 1000)
            if matched_race:
                created_at = matched_race.get("createdAt", now)
                elapsed = (now - created_at) / 1000.0
                if elapsed >= 60 or matched_race.get("state") == "racing":
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "message": "이미 배팅이 마감되었습니다!"}).encode("utf-8"))
                    return

            wallets = load_wallets()
            w = wallets.get(user_id, {"points": 10000, "name": user_name})
            if w.get("points", 0) < amount:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": "포인트가 부족합니다!"}).encode("utf-8"))
                return

            w["points"] -= amount
            wallets[user_id] = w
            save_wallets(wallets)

            bet_record = {
                "user_id": user_id,
                "user_name": user_name,
                "horse_id": horse_id,
                "amount": amount,
                "timestamp": time.time()
            }

            if matched_race and matched_chat_id:
                bets = matched_race.get("bets", [])
                found = False
                for b in bets:
                    if str(b[0]) == user_id:
                        b[1]["amount"] += amount
                        b[1]["horseId"] = horse_id
                        found = True
                        break
                if not found:
                    bets.append([user_id, {
                        "userId": user_id,
                        "name": user_name,
                        "horseId": horse_id,
                        "amount": amount,
                        "isAllIn": False
                    }])
                matched_race["bets"] = bets
                try:
                    with open(ACTIVE_RACES_FILE, "w", encoding="utf-8") as f:
                        json.dump(active, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass

            broadcast(race_id, "bet", bet_record)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "remain_points": w["points"]}).encode("utf-8"))
            return

        # 6. 구걸(탕비실 분리수거 알바) 처리
        elif path == "/api/beg":
            user_id = str(payload.get("user_id", ""))
            user_name = payload.get("user_name", "익명")
            if not user_id:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": "사용자 정보가 없습니다."}).encode("utf-8"))
                return

            wallets = load_wallets()
            w = wallets.get(user_id, {"points": 10000, "name": user_name})
            now = int(time.time() * 1000)

            if w.get("points", 0) >= 5000:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                msg = f"🙄 아직 {w.get('points', 0):,} P나 있으면서 구걸을 하시게요? 5,000 P 미만일 때만 가능합니다!"
                self.wfile.write(json.dumps({"success": False, "message": msg}).encode("utf-8"))
                return

            last_beg = w.get("lastBeg", 0)
            if now - last_beg < 10000:
                remain_sec = int(round((10000 - (now - last_beg)) / 1000))
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                msg = f"⏳ 탕비실 청소 알바 쿨타임 중입니다! ({remain_sec}초 후 가능)"
                self.wfile.write(json.dumps({"success": False, "message": msg}).encode("utf-8"))
                return

            w["points"] = w.get("points", 0) + 5000
            w["lastBeg"] = now
            w["begCount"] = w.get("begCount", 0) + 1
            w["name"] = user_name
            wallets[user_id] = w
            save_wallets(wallets)

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            msg = f"🧹 탕비실 분리수거 알바 완료! +5,000 P 충전되었습니다.\n현재 잔액: {w['points']:,} P"
            self.wfile.write(json.dumps({"success": True, "message": msg, "remain_points": w["points"]}).encode("utf-8"))
            return

        # 7. 칭호 장착 / 해제 처리
        elif path == "/api/title/equip":
            user_id = str(payload.get("user_id", ""))
            title_id = payload.get("title_id", "")
            action = payload.get("action", "equip") # "equip" 또는 "clear"

            if not user_id:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": "사용자 정보가 없습니다."}).encode("utf-8"))
                return

            wallets = load_wallets()
            w = wallets.get(user_id)
            if not w:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": "지갑 정보가 없습니다."}).encode("utf-8"))
                return

            unlocked = check_and_unlock_titles(w)

            if action == "clear":
                w["activeTitle"] = ""
                wallets[user_id] = w
                save_wallets(wallets)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "message": "칭호가 해제되었습니다.", "activeTitle": ""}).encode("utf-8"))
                return

            target_title = next((t for t in TITLE_DEFINITIONS if t["id"] == title_id), None)
            if not target_title:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": "존재하지 않는 칭호입니다."}).encode("utf-8"))
                return

            if title_id not in unlocked:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": f"🔒 아직 해금되지 않은 칭호입니다! ({target_title['desc']})"}).encode("utf-8"))
                return

            w["activeTitle"] = target_title["cleanName"]
            wallets[user_id] = w
            save_wallets(wallets)

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "message": f"[{target_title['name']}] 칭호가 장착되었습니다!",
                "activeTitle": target_title["cleanName"]
            }).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

if __name__ == "__main__":
    server = ThreadingHTTPServer(("", PORT), RaceHandler)
    server.serve_forever()
