const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');

// ==========================================
// 🏇 대환장 동물 달리기 대회 (경마/배팅 모듈)
// ==========================================
const HORSE_STATS_FILE = path.join(__dirname, '..', 'horse_stats.json');
const ACTIVE_RACES_FILE = path.join(__dirname, '..', 'active_races.json');
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

function getHorseWins(name) {
  return (horseStats[name] && horseStats[name].wins) || 0;
}

function getHorseLosses(name) {
  return (horseStats[name] && horseStats[name].consecutiveLosses) || 0;
}

function getHorseCurrentOdds(racer) {
  const losses = getHorseLosses(racer.name);
  if (losses === 0) return racer.odds;
  const calculated = racer.odds * Math.pow(2, losses);
  return Math.round(calculated * 10) / 10;
}

function recordRaceResult(winnerName, participantNames) {
  for (const name of participantNames) {
    if (!horseStats[name]) {
      horseStats[name] = { wins: 0, consecutiveLosses: 0 };
    }
    if (name === winnerName) {
      horseStats[name].wins = (horseStats[name].wins || 0) + 1;
      horseStats[name].consecutiveLosses = 0; // 우승 시 연패 초기화 (원점 복귀)
    } else {
      horseStats[name].consecutiveLosses = (horseStats[name].consecutiveLosses || 0) + 1; // 패배 시 연패 누적 (*2배)
    }
  }
  saveHorseStats();
}

