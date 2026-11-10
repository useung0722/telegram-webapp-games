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
  {
    name: '치타',
    emoji: '🐆',
    title: '총알탄치타',
    trait: '선행도주',
    desc: '초반 폭발적 질주, 후반 체력 방전 위험',
    odds: 1.8,
    calcStep: (turn) => {
      if (turn <= 4) {
        const step = Math.random() < 0.75 ? 2 : 3;
        const effect = (step === 3) ? '💥' : '💨';
        const msg = (step === 3) ? '초반 폭풍 부스터 폭발!!' : '초반 질주!';
        return { step, effect, msg };
      } else {
        if (Math.random() < 0.1) return { step: 0, effect: '💦', msg: '혓바닥 내밀고 탈진...' };
        return { step: 1, effect: '━', msg: '지친 몸으로 터덜터덜' };
      }
    }
  },
  {
    name: '경주마',
    emoji: '🐎',
    title: '야근탈출마',
    trait: '정통선입',
    desc: '기복 없이 꾸준한 스피드와 안정적인 페이스',
    odds: 2.2,
    calcStep: () => {
      const r = Math.random();
      if (r < 0.25) return { step: 1, effect: '━', msg: '안정적인 레이스 페이스' };
      if (r < 0.75) return { step: 2, effect: '💨', msg: '힘찬 발걸음으로 추격!' };
      return { step: 3, effect: '🔥', msg: '기수의 채찍질에 가속 스퍼트!' };
    }
  },
  {
    name: '호랑이',
    emoji: '🐅',
    title: '어흥맹호',
    trait: '추입위압',
    desc: '포효로 옆 라인 동물을 주춤하게 만들며 추격',
    odds: 2.8,
    calcStep: (turn) => {
      if (Math.random() < 0.28) return { step: 2, effect: ' roar ', msg: '어흥! 포효로 다른 동물을 위협!' };
      if (turn >= 4 && Math.random() < 0.5) return { step: 3, effect: '🐾', msg: '맹수의 사냥 본능 발동!' };
      return { step: Math.random() < 0.5 ? 1 : 2, effect: '💨', msg: '위풍당당한 보폭' };
    }
  },
  {
    name: '늑대',
    emoji: '🐺',
    title: '추격늑대',
    trait: '추입근성',
    desc: '앞선 주자가 보이면 광폭화하여 맹추격',
    odds: 3.2,
    calcStep: (turn, h, allHorses) => {
      const maxProg = allHorses ? Math.max(...allHorses.map(x => x.progress)) : 0;
      if (h.progress < maxProg && Math.random() < 0.65) {
        return { step: 3, effect: '⚡️', msg: '선두를 쫓아 눈빛이 번뜩입니다!' };
      }
      return { step: Math.random() < 0.6 ? 2 : 1, effect: '💨', msg: '고독한 질주' };
    }
  },
  {
    name: '토끼',
    emoji: '🐇',
    title: '도발토끼',
    trait: '도주낮잠',
    desc: '미친 듯한 뜀박질! 하지만 갑자기 잠들 수도 있음',
    odds: 3.5,
    calcStep: (turn) => {
      if (Math.random() < 0.18) return { step: 0, effect: '💤', msg: '방심하고 트랙에서 낮잠 Zzz...' };
      const step = Math.random() < 0.4 ? 3 : 2;
      return { step, effect: '🐰', msg: '깡총깡총 연속 점프!' };
    }
  },
  {
    name: '돼지',
    emoji: '🐖',
    title: '폭식돈돈',
    trait: '중반돌파',
    desc: '느릿하다가 바나나/간식을 보면 불도저처럼 돌진',
    odds: 4.5,
    calcStep: (turn) => {
      if (turn >= 3 && turn <= 5 && Math.random() < 0.55) {
        return { step: 3, effect: '🍙', msg: '간식을 발견하고 맹렬히 돌진!!' };
      }
      return { step: Math.random() < 0.65 ? 1 : 2, effect: '🐽', msg: '꿀꿀거리며 전진' };
    }
  },
  {
    name: '거북이',
    emoji: '🐢',
    title: '용궁거북',
    trait: '대기만성',
    desc: '결승선 직전 4칸 초특급 워프 부스터!',
    odds: 7.0,
    calcStep: (turn) => {
      if (turn >= 5 && Math.random() < 0.45) return { step: 4, effect: '🚀', msg: '용궁 부스터 가동!! 4칸 워프!' };
      return { step: Math.random() < 0.8 ? 1 : 0, effect: '🐢', msg: '느릿느릿 엉금엉금' };
    }
  },
  {
    name: '달팽이',
    emoji: '🐌',
    title: '우주달팽이',
    trait: '우주초월',
    desc: '0칸 전진이 태반이지만 터지면 5칸 공간도약!',
    odds: 10.0,
    calcStep: (turn) => {
      if (Math.random() < 0.18) return { step: 5, effect: '🪐', msg: '우주 차원 왜곡! 5칸 공간도약!!' };
      return { step: Math.random() < 0.7 ? 0 : 1, effect: '✨', msg: '점액질 남기며 미세 전진' };
    }
  },
  {
    name: '새',
    emoji: '🕊️',
    title: '돌풍참새',
    trait: '일도양단비행',
    desc: '10% 확률로 결승선까지 다이렉트 비행!',
    odds: 12.0,
    calcStep: (turn) => {
      if (Math.random() < 0.10) return { step: 10, effect: '✈️', msg: '돌풍을 타고 결승선까지 직행 비행!!' };
      return { step: Math.random() < 0.5 ? 1 : 2, effect: '🪶', msg: '푸드득 날개짓' };
    }
  },
  {
    name: '원숭이',
    emoji: '🐒',
    title: '바나나원숭',
    trait: '주변방해공격',
    desc: '35% 확률로 다른 동물에게 바나나 껍질 투척!',
    odds: 3.6,
    calcStep: () => {
      if (Math.random() < 0.35) return { step: 2, effect: '🍌', msg: '바나나 껍질을 던져 견제!' };
      return { step: Math.random() < 0.5 ? 1 : 2, effect: '🐒', msg: '나무타기 스텝' };
    }
  },
  {
    name: '가재',
    emoji: '🦞',
    title: '유턴가재',
    trait: '뒤걸음질역주행',
    desc: '폭풍 질주 또는 30% 확률로 역주행(-2칸)!',
    odds: 5.5,
    calcStep: () => {
      if (Math.random() < 0.30) return { step: -2, effect: '↩️', msg: '집게발 들고 뒷걸음질(-2칸) 역주행!' };
      return { step: Math.random() < 0.5 ? 2 : 3, effect: '🦞', msg: '앞으로 촥촥 튀어나감!' };
    }
  },
  {
    name: '치와와',
    emoji: '🐕',
    title: '광견치와와',
    trait: '부정출발망나니',
    desc: '시작하자마자 4칸 부정출발! 후반 탈진',
    odds: 4.2,
    calcStep: (turn) => {
      if (turn === 1) return { step: 4, effect: '🚨', msg: '총소리 무시하고 4칸 부정출발!!' };
      if (turn >= 4 && Math.random() < 0.4) return { step: 0, effect: '💢', msg: '흥분해서 제자리 짖기' };
      return { step: Math.random() < 0.6 ? 1 : 2, effect: '🐕', msg: '앙칼지게 총총 질주' };
    }
  }
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

