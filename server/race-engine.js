const fs = require('fs');
const path = require('path');
const { getWallet, saveWallets, formatKoreanNumber, checkAndUnlockTitles } = require('./wallet-manager');

const HORSE_STATS_FILE = path.join(__dirname, '..', 'horse_stats.json');
let horseStats = {};
try {
  if (fs.existsSync(HORSE_STATS_FILE)) {
    horseStats = JSON.parse(fs.readFileSync(HORSE_STATS_FILE, 'utf8'));
  }
} catch (e) {
  horseStats = {};
}

function saveHorseStats() {
  try {
    fs.writeFileSync(HORSE_STATS_FILE, JSON.stringify(horseStats, null, 2), 'utf8');
  } catch (e) {}
}

const RACER_POOL = [
  { name: '치타', emoji: '🐆', title: '총알탄치타', dept: '신사업전략실', trait: '선행도주', desc: '초반 폭발적 질주, 후반 체력 방전 위험', odds: 1.8 },
  { name: '경주마', emoji: '🐎', title: '야근탈출마', dept: '인재개발팀', trait: '정통선입', desc: '기복 없이 꾸준한 스피드와 안정적인 페이스', odds: 2.2 },
  { name: '호랑이', emoji: '🐅', title: '어흥맹호', dept: '글로벌영업본부', trait: '추입위압', desc: '포효로 옆 라인 동물을 주춤하게 만들며 추격', odds: 2.5 },
  { name: '늑대', emoji: '🐺', title: '추격늑대', dept: '경영감사실', trait: '추입근성', desc: '앞선 주자가 보이면 광폭화하여 맹추격', odds: 3.2 },
  { name: '토끼', emoji: '🐇', title: '도발토끼', dept: '커뮤니케이션팀', trait: '도주낮잠', desc: '미친 듯한 뜀박질! 하지만 갑자기 잠들 수도 있음', odds: 3.8 },
  { name: '돼지', emoji: '🐖', title: '폭식돈돈', dept: '재무회계팀', trait: '중반돌파', desc: '느릿하다가 바나나/간식을 보면 돌진', odds: 4.5 },
  { name: '거북이', emoji: '🐢', title: '용궁거북', dept: '기획조정실', trait: '대기만성', desc: '결승선 직전 초특급 워프 부스터!', odds: 6.5 },
  { name: '달팽이', emoji: '🐌', title: '우주달팽이', dept: '연구개발원', trait: '우주초월', desc: '0칸 전진이 태반이지만 터지면 5칸 공간도약!', odds: 9.0 },
  { name: '새', emoji: '🕊️', title: '돌풍참새', dept: '항공물류TF', trait: '일도양단비행', desc: '10% 확률로 결승선까지 다이렉트 비행!', odds: 12.0 },
  { name: '원숭이', emoji: '🐒', title: '바나나원숭', dept: '마케팅랩', trait: '주변방해공격', desc: '35% 확률로 다른 동물에게 바나나 껍질 투척!', odds: 3.6 },
  { name: '가재', emoji: '🦞', title: '유턴가재', dept: '품질관리팀', trait: '뒤걸음질역주행', desc: '폭풍 질주 또는 30% 확률로 역주행(-2칸)!', odds: 5.5 },
  { name: '치와와', emoji: '🐕', title: '광견치와와', dept: '보안안전팀', trait: '부정출발망나니', desc: '시작하자마자 4칸 부정출발! 후반 탈진', odds: 4.2 }
];

function getHorseCurrentOdds(racer) {
  const stat = horseStats[racer.name] || { wins: 0, losses: 0 };
  const total = (stat.wins || 0) + (stat.losses || 0);
  if (total < 3) return racer.odds;
  const winRate = stat.wins / total;
  const dynamicOdds = winRate > 0 ? (1 / winRate) * 0.95 : 15.0;
  const clamped = Math.max(1.2, Math.min(25.0, dynamicOdds));
  return Math.round(clamped * 10) / 10;
}

// 시드 기반 32비트 난수 생성기
function mulberry32(a) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