// 🐾 개성 넘치는 동물 선수 명단 & 고유 달리기 특성
const RACER_POOL = [
  {
    name: '치타',
    emoji: '🐆',
    title: '총알탄치타',
    trait: '선행도주',
    desc: '초반 폭발적 질주, 후반 체력 방전 위험',
    odds: 1.8,
    calcStep: (turn, h) => {
      if (turn <= 4) {
        const step = Math.random() < 0.75 ? 2 : 3;
        const effect = (step === 3) ? '💥' : '💨';
        const msg = (step === 3) ? '초반 폭풍 부스터 폭발!!' : '초반 질주!';
        return { step, effect, msg };
      } else {
        if (Math.random() < 0.1) {
          return { step: 0, effect: '💦', msg: '혓바닥 내밀고 탈진...' };
        }
        return { step: 1, effect: '━', msg: '지친 몸으로 터덜터덜' };
      }
    }
  },
  {
    name: '경주마',
    emoji: '🐎',
    title: '야근탈출마',
    trait: '안정균형',
    desc: '언제나 1~2칸씩 꾸준히 달리는 모범생',
    odds: 2.2,
    calcStep: (turn, h) => {
      const step = Math.random() < 0.5 ? 2 : 1;
      return { step, effect: (step === 2 ? '💨' : '━'), msg: (step === 2 ? '안정적인 스퍼트!' : '페이스 유지') };
    }
  },
  {
    name: '호랑이',
    emoji: '🐅',
    title: '어흥맹호',
    trait: '맹수돌진',
    desc: '고른 속도로 달리다 가끔 포효하며 폭주',
    odds: 2.5,
    calcStep: (turn, h) => {
      if (Math.random() < 0.28) {
        return { step: 3, effect: '🔥', msg: '어흥!! 맹수의 포효 돌진!' };
      }
      const step = Math.random() < 0.5 ? 2 : 1;
      return { step, effect: (step === 2 ? '💨' : '━'), msg: '침착하게 추격' };
    }
  },
  {
    name: '늑대',
    emoji: '🐺',
    title: '추격늑대',
    trait: '후반추격',
    desc: '초반엔 탐색전, 4턴 이후 사냥꾼의 맹추격',
    odds: 3.2,
    calcStep: (turn, h) => {
      if (turn <= 3) {
        return { step: 1, effect: '━', msg: '조용히 눈치 살피는 중' };
      } else {
        const step = Math.random() < 0.6 ? 2 : 3;
        return { step, effect: (step === 3 ? '🌪️' : '💨'), msg: '사냥 모드 발동!! 맹추격!' };
      }
    }
  },
  {
    name: '토끼',
    emoji: '🐇',
    title: '도발토끼',
    trait: '낮잠복불복',
    desc: '엄청 빠르지만 30% 확률로 졸면서 땡땡이',
    odds: 3.8,
    calcStep: (turn, h) => {
      if (Math.random() < 0.3) {
        return { step: 0, effect: '💤', msg: '잔디밭에서 쿨쿨 낮잠 중...' };
      }
      const step = Math.random() < 0.5 ? 2 : 3;
      return { step, effect: (step === 3 ? '✨' : '💨'), msg: '번개 뜀박질로 폴짝폴짝!' };
    }
  },
  {
    name: '돼지',
    emoji: '🐖',
    title: '폭식돈돈',
    trait: '식탐뚝심',
    desc: '느릿하지만 지치지 않고 묵직하게 밀고감',
    odds: 4.5,
    calcStep: (turn, h) => {
      const step = Math.random() < 0.45 ? 2 : 1;
      return { step, effect: (step === 2 ? '💨' : '━'), msg: '간식 생각하며 묵묵히 전진' };
    }
  },
  {
    name: '거북이',
    emoji: '🐢',
    title: '용궁거북',
    trait: '막판뒤집기',
    desc: '초중반 기어감, 결승선 직전 4칸 초광속 역전기',
    odds: 6.5,
    calcStep: (turn, h) => {
      if (turn <= 4) {
        const step = Math.random() < 0.7 ? 1 : 0;
        return { step, effect: (step === 0 ? '🐢' : '━'), msg: (step === 0 ? '제자리 걸음...' : '엉금엉금 기어가는 중') };
      } else {
        const r = Math.random();
        if (r < 0.3) {
          return { step: 4, effect: '🚀', msg: '🔥 용궁 부스터 점화!! 4칸 대역전 질주!' };
        }
        if (r < 0.6) {
          return { step: 3, effect: '💥', msg: '기적의 스퍼트 발동!' };
        }
        return { step: 1, effect: '━', msg: '마지막까지 포기하지 않음' };
      }
    }
  },
  {
    name: '달팽이',
    emoji: '🐌',
    title: '우주달팽이',
    trait: '초고배당로또',
    desc: '기어가다 번개 맞으면 워프(5칸) 발동!',
    odds: 9.0,
    calcStep: (turn, h) => {
      if (Math.random() < 0.16) {
        return { step: 5, effect: '⚡️', msg: '🌀 시공간 왜곡 워프 발동!! (+5칸 텔레포트)' };
      }
      const step = Math.random() < 0.4 ? 1 : 0;
      return { step, effect: '━', msg: (step === 0 ? '점액질 분비 중...' : '1mm씩 조심스럽게 전진') };
    }
  },
  {
    name: '새',
    emoji: '🕊️',
    title: '돌풍참새',
    trait: '일도양단비행',
    desc: '가만히 나뭇가지에 앉아있다가 10% 확률로 결승선까지 다이렉트 비행!',
    odds: 12.0,
    calcStep: (turn, h, others) => {
      if (Math.random() < 0.10) {
        return { step: 15, effect: '🌪️', msg: '🦅 파닥파닥 날개짓 한 방에 결승선으로 직행 비행!!' };
      }
      return { step: 0, effect: '🕊️', msg: '구구구... 깃털 다듬으며 멍때리는 중' };
    }
  },
  {
    name: '원숭이',
    emoji: '🐒',
    title: '바나나원숭',
    trait: '주변방해공격',
    desc: '35% 확률로 다른 동물에게 바나나 껍질/돌멩이를 던져 1칸 후퇴시킴!',
    odds: 3.6,
    calcStep: (turn, h, others) => {
      if (Math.random() < 0.35 && others && others.length > 0) {
        const victim = others[Math.floor(Math.random() * others.length)];
        victim.progress = Math.max(0, victim.progress - 1);
        victim.lastEffect = '🍌';
        const step = Math.random() < 0.5 ? 2 : 1;
        return {
          step,
          effect: '🍌',
          msg: `🍌 얍! [${victim.title}]에게 바나나 껍질 투척! (${victim.title} 1칸 미끄러짐!)`
        };
      }
      const step = Math.random() < 0.5 ? 2 : 1;
      return { step, effect: (step === 2 ? '💨' : '━'), msg: '나무 타듯 가볍게 깡충깡충' };
    }
  },
  {
    name: '가재',
    emoji: '🦞',
    title: '유턴가재',
    trait: '뒤걸음질역주행',
    desc: '빠르게 튀어나가다가도 30% 확률로 왔던 길을 뒷걸음질(-2칸)침!',
    odds: 5.5,
    calcStep: (turn, h, others) => {
      if (h.progress > 0 && Math.random() < 0.30) {
        return {
          step: -2,
          effect: '↩️',
          msg: '🦞 이게 아닌가?! 당황해서 왔던 길로 격렬한 뒷걸음질! (-2칸)'
        };
      }
      const step = Math.random() < 0.4 ? 3 : 2;
      return { step, effect: '💨', msg: '집게발 딱딱거리며 전력 질주!' };
    }
  },
  {
    name: '치와와',
    emoji: '🐕',
    title: '광견치와와',
    trait: '부정출발망나니',
    desc: '시작하자마자 총소리 무시하고 4칸 부정출발! 하지만 중반엔 으르렁대다 지침',
    odds: 4.2,
    calcStep: (turn, h, others) => {
      if (turn === 1) {
        return {
          step: 4,
          effect: '🚨',
          msg: '🚨 탕 소리도 안 났는데 냅다 튀어나가는 4칸 부정출발!!'
        };
      }
      if (turn <= 3) {
        const step = Math.random() < 0.6 ? 2 : 1;
        return { step, effect: '💨', msg: '컹컹 짖으며 질주 중!' };
      }
      // 중반 이후
      if (Math.random() < 0.4) {
        return {
          step: 0,
          effect: '💢',
          msg: '혼자 분에 못 이겨 제자리에서 바들바들 떨며 으르렁!'
        };
      }
      return { step: 1, effect: '━', msg: '작은 발로 뽈뽈뽈 이동' };
    }
  }
];