class WebHorseRaceEngine {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn;
    this.FINISH_LINE = 14;
    this.races = {}; // roomId/global -> raceState
    this.raceCounter = 1;
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

    const race = {
      roomId,
      raceNo: this.raceCounter++,
      seed,
      state: 'betting', // 'betting' | 'racing' | 'finished'
      createdAt: Date.now(),
      startTime: Date.now() + 30000, // 30초 배팅 시간
      horses: selectedRacers.map((r, idx) => ({
        id: idx + 1,
        name: r.name,
        emoji: r.emoji,
        title: r.title,
        trait: r.trait,
        desc: r.desc,
        odds: getHorseCurrentOdds(r),
        progress: 0,
        lastEffect: '',
        finishScore: 0
      })),
      bets: {}, // userId -> { horseId, amount, name, isAllIn }
      eventLogs: []
    };

    this.races[roomId] = race;
    this.broadcast('race_created', this.sanitizeRace(race));

    // 배팅 마감 카운트다운 타이머
    race.timer = setTimeout(() => {
      this.startRace(roomId);
    }, 30000);

    return race;
  }

  placeBet(roomId, user, horseId, amount, isAllIn = false) {
    const race = this.races[roomId];
    if (!race || race.state !== 'betting') {
      return { ok: false, error: '현재 배팅 가능한 경기가 없습니다.' };
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

    // 포인트 차감
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

    this.broadcast('race_bet_placed', {
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
    this.broadcast('race_started', this.sanitizeRace(race));

    let turn = 0;
    const interval = setInterval(() => {
      turn++;
      const turnEvents = [];

      for (const h of race.horses) {
        if (h.progress < this.FINISH_LINE) {
          const poolItem = RACER_POOL.find(p => p.name === h.name);
          let outcome = { step: 1, effect: '━', msg: '' };
          if (poolItem && poolItem.calcStep) {
            outcome = poolItem.calcStep(turn, h, race.horses);
          } else {
            const s = Math.floor(Math.random() * 2) + 1;
            outcome = { step: s, effect: (s > 1 ? '💨' : '━'), msg: '' };
          }

          h.progress = Math.max(0, Math.min(this.FINISH_LINE, h.progress + outcome.step));
          h.lastEffect = outcome.effect || '';

          if (outcome.msg) {
            turnEvents.push(`${h.emoji} [${h.title}] ${outcome.msg}`);
          }

          if (h.progress >= this.FINISH_LINE && !h.finishScore) {
            h.finishScore = (this.FINISH_LINE + outcome.step * 0.1) + Math.random() * 0.09;
          }
        }
      }

      const finishedHorses = race.horses.filter(h => h.progress >= this.FINISH_LINE);
      const anyFinished = finishedHorses.length > 0;

      this.broadcast('race_tick', {
        roomId,
        raceNo: race.raceNo,
        turn,
        horses: race.horses.map(h => ({
          id: h.id,
          name: h.name,
          emoji: h.emoji,
          progress: h.progress,
          lastEffect: h.lastEffect
        })),
        events: turnEvents
      });

      if (anyFinished || turn >= 15) {
        clearInterval(interval);
        this.finishRace(roomId, race);
      }
    }, 1200);
  }

  finishRace(roomId, race) {
    race.state = 'finished';

    race.horses.sort((a, b) => {
      if (b.progress !== a.progress) return b.progress - a.progress;
      return (b.finishScore || 0) - (a.finishScore || 0);
    });

    const winner = race.horses[0];

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

    this.broadcast('race_finished', {
      roomId,
      raceNo: race.raceNo,
      winner: {
        id: winner.id,
        name: winner.name,
        emoji: winner.emoji,
        title: winner.title,
        odds: winner.odds
      },
      rankings: race.horses.map((h, i) => ({ rank: i + 1, id: h.id, name: h.name, emoji: h.emoji })),
      payouts
    });

    // 15초 후 자동으로 다음 경기 오픈
    setTimeout(() => {
      this.createRace(roomId);
    }, 15000);
  }

  sanitizeRace(race) {
    return {
      roomId: race.roomId,
      raceNo: race.raceNo,
      seed: race.seed,
      state: race.state,
      startTime: race.startTime,
      horses: race.horses.map(h => ({
        id: h.id,
        name: h.name,
        emoji: h.emoji,
        title: h.title,
        trait: h.trait,
        desc: h.desc,
        odds: h.odds,
        progress: h.progress
      })),
      betsCount: Object.keys(race.bets).length
    };
  }
}

module.exports = {
  WebHorseRaceEngine,
  RACER_POOL
};