class WebHorseRaceEngine {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn;
    this.FINISH_LINE = 15; // 엑셀 세로 15행
    this.BETTING_DURATION_MS = 25000; // 25초 배팅 카운트다운
    this.races = {};
    this.raceCounter = 101;
  }

  getCurrentRace(roomId = 'global') {
    return this.races[roomId] || null;
  }

  createRace(roomId = 'global') {
    if (this.races[roomId] && this.races[roomId].state !== 'finished') {
      return this.races[roomId];
    }

    const shuffled = [...RACER_POOL].sort(() => Math.random() - 0.5);
    const selectedRacers = shuffled.slice(0, 3);
    const seed = Math.floor(Math.random() * 900000) + 100000;
    const now = Date.now();

    // 60FPS 세로 물리 타임라인 사전 시뮬레이션
    const rnd = mulberry32(seed);
    const DT = 1 / 60;
    const profiles = selectedRacers.map(r => ({
      name: r.name,
      pos: 0,
      vel: 0.15,
      baseSpeed: 1.1 + rnd() * 0.15,
      effect: ''
    }));

    let winnerIdx = -1;
    let finishTime = 0;
    const MAX_STEPS = 60 * 35;
    const timeline = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const curTime = step * DT;
      for (let i = 0; i < 3; i++) {
        const p = profiles[i];
        if (p.pos >= this.FINISH_LINE) continue;

        let targetSpeed = p.baseSpeed;
        if (p.name === '치타') targetSpeed = curTime < 4.5 ? 2.2 : 0.82;
        else if (p.name === '경주마') targetSpeed = 1.25 + Math.sin(curTime * 1.5) * 0.12;
        else if (p.name === '호랑이') { if (curTime > 3 && curTime < 6) { targetSpeed = 1.75; p.effect = '🔥'; } }
        else if (p.name === '늑대') { targetSpeed = curTime > 5 ? 1.65 : 0.95; if (curTime > 5) p.effect = '🌪️'; }
        else if (p.name === '토끼') { const cycle = curTime % 4; targetSpeed = cycle < 2.5 ? 1.7 : 0.35; p.effect = cycle >= 2.5 ? '💤' : '💨'; }
        else if (p.name === '돼지') targetSpeed = 1.15;
        else if (p.name === '거북이') { if (curTime < 6.5) targetSpeed = 0.55; else { targetSpeed = 2.45; p.effect = '🚀'; } }
        else if (p.name === '달팽이') { targetSpeed = (curTime > 7 && curTime < 9.5) ? 2.8 : 0.45; if (curTime > 7 && curTime < 9.5) p.effect = '⚡️'; }
        else if (p.name === '새') { targetSpeed = (curTime > 5 && rnd() < 0.6) ? 3.0 : 0.35; if (targetSpeed > 2.0) p.effect = '🦅'; }
        else if (p.name === '원숭이') targetSpeed = 1.2 + Math.cos(curTime * 2) * 0.25;
        else if (p.name === '가재') targetSpeed = 1.35;
        else if (p.name === '치와와') { targetSpeed = curTime < 2 ? 2.4 : 1.0; if (curTime < 2) p.effect = '🚨'; }

        targetSpeed += (rnd() - 0.5) * 0.12;
        p.vel += (targetSpeed - p.vel) * 0.08;
        p.pos += p.vel * DT;
      }

      for (let i = 0; i < 3; i++) {
        if (profiles[i].pos >= this.FINISH_LINE && winnerIdx === -1) {
          winnerIdx = i;
          finishTime = curTime;
        }
      }

      timeline.push({
        t: Math.round(curTime * 100) / 100,
        positions: [profiles[0].pos, profiles[1].pos, profiles[2].pos]
      });

      if (winnerIdx !== -1 && curTime > finishTime + 0.8) break;
    }

    const winner = selectedRacers[winnerIdx !== -1 ? winnerIdx : 0];
    const totalDuration = timeline[timeline.length - 1].t;

    const race = {
      roomId,
      raceNo: this.raceCounter++,
      seed,
      state: 'betting', // 'betting' | 'racing' | 'finished'
      createdAt: now,
      startTime: now + this.BETTING_DURATION_MS,
      horses: selectedRacers.map((r, idx) => ({
        id: idx + 1,
        name: r.name,
        emoji: r.emoji,
        title: r.title,
        dept: r.dept,
        odds: getHorseCurrentOdds(r),
        pos: 0
      })),
      bets: {},
      winnerIdx: (winnerIdx !== -1 ? winnerIdx : 0),
      winnerRacer: winner,
      totalDuration,
      raceDurationMs: Math.round(totalDuration * 1000)
    };

    this.races[roomId] = race;
    this.broadcast('excel_race_created', this.sanitizeRace(race));

    // 배팅 마감 카운트다운 타이머
    race.timer = setTimeout(() => {
      this.startRace(roomId);
    }, this.BETTING_DURATION_MS);

    return race;
  }

  placeBet(roomId, user, horseId, amount, isAllIn = false) {
    const race = this.races[roomId];
    if (!race || race.state !== 'betting') {
      return { ok: false, error: '현재 배팅 가능한 세로 시트 경기가 없습니다.' };
    }

    const horse = race.horses.find(h => h.id === horseId);
    if (!horse) {
      return { ok: false, error: '올바르지 않은 동물 번호입니다.' };
    }

    const wallet = getWallet(user.id, user.name);
    let betAmount = Math.floor(amount);
    if (isAllIn) {
      betAmount = wallet.points;
    }

    if (betAmount < 1000) {
      return { ok: false, error: '최소 배팅 금액은 1,000 P 입니다.' };
    }
    if (wallet.points < betAmount) {
      return { ok: false, error: `잔액이 부족합니다. (현재: ${formatKoreanNumber(wallet.points)} P)` };
    }

    wallet.points -= betAmount;
    if (wallet.points === 0) wallet.bankruptHit = true;
    saveWallets();

    race.bets[user.id] = {
      userId: user.id,
      name: user.name,
      horseId,
      horseName: horse.name,
      amount: betAmount,
      isAllIn
    };

    this.broadcast('excel_race_bet_placed', {
      roomId,
      raceNo: race.raceNo,
      bet: race.bets[user.id],
      userWallet: { points: wallet.points, formatted: formatKoreanNumber(wallet.points) }
    });

    return { ok: true, bet: race.bets[user.id], currentPoints: wallet.points };
  }

  startRace(roomId) {
    const race = this.races[roomId];
    if (!race || race.state !== 'betting') return;

    if (race.timer) clearTimeout(race.timer);
    race.state = 'racing';
    race.racingStartedAt = Date.now();

    this.broadcast('excel_race_started', {
      roomId,
      raceNo: race.raceNo,
      seed: race.seed,
      startedAt: race.racingStartedAt,
      durationMs: race.raceDurationMs
    });

    // 레이스 완주 시간에 맞춰 정산
    setTimeout(() => {
      this.finishRace(roomId, race);
    }, race.raceDurationMs + 500);
  }

  finishRace(roomId, race) {
    race.state = 'finished';
    const winner = race.horses[race.winnerIdx];

    // 스탯 업데이트
    for (const h of race.horses) {
      if (!horseStats[h.name]) horseStats[h.name] = { wins: 0, losses: 0 };
      if (h.id === winner.id) {
        horseStats[h.name].wins = (horseStats[h.name].wins || 0) + 1;
      } else {
        horseStats[h.name].losses = (horseStats[h.name].losses || 0) + 1;
      }
    }
    saveHorseStats();

    // 배팅 정산
    const payouts = [];
    for (const [userId, bet] of Object.entries(race.bets)) {
      const wallet = getWallet(userId, bet.name);
      wallet.raceCount = (wallet.raceCount || 0) + 1;

      if (bet.horseId === winner.id) {
        const payout = Math.floor(bet.amount * winner.odds);
        const profit = payout - bet.amount;
        wallet.points += payout;
        wallet.wins = (wallet.wins || 0) + 1;
        if (winner.odds > (wallet.maxOdds || 0)) wallet.maxOdds = winner.odds;
        if (profit > (wallet.maxProfit || 0)) wallet.maxProfit = profit;
        if (bet.isAllIn) wallet.allInWon = true;

        payouts.push({
          userId,
          name: bet.name,
          won: true,
          payout,
          profit,
          formattedPayout: formatKoreanNumber(payout)
        });
      } else {
        payouts.push({
          userId,
          name: bet.name,
          won: false,
          payout: 0,
          profit: -bet.amount,
          formattedPayout: '0'
        });
      }
      checkAndUnlockTitles(wallet);
      saveWallets();
    }

    this.broadcast('excel_race_finished', {
      roomId,
      raceNo: race.raceNo,
      winner: {
        id: winner.id,
        name: winner.name,
        emoji: winner.emoji,
        dept: winner.dept,
        odds: winner.odds
      },
      payouts
    });

    // 10초 후 다음 세로 엑셀 레이스 자동 오픈
    setTimeout(() => {
      this.createRace(roomId);
    }, 10000);
  }

  sanitizeRace(race) {
    return {
      roomId: race.roomId,
      raceNo: race.raceNo,
      seed: race.seed,
      state: race.state,
      startTime: race.startTime,
      durationMs: race.raceDurationMs,
      horses: race.horses.map(h => ({
        id: h.id,
        name: h.name,
        emoji: h.emoji,
        title: h.title,
        dept: h.dept,
        odds: h.odds
      })),
      betsCount: Object.keys(race.bets).length
    };
  }
}

module.exports = {
  WebHorseRaceEngine,
  RACER_POOL
};