const VERTICAL_TRACK_HEIGHT = 15; // 0 ~ 14 레인, 15번째가 결승선 통과!
const FINISH_LINE = VERTICAL_TRACK_HEIGHT;

const races = {};
let raceCounter = 1;

function saveActiveRaces() {
  try {
    const serialized = {};
    for (const [chatId, race] of Object.entries(races)) {
      serialized[chatId] = {
        raceNo: race.raceNo,
        threadId: race.threadId,
        state: race.state,
        createdAt: race.createdAt,
        canStartAt: race.canStartAt,
        messageId: race.messageId,
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
        bets: Array.from(race.bets.entries())
      };
    }
    fs.writeFileSync(ACTIVE_RACES_FILE, JSON.stringify(serialized, null, 2), 'utf8');
  } catch (e) {}
}

function getRaceBettingText(race) {
  const horseList = race.horses.map((h, i) => {
    const losses = getHorseLosses(h.name);
    const streakBadge = losses > 0 ? ` 🔥 ${losses}연패(×${Math.pow(2, losses)}배)` : '';
    return `${i + 1}번 ${h.emoji} **${h.title}** (${h.odds}x${streakBadge}) - _${h.desc}_`;
  }).join('\n');

  let betSummary = '없음';
  if (race.bets.size > 0) {
    betSummary = Array.from(race.bets.values())
      .map(b => `${b.name}(${b.horseId}번 ${b.amount.toLocaleString()}P)`)
      .join(', ');
  }

  return `🏇 **[제 ${race.raceNo}회 동물 달리기] 배팅 오픈**\n\n` +
    `${horseList}\n\n` +
    `📊 **배팅**: ${betSummary}\n` +
    `💡 버튼 클릭 또는 채팅창에 **\`1번 3000\`**, **\`올인\`** 입력!`;
}

function getRaceBettingKeyboard(race) {
  const horseButtons = race.horses.map((h, i) => {
    return [
      Markup.button.callback(`${h.emoji} ${i + 1}번 (+1천)`, `bet_${i + 1}_1000`),
      Markup.button.callback(`${h.emoji} ${i + 1}번 (+5천)`, `bet_${i + 1}_5000`),
      Markup.button.callback(`${h.emoji} ${i + 1}번 (올인)`, `bet_${i + 1}_all`)
    ];
  });

  const now = Date.now();
  const remainingSec = Math.ceil(((race.canStartAt || 0) - now) / 1000);

  // 📊 사내 위장 엑셀 텔레그램 Mini App Direct Link 생성
  const horseIndicesHyphen = race.horses.map(h => RACER_POOL.findIndex(p => p.name === h.name)).join('-');
  const startParam = `${race.raceNo}_${race.seed || 101}_${horseIndicesHyphen}`;
  const miniAppUrl = `https://t.me/oceanspybot/rece?startapp=${startParam}`;

  if (remainingSec > 0) {
    horseButtons.push([
      Markup.button.callback(`⏳ 배팅 준비 중 (${remainingSec}초 남음)`, 'start_race_now')
    ]);
  } else {
    horseButtons.push([
      Markup.button.callback('🏁 경기 시작 (출발!)', 'start_race_now')
    ]);
  }

  // 엑셀 웹앱 관전 버튼 상시 노출 (텔레그램 인앱 미니앱 직행 링크)
  horseButtons.push([
    Markup.button.url('📊 [사내위장] 엑셀 스프레드시트 관전', miniAppUrl)
  ]);

  return Markup.inlineKeyboard(horseButtons);
}

