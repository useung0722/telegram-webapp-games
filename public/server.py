#!/usr/bin/env python3
"""
엑셀 경마 웹서버 + SSE (Server-Sent Events) 실시간 브로드캐스터
- 서버 시간 기반 1분 카운트다운 동기화
- 룸 상태 및 실시간 배팅/이모지 브로드캐스트
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

# raceId -> {"createdAt": int, "duration": 60, "bets": [], "horses": []}
rooms = {}
rooms_lock = threading.Lock()

WALLETS_FILE = os.path.join(DIRECTORY, "..", "wallets.json")
ACTIVE_RACES_FILE = os.path.join(DIRECTORY, "..", "active_races.json")

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

        # 1. SSE 실시간 이벤트 스트림
        if url.path == "/api/events":
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
        elif url.path == "/api/wallet":
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

        # 3. 서버 룸 동기화 정보 (서버 생성시간, 남은시간 등)
        elif url.path == "/api/room":
            query = parse_qs(url.query)
            race_id = query.get("race_id", ["default"])[0]
            now = int(time.time() * 1000)

            with rooms_lock:
                if race_id not in rooms:
                    rooms[race_id] = {
                        "createdAt": now,
                        "duration": 60, # 60초 배팅
                        "bets": []
                    }
                room = rooms[race_id]
                elapsed = (now - room["createdAt"]) / 1000.0
                remaining = max(0, room["duration"] - elapsed)
                resp = {
                    "race_id": race_id,
                    "server_time": now,
                    "created_at": room["createdAt"],
                    "duration": room["duration"],
                    "remaining_sec": remaining,
                    "is_started": remaining <= 0,
                    "bets": room["bets"]
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

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        payload = json.loads(body) if body else {}

        # 4. 실시간 응원 이모지 전송 (인스타 라이브)
        if url.path == "/api/reaction":
            race_id = str(payload.get("race_id", "default"))
            emoji = payload.get("emoji", "🔥")
            user_name = payload.get("user_name", "팀원")
            broadcast(race_id, "reaction", {
                "emoji": emoji,
                "user_name": user_name,
                "timestamp": time.time()
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"success": true}')
            return

        # 5. 시트 내 실시간 배팅 처리
        elif url.path == "/api/bet":
            race_id = str(payload.get("race_id", "default"))
            user_id = str(payload.get("user_id", ""))
            user_name = payload.get("user_name", "익명")
            horse_id = int(payload.get("horse_id", 1))
            amount = int(payload.get("amount", 1000))

            now = int(time.time() * 1000)
            with rooms_lock:
                if race_id in rooms:
                    elapsed = (now - rooms[race_id]["createdAt"]) / 1000.0
                    if elapsed >= rooms[race_id]["duration"]:
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

            with rooms_lock:
                if race_id not in rooms:
                    rooms[race_id] = {"createdAt": now, "duration": 60, "bets": []}
                rooms[race_id]["bets"].append(bet_record)

            # active_races.json에도 동기화 기록 (결과 정산 및 환불 안전 보장)
            try:
                if os.path.exists(ACTIVE_RACES_FILE):
                    with open(ACTIVE_RACES_FILE, "r", encoding="utf-8") as f:
                        active = json.load(f)
                    for chat_id, r in active.items():
                        if str(r.get("raceNo")) == race_id:
                            bets = r.get("bets", [])
                            # 기존 배팅 누적
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
                            r["bets"] = bets
                            break
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

        self.send_response(404)
        self.end_headers()

if __name__ == "__main__":
    server = ThreadingHTTPServer(("", PORT), RaceHandler)
    server.serve_forever()
