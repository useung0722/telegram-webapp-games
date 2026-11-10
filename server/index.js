const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const {
  wallets,
  loadWallets,
  saveWallets,
  getWallet,
  formatKoreanNumber,
  parseAmountText,
  TITLE_DEFINITIONS,
  getAllTitlesForUser,
  checkAndUnlockTitles,
  getTopRankings
} = require('./wallet-manager');

const { WebHorseRaceEngine } = require('./race-engine');
const { WebAviatorEngine } = require('./aviator-engine');
const { SpyfallEngine } = require('./spyfall-engine');
const { getTodayMenu, voteLunch, getVotes } = require('./lunch-manager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function broadcast(event, data) {
  const payload = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// 게임 엔진 인스턴스 초기화
const raceEngine = new WebHorseRaceEngine(broadcast);
const aviatorEngine = new WebAviatorEngine(broadcast);
const spyfallEngine = new SpyfallEngine(broadcast);

raceEngine.createRace('global');
aviatorEngine.createFlight('global');

// ==========================================
// 📡 REST API 엔드포인트
// ==========================================

// 1. 유저 지갑 / 칭호 조회
app.get('/api/wallet', (req, res) => {
  const userId = req.query.userId || 'guest';
  const name = req.query.name || '손님';
  const w = getWallet(userId, name);
  checkAndUnlockTitles(w);
  const titles = getAllTitlesForUser(w);

  res.json({
    ok: true,
    wallet: {
      userId,
      name: w.name,
      points: w.points,
      formattedPoints: formatKoreanNumber(w.points),
      activeTitle: w.activeTitle,
      wins: w.wins || 0,
      raceCount: w.raceCount || 0,
      unlockedTitles: w.unlockedTitles || []
    },
    allTitles: titles.map(t => ({
      id: t.id,
      name: t.name,
      cleanName: t.cleanName,
      desc: t.desc,
      unlocked: (w.unlockedTitles || []).includes(t.id)
    }))
  });
});

// 2. 칭호 장착
app.post('/api/wallet/title', (req, res) => {
  const { userId, titleId } = req.body;
  const w = wallets[userId];
  if (!w) return res.status(404).json({ ok: false, error: '지갑을 찾을 수 없습니다.' });

  const allTitles = getAllTitlesForUser(w);
  const target = allTitles.find(t => t.id === titleId);
  if (!target) return res.status(400).json({ ok: false, error: '존재하지 않는 칭호입니다.' });

  if (!w.unlockedTitles.includes(titleId)) {
    return res.status(403).json({ ok: false, error: '아직 해금되지 않은 칭호입니다.' });
  }

  w.activeTitle = target.cleanName;
  saveWallets();
  res.json({ ok: true, activeTitle: w.activeTitle });
});

// 3. 구걸 (알바)
app.post('/api/wallet/beg', (req, res) => {
  const { userId, name } = req.body;
  const w = getWallet(userId, name);
  const now = Date.now();

  if (w.points >= 50000) {
    return res.status(400).json({
      ok: false,
      error: `아직 ${formatKoreanNumber(w.points)} P가 남아있습니다! (50,000 P 미만 시 가능)`
    });
  }

  if (now - (w.lastBeg || 0) < 10000) {
    const remainSec = Math.ceil((10000 - (now - w.lastBeg)) / 1000);
    return res.status(429).json({ ok: false, error: `알바 쿨타임 중입니다 (${remainSec}초 후 가능)` });
  }

  w.points += 50000;
  w.lastBeg = now;
  w.begCount = (w.begCount || 0) + 1;
  checkAndUnlockTitles(w);
  saveWallets();

  res.json({
    ok: true,
    points: w.points,
    formattedPoints: formatKoreanNumber(w.points),
    message: '+50,000 P 충전 완료!'
  });
});

// 4. 부자 랭킹 TOP 10
app.get('/api/ranking', (req, res) => {
  res.json({ ok: true, rankings: getTopRankings(10) });
});

// 5. 점심 식단 조회 및 투표
app.get('/api/lunch', async (req, res) => {
  const result = await getTodayMenu();
  if (!result.ok) {
    return res.status(500).json(result);
  }
  const dateKey = result.day ? `${result.day.date}_${result.day.dow}` : 'today';
  res.json({
    ok: true,
    day: result.day,
    votes: getVotes(dateKey)
  });
});

app.post('/api/lunch/vote', (req, res) => {
  const { date, corner, userId } = req.body;
  if (!date || !corner || !userId) {
    return res.status(400).json({ ok: false, error: '잘못된 파라미터입니다.' });
  }
  const updatedVotes = voteLunch(date, corner, userId);
  broadcast('lunch_voted', { date, votes: updatedVotes });
  res.json({ ok: true, votes: updatedVotes });
});

// 6. 현재 게임 상태 스냅샷
app.get('/api/games/status', (req, res) => {
  const currentRace = raceEngine.getCurrentRace('global');
  const currentFlight = aviatorEngine.getCurrentFlight('global');

  res.json({
    ok: true,
    race: currentRace ? raceEngine.sanitizeRace(currentRace) : null,
    aviator: currentFlight ? aviatorEngine.sanitizeFlight(currentFlight) : null
  });
});

// ==========================================
// 🔌 WebSocket 실시간 핸들러
// ==========================================
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const currentRace = raceEngine.getCurrentRace('global');
  const currentFlight = aviatorEngine.getCurrentFlight('global');
  ws.send(JSON.stringify({
    event: 'init_state',
    data: {
      race: currentRace ? raceEngine.sanitizeRace(currentRace) : null,
      aviator: currentFlight ? aviatorEngine.sanitizeFlight(currentFlight) : null
    }
  }));

  ws.on('message', (messageStr) => {
    try {
      const { type, payload } = JSON.parse(messageStr);
      const user = payload.user || { id: 'guest', name: '익명' };

      if (type === 'race_bet') {
        const { horseId, amount, isAllIn } = payload;
        const result = raceEngine.placeBet('global', user, horseId, amount, isAllIn);
        ws.send(JSON.stringify({ event: 'race_bet_result', data: result }));
      }

      if (type === 'aviator_bet') {
        const { amount, isAllIn } = payload;
        const result = aviatorEngine.placeBet('global', user, amount, isAllIn);
        ws.send(JSON.stringify({ event: 'aviator_bet_result', data: result }));
      }

      if (type === 'aviator_cashout') {
        const result = aviatorEngine.cashOut('global', user);
        ws.send(JSON.stringify({ event: 'aviator_cashout_result', data: result }));
      }

      if (type === 'reaction') {
        broadcast('reaction_event', {
          user: user.name,
          emoji: payload.emoji,
          lanePosition: payload.lanePosition || 'center' // 'left' | 'center' | 'right'
        });
      }

      if (type === 'chat') {
        broadcast('chat_message', {
          user: user.name,
          text: payload.text,
          time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        });
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, () => {
  console.log(`🌐 [Spyfall Suite Web Server] running on http://localhost:${PORT}`);
});