// 🏁 세로형 트랙 렌더러
function renderVerticalTrack(race) {
  const h1 = race.horses[0];
  const h2 = race.horses[1];
  const h3 = race.horses[2];

  let track = `\`[1번]  [2번]  [3번]\`\n`;
  track += `\`-----------------\`\n`;

  for (let row = 0; row < VERTICAL_TRACK_HEIGHT; row++) {
    const getCell = (h) => {
      if (h.progress === row) {
        return ` ${h.emoji} `;
      }
      if (h.progress - 1 === row && h.lastEffect && h.lastEffect !== '━') {
        return ` ${h.lastEffect} `;
      }
      return '  │ ';
    };

    track += `\`${getCell(h1)}${getCell(h2)}${getCell(h3)}\`\n`;
  }

  track += `\`-----------------\`\n`;

  const f1 = (h1.progress >= FINISH_LINE) ? ' 🏆 ' : ' 🏁 ';
  const f2 = (h2.progress >= FINISH_LINE) ? ' 🏆 ' : ' 🏁 ';
  const f3 = (h3.progress >= FINISH_LINE) ? ' 🏆 ' : ' 🏁 ';

  track += `\`${f1}${f2}${f3}\` 🏁 결승선`;
  return track;
}

/**
 * 경마 모듈 등록 (Telegraf bot 인스턴스 및 헬퍼 의존성 주입)
 */
function initHorseRace(bot, helpers) {
  const {
    getThreadId,
    GAME_THREAD_ID,
    getWallet,
    saveWallets,
    checkAndUnlockTitles,
    getGameActionButtons
  } = helpers;

  // 🔄 봇 시작/재부팅 시 미완료된 배팅 환불 및 복구
  try {
    if (fs.existsSync(ACTIVE_RACES_FILE)) {
      const saved = JSON.parse(fs.readFileSync(ACTIVE_RACES_FILE, 'utf8'));
      let refundedCount = 0;
      for (const [chatId, race] of Object.entries(saved)) {
        if (race.bets && race.bets.length > 0) {
          for (const [userId, bet] of race.bets) {
            const w = getWallet(userId, bet.name);
            w.points += bet.amount;
            refundedCount++;
          }
          if (race.threadId) {
            bot.telegram.sendMessage(
              chatId,
              `🔄 **[시스템 업데이트 안내]**\n봇 재부팅으로 인해 진행 중이던 제 ${race.raceNo}회 대기실 배팅 금액이 전액 안전하게 지갑으로 자동 환불되었습니다. 💰`,
              { parse_mode: 'Markdown', message_thread_id: race.threadId }
            ).catch(() => {});
          }
        }
      }
      if (refundedCount > 0) {
        saveWallets();
        console.log(`[HorseRace] 재부팅 전 미완료 배팅 ${refundedCount}건 전액 환불 완료.`);
      }
      fs.unlinkSync(ACTIVE_RACES_FILE);
    }
  } catch (e) {
    console.error('[HorseRace] active_races 환불 처리 중 에러:', e);
  }

  async function handleRace(ctx) {
    if (ctx.chat.type === 'private') {
      return ctx.reply('⚠️ 동물 달리기 대회는 단톡방(그룹)에서 함께 즐겨주세요!');
    }

    const chatId = ctx.chat.id;
    if (races[chatId] && (races[chatId].state === 'betting' || races[chatId].state === 'racing')) {
      return ctx.reply('⚠️ 이미 진행 중인 경주가 있습니다!');
    }

    const selectedRacers = [...RACER_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
    const threadId = getThreadId(ctx) || GAME_THREAD_ID;
    const seed = Math.floor(Math.random() * 900000) + 100000;

    races[chatId] = {
      raceNo: raceCounter++,
      seed,
      threadId,
      state: 'betting',
      createdAt: Date.now(),
      canStartAt: Date.now() + 10000, // 최소 10초 대기
      horses: selectedRacers.map((r, idx) => ({
        id: idx + 1,
        name: r.name,
        emoji: r.emoji,
        title: r.title,
        trait: r.trait,
        desc: r.desc,
        odds: getHorseCurrentOdds(r),
        calcStep: r.calcStep,
        progress: 0
      })),
      bets: new Map(),
      messageId: null
    };

    const sent = await ctx.reply(getRaceBettingText(races[chatId]), {
      parse_mode: 'Markdown',
      ...getRaceBettingKeyboard(races[chatId])
    });

    races[chatId].messageId = sent.message_id;
    saveActiveRaces();

    // 10초 후 "🏁 경기 시작" 버튼 활성화 상태로 자동 갱신
    setTimeout(async () => {
      const currentRace = races[chatId];
      if (currentRace && currentRace.state === 'betting' && currentRace.messageId) {
        try {
          await bot.telegram.editMessageReplyMarkup(
            chatId,
            currentRace.messageId,
            null,
            getRaceBettingKeyboard(currentRace).reply_markup
          );
        } catch (e) {}
      }
    }, 10100);
  }

  async function runVerticalRaceAnimation(chatId, ctx) {
    const race = races[chatId];
    if (!race || race.state !== 'betting') return;

    race.state = 'racing';
    saveActiveRaces();

    if (race.messageId) {
      try {
        await ctx.deleteMessage(race.messageId);
      } catch (e) {}
    }

    const horseInfoLine = race.horses.map((h, i) => `${i + 1}번 ${h.emoji} ${h.title}`).join(' | ');
    const initText = `🎪 **[제 ${race.raceNo}회 대환장 동물 달리기] LIVE**\n` +
      `📢 ${horseInfoLine}\n\n` +
      `${renderVerticalTrack(race)}\n\n` +
      `⚡ **실시간 전황**: 출발선에서 긴장감이 감돕니다...\n` +
      `💬 **중계석**: 준비하시고... 땅! 💥\n` +
      `🤫 *(경주 중 대화 임시 제한)*`;

    const threadId = race.threadId || getThreadId(ctx) || GAME_THREAD_ID;
    const horseIndicesHyphen = race.horses.map(h => RACER_POOL.findIndex(p => p.name === h.name)).join('-');
    const startParam = `${race.raceNo}_${race.seed || 101}_${horseIndicesHyphen}`;
    const miniAppUrl = `https://t.me/oceanspybot/rece?startapp=${startParam}`;

    const liveExtra = {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('📊 [사내위장] 엑셀 실시간 중계 화면 보기', miniAppUrl)]
      ])
    };
    if (threadId) liveExtra.message_thread_id = threadId;

    const liveMsg = await bot.telegram.sendMessage(chatId, initText, liveExtra);
    race.messageId = liveMsg.message_id;

    let turn = 0;
    const commentary = [
      '탕! 게이트 오픈! 각양각색 동물들이 출발합니다! 💥',
      '초반 질주! 치타와 경주마가 선두를 다툽니다! 🔥',
      '중반 구간 진입! 늑대와 맹호의 발걸음이 빨라집니다! 💨',
      '어어?! 뒤처지던 거북이와 달팽이의 눈빛이 변합니다?! ⚡️',
      '후반 대격돌! 엄청난 스피드로 선두가 뒤바뀝니다! 🌪️',
      '기적의 막판 대역전 스퍼트!! 결승선이 코앞입니다!! 🚨',
      '골인 직전!! 모든 동물들이 결승선을 향해 다이빙!! 🏁',
      '골인!! 결승선 통과!! 🏆'
    ];

    const interval = setInterval(async () => {
      turn++;
      const turnEvents = [];

      for (const h of race.horses) {
        if (h.progress < FINISH_LINE) {
          let outcome = { step: 1, effect: '━', msg: '' };
          const others = race.horses.filter(o => o.id !== h.id && o.progress < FINISH_LINE);
          if (h.calcStep) {
            outcome = h.calcStep(turn, h, others);
          } else {
            const s = Math.floor(Math.random() * 2) + 1;
            outcome = { step: s, effect: (s > 1 ? '💨' : '━'), msg: '' };
          }

          h.progress = Math.max(0, Math.min(FINISH_LINE, h.progress + outcome.step));
          h.lastEffect = outcome.effect || '';

          if (outcome.msg && (outcome.step >= 3 || outcome.step <= 0 || outcome.effect === '💦' || outcome.effect === '⚡️' || outcome.effect === '🚀' || outcome.effect === '🍌' || outcome.effect === '↩️' || outcome.effect === '🚨' || outcome.effect === '💢')) {
            turnEvents.push(`${h.emoji} **[${h.title}]** ${outcome.msg}`);
          }

          if (h.progress >= FINISH_LINE && !h.finishScore) {
            h.finishScore = (FINISH_LINE + outcome.step * 0.1) + Math.random() * 0.09;
          }
        } else {
          h.lastEffect = '';
        }
      }

      const finishedHorses = race.horses.filter(h => h.progress >= FINISH_LINE);
      const anyFinished = finishedHorses.length > 0;
      const isPhotoFinish = finishedHorses.length > 1;

      const comment = anyFinished
        ? (isPhotoFinish ? '🚨 동시 골인!! 심판진 정밀 사진 판독에 들어갑니다!! 📷🏁' : '와아아!! 대망의 1등이 결승선을 완전히 통과했습니다!! 🏁🥇')
        : commentary[Math.min(turn - 1, commentary.length - 2)];

      let eventLog = turnEvents.length > 0 ? turnEvents.join('\n') : '치열한 눈치 싸움과 팽팽한 레이스가 이어집니다!';
      if (anyFinished) {
        eventLog = '🏁 **선두 동물이 결승선을 돌파했습니다!!**';
      }

      const text = `🎪 **[제 ${race.raceNo}회 대환장 동물 달리기] LIVE**\n` +
        `📢 ${horseInfoLine}\n\n` +
        `${renderVerticalTrack(race)}\n\n` +
        `⚡ **실시간 전황**:\n${eventLog}\n\n` +
        `💬 **중계석**: ${comment}\n` +
        `🤫 *(경주 중 대화 임시 제한)*`;

      const liveMarkup = Markup.inlineKeyboard([
        [Markup.button.url('📊 [사내위장] 엑셀 실시간 중계 화면 보기', miniAppUrl)]
      ]);

      try {
        await bot.telegram.editMessageText(chatId, race.messageId, null, text, {
          parse_mode: 'Markdown',
          ...liveMarkup
        });
      } catch (e) {}

      if (anyFinished || turn >= 15) {
        clearInterval(interval);

        race.horses.sort((a, b) => {
          const scoreA = a.finishScore || a.progress;
          const scoreB = b.finishScore || b.progress;
          return scoreB - scoreA;
        });
        const winner = race.horses[0];
        recordRaceResult(winner.name, race.horses.map(h => h.name));

        const winners = [];
        const losers = [];
        const newlyUnlockedMsgs = [];

        for (const [userId, bet] of race.bets.entries()) {
          const w = getWallet(userId, bet.name);
          w.raceCount = (w.raceCount || 0) + 1;

          if (bet.horseId === winner.id) {
            const prize = Math.floor(bet.amount * winner.odds);
            const profit = prize - bet.amount;
            w.points += prize;
            w.wins = (w.wins || 0) + 1;
            if (winner.odds > (w.maxOdds || 0)) w.maxOdds = winner.odds;
            if (profit > (w.maxProfit || 0)) w.maxProfit = profit;
            if (bet.isAllIn) w.allInWon = true;

            winners.push(`🎉 **${bet.name}**: +${prize.toLocaleString()} P (배당 ${winner.odds}x)`);
          } else {
            losers.push(`💸 **${bet.name}**: -${bet.amount.toLocaleString()} P`);
            if (w.points === 0) {
              w.bankruptHit = true;
            }
          }

          const un = checkAndUnlockTitles(w);
          if (un.length > 0) {
            newlyUnlockedMsgs.push(`🎖️ **${w.name}** 님이 [${un.map(t => t.name).join(', ')}] 칭호를 달성했습니다! (/칭호 로 장착 가능)`);
          }
        }
        saveWallets();

        let resultText = `🏆 **[제 ${race.raceNo}회 달리기 대회 최종 순위 & 정산]** 🏆\n\n`;
        if (isPhotoFinish) {
          resultText += `📷 **[초정밀 비디오 판독 결과]**\n0.01초 코끝 차이로 극적인 순위 확정!\n\n`;
        }
        resultText += `🏁 **최종 순위**:\n` +
          `🥇 **1위**: ${race.horses[0].id}번 ${race.horses[0].emoji} **${race.horses[0].title}** (${race.horses[0].name}) [배당 ${race.horses[0].odds}x]\n` +
          `🥈 **2위**: ${race.horses[1].id}번 ${race.horses[1].emoji} **${race.horses[1].title}** (${race.horses[1].name})\n` +
          `🥉 **3위**: ${race.horses[2].id}번 ${race.horses[2].emoji} **${race.horses[2].title}** (${race.horses[2].name})\n\n` +
          `━━━━━━━━━━━━━━━\n` +
          `💰 **배팅 정산 내역**:\n`;

        if (winners.length > 0) {
          resultText += `\n**[적중 성공자]**\n` + winners.join('\n') + `\n`;
        }
        if (losers.length > 0) {
          resultText += `\n**[적중 실패자]**\n` + losers.join('\n') + `\n`;
        }
        if (race.bets.size === 0) {
          resultText += `\n아무도 배팅하지 않은 평화로운 레이스였습니다.\n`;
        }

        if (newlyUnlockedMsgs.length > 0) {
          resultText += `\n━━━━━━━━━━━━━━━\n` + newlyUnlockedMsgs.join('\n') + `\n`;
        }

        resultText += `━━━━━━━━━━━━━━━\n🗣️ **대화 제한이 해제되었습니다!**\n아래 버튼을 눌러 바로 다음 경기를 열거나 지갑/랭킹을 확인하세요!`;

        setTimeout(async () => {
          try {
            const resExtra = { parse_mode: 'Markdown', ...getGameActionButtons() };
            if (threadId) resExtra.message_thread_id = threadId;
            await bot.telegram.sendMessage(chatId, resultText, resExtra);
          } catch (e) {}
          delete races[chatId];
          saveActiveRaces();
        }, 1500);
      }
    }, 2200);
  }

  function processBet(chatId, user, horseId, amount, isAllIn) {
    const race = races[chatId];
    if (!race || race.state !== 'betting') {
      return { success: false, reason: '현재 배팅 시간이 아닙니다.' };
    }

    const racer = race.horses.find(h => h.id === horseId);
    if (!racer) {
      return { success: false, reason: '존재하지 않는 출전 번호입니다 (1~3번).' };
    }
    const racerDisplayName = `${racer.emoji} ${racer.title}`;

    const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
    const w = getWallet(user.id, name);

    if (isAllIn) {
      amount = w.points;
    }

    if (amount <= 0) {
      return { success: false, reason: '배팅할 포인트가 없습니다! (/구걸)' };
    }
    if (w.points < amount) {
      return { success: false, reason: `잔액이 부족합니다! (현재: ${w.points.toLocaleString()} P)` };
    }

    const currentBet = race.bets.get(user.id);
    if (currentBet) {
      if (currentBet.horseId !== horseId) {
        return { success: false, reason: `이미 ${currentBet.horseId}번(${currentBet.racerName})에 배팅하셨습니다!` };
      }
      w.points -= amount;
      currentBet.amount += amount;
      if (isAllIn || w.points === 0) currentBet.isAllIn = true;
    } else {
      w.points -= amount;
      race.bets.set(user.id, {
        horseId,
        amount,
        name,
        racerName: racerDisplayName,
        isAllIn: isAllIn || (w.points === 0)
      });
    }
    saveWallets();
    saveActiveRaces();

    return {
      success: true,
      racerDisplayName,
      amount,
      race
    };
  }

  // 🔘 인라인 버튼 배팅 액션 리스너
  bot.action(/^bet_(\d+)_(1000|5000|all)$/, async (ctx) => {
    const horseId = parseInt(ctx.match[1], 10);
    const mode = ctx.match[2];
    const isAllIn = (mode === 'all');
    const amount = isAllIn ? 0 : parseInt(mode, 10);

    const res = processBet(ctx.chat.id, ctx.from, horseId, amount, isAllIn);
    if (!res.success) {
      return ctx.answerCbQuery(res.reason, { show_alert: true });
    }

    await ctx.answerCbQuery(`${res.racerDisplayName}에 ${res.amount.toLocaleString()} P 배팅 완료!`);

    try {
      await ctx.editMessageText(getRaceBettingText(res.race), {
        parse_mode: 'Markdown',
        ...getRaceBettingKeyboard(res.race)
      });
    } catch (e) {}
  });

  // 💬 채팅 텍스트 배팅 파서 (예: "1번 3000", "2번 5천", "3 1만", "1번 올인")
  async function handleTextBet(ctx, text) {
    const chatId = ctx.chat.id;
    const race = races[chatId];
    if (!race || race.state !== 'betting') return false;

    // 경주가 열린 토픽방(게임방)에서 올라온 텍스트 배팅만 처리
    const threadId = getThreadId(ctx);
    if (threadId && race.threadId && threadId !== race.threadId) return false;

    const trimmed = text.trim();
    // 패턴 매칭: "1번 3000", "1 5000", "2번 올인", "3번 1만", "1번 5천", "/배팅 1 3000" 등
    const match = trimmed.match(/^(?:\/배팅\s+|\/bet\s+)?([1-3])(?:번)?\s+([0-9만천kK,]+|올인|all)$/i);
    if (!match) return false;

    const horseId = parseInt(match[1], 10);
    const rawAmount = match[2].toLowerCase();

    let amount = 0;
    let isAllIn = false;

    if (rawAmount === '올인' || rawAmount === 'all') {
      isAllIn = true;
    } else {
      // 단위 변환: 만, 천, k 처리
      let numStr = rawAmount.replace(/,/g, '');
      if (numStr.endsWith('만')) {
        amount = Math.floor(parseFloat(numStr.replace('만', '')) * 10000);
      } else if (numStr.endsWith('천') || numStr.endsWith('k')) {
        amount = Math.floor(parseFloat(numStr.replace(/[천k]/g, '')) * 1000);
      } else {
        amount = parseInt(numStr, 10);
      }
    }

    if (!isAllIn && (!amount || isNaN(amount) || amount <= 0)) return false;

    const res = processBet(chatId, ctx.from, horseId, amount, isAllIn);

    // 유저의 배팅 입력 메시지 삭제 (채팅창 깔끔 유지)
    try {
      await ctx.deleteMessage();
    } catch (e) {}

    if (!res.success) {
      const alertMsg = await ctx.reply(`⚠️ ${res.reason}`);
      setTimeout(async () => {
        try { await ctx.deleteMessage(alertMsg.message_id); } catch (e) {}
      }, 3000);
      return true;
    }

    // 대기실 메시지 실시간 갱신
    if (race.messageId) {
      try {
        await bot.telegram.editMessageText(
          chatId,
          race.messageId,
          null,
          getRaceBettingText(race),
          {
            parse_mode: 'Markdown',
            ...getRaceBettingKeyboard(race)
          }
        );
      } catch (e) {}
    }

    return true;
  }

  // 🔘 경기 시작 액션
  bot.action('start_race_now', async (ctx) => {
    const chatId = ctx.chat.id;
    const race = races[chatId];
    if (!race || race.state !== 'betting') {
      return ctx.answerCbQuery('진행 중인 대기실이 없습니다.');
    }

    const now = Date.now();
    const remainingSec = Math.ceil(((race.canStartAt || 0) - now) / 1000);
    if (remainingSec > 0) {
      return ctx.answerCbQuery(`⏳ 배팅 시간입니다! ${remainingSec}초 후에 출발할 수 있습니다.`, { show_alert: true });
    }

    await ctx.answerCbQuery('🏁 경기를 시작합니다!');
    return runVerticalRaceAnimation(ctx.chat.id, ctx);
  });

  function refundAndCleanupActiveRaces() {
    let refundedCount = 0;
    for (const [chatId, race] of Object.entries(races)) {
      if (race.bets && race.bets.size > 0) {
        for (const [userId, bet] of race.bets.entries()) {
          const w = getWallet(userId, bet.name);
          w.points += bet.amount;
          refundedCount++;
        }
      }
    }
    if (refundedCount > 0) {
      saveWallets();
      console.log(`[HorseRace] 종료/중단 시점 미완료 배팅 ${refundedCount}건 지갑 환불 완료.`);
    }
    try {
      if (fs.existsSync(ACTIVE_RACES_FILE)) {
        fs.unlinkSync(ACTIVE_RACES_FILE);
      }
    } catch (e) {}
  }

  return {
    handleRace,
    handleTextBet,
    refundAndCleanupActiveRaces,
    races
  };
}

module.exports = {
  initHorseRace,
  races
};
