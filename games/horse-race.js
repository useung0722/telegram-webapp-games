const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');

// ==========================================
// 🏇 대환장 동물 달리기 대회 (경마/배팅 모듈)
// ==========================================
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

function formatKoreanNumber(val) {
  if (val === undefined || val === null) return '0';
  let isNegative = false;
  let str = String(val).trim();
  if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1);
  }

  // 지수 표기법 (예: 6.75e+21) 처리: BigInt로 파싱 가능한 정수 문자열로 변환
  if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(str)) {
    try {
      const parts = str.split(/[eE]/);
      let base = parts[0];
      const exp = parseInt(parts[1], 10);
      if (exp >= 0) {
        const dotIdx = base.indexOf('.');
        if (dotIdx >= 0) {
          const decPlaces = base.length - dotIdx - 1;
          const digits = base.replace('.', '');
          if (exp >= decPlaces) {
            str = digits + '0'.repeat(exp - decPlaces);
          } else {
            str = digits.slice(0, dotIdx + exp);
          }
        } else {
          str = base + '0'.repeat(exp);
        }
      }
    } catch (e) {}
  }

  try {
    let bn = BigInt(str.split('.')[0]);
    if (bn === 0n) return '0';
    if (bn < 10000n) return (isNegative ? '-' : '') + bn.toLocaleString();

    const units = [
      { val: 10n ** 48n, name: '극' },
      { val: 10n ** 44n, name: '재' },
      { val: 10n ** 40n, name: '정' },
      { val: 10n ** 36n, name: '간' },
      { val: 10n ** 32n, name: '구' },
      { val: 10n ** 28n, name: '양' },
      { val: 10n ** 24n, name: '자' },
      { val: 10n ** 20n, name: '해' },
      { val: 10n ** 16n, name: '경' },
      { val: 10n ** 12n, name: '조' },
      { val: 10n ** 8n, name: '억' },
      { val: 10n ** 4n, name: '만' }
    ];

    for (const u of units) {
      if (bn >= u.val) {
        const quotient = bn / u.val;
        const remainder = bn % u.val;
        const decimalDigit = Number((remainder * 10n) / u.val);
        let res = '';
        if (quotient < 100n && decimalDigit > 0) {
          res = `${quotient.toLocaleString()}.${decimalDigit}${u.name}`;
        } else {
          res = `${quotient.toLocaleString()}${u.name}`;
        }
        return (isNegative ? '-' : '') + res;
      }
    }
  } catch (e) {}

  const num = Number(val);
  return (isNegative ? '-' : '') + (isNaN(num) ? '0' : num.toLocaleString());
}

function getHorseWins(name) {
  return (horseStats[name] && horseStats[name].wins) || 0;
}

function getHorseLosses(name) {
  return (horseStats[name] && horseStats[name].consecutiveLosses) || 0;
}

function getHorseCurrentOdds(racer) {
  return racer.odds;
}

function recordRaceResult(winnerName, participantNames) {
  for (const name of participantNames) {
    if (!horseStats[name]) {
      horseStats[name] = { wins: 0, consecutiveLosses: 0 };
    }
    if (name === winnerName) {
      horseStats[name].wins = (horseStats[name].wins || 0) + 1;
      horseStats[name].consecutiveLosses = 0;
    } else {
      horseStats[name].consecutiveLosses = (horseStats[name].consecutiveLosses || 0) + 1;
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
    desc: '초반 4턴 폭발적 질주, 후반 체력 방전 위험',
    odds: 1.8,
    calcStep: (turn, h) => {
      if (turn <= 4) {
        const step = Math.random() < 0.65 ? 2 : 3;
        const effect = (step === 3) ? '💥' : '💨';
        const msg = (step === 3) ? '초반 폭풍 부스터 폭발!!' : '초반 질주!';
        return { step, effect, msg };
      } else {
        const r = Math.random();
        if (r < 0.25) {
          return { step: 0, effect: '💦', msg: '혓바닥 내밀고 탈진...' };
        }
        if (r < 0.80) {
          return { step: 1, effect: '━', msg: '지친 몸으로 터덜터덜' };
        }
        return { step: 2, effect: '💨', msg: '마지막 남은 힘으로 질주!' };
      }
    }
  },
  {
    name: '호랑이',
    emoji: '🐅',
    title: '어흥맹호',
    trait: '맹수돌진',
    desc: '고른 속도로 달리다 가끔 포효하며 폭주',
    odds: 2.2,
    calcStep: (turn, h) => {
      if (Math.random() < 0.08) {
        return { step: 3, effect: '🔥', msg: '어흥!! 맹수의 포효 돌진!' };
      }
      const step = Math.random() < 0.35 ? 2 : 1;
      return { step, effect: (step === 2 ? '💨' : '━'), msg: '침착하게 추격' };
    }
  },
  {
    name: '경주마',
    emoji: '🐎',
    title: '야근탈출마',
    trait: '안정균형',
    desc: '언제나 1~2칸씩 꾸준히 달리는 모범생',
    odds: 2.4,
    calcStep: (turn, h) => {
      const step = Math.random() < 0.45 ? 2 : 1;
      return { step, effect: (step === 2 ? '💨' : '━'), msg: (step === 2 ? '안정적인 스퍼트!' : '페이스 유지') };
    }
  },
  {
    name: '토끼',
    emoji: '🐇',
    title: '도발토끼',
    trait: '낮잠복불복',
    desc: '엄청 빠르지만 40% 확률로 졸면서 땡땡이',
    odds: 2.8,
    calcStep: (turn, h) => {
      if (Math.random() < 0.40) {
        return { step: 0, effect: '💤', msg: '잔디밭에서 쿨쿨 낮잠 중...' };
      }
      const step = Math.random() < 0.25 ? 3 : 2;
      return { step, effect: (step === 3 ? '✨' : '💨'), msg: '번개 뜀박질로 폴짝폴짝!' };
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
        const r = Math.random();
        if (r < 0.05) {
          return { step: 3, effect: '🌪️', msg: '사냥 모드 발동!! 맹추격!' };
        }
        if (r < 0.55) {
          return { step: 2, effect: '💨', msg: '스피드를 올리며 추격!' };
        }
        return { step: 1, effect: '━', msg: '추격 페이스 유지' };
      }
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
      const step = Math.random() < 0.35 ? 2 : 1;
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
        const step = Math.random() < 0.45 ? 1 : 0;
        return { step, effect: (step === 0 ? '🐢' : '━'), msg: (step === 0 ? '제자리 걸음...' : '엉금엉금 기어가는 중') };
      } else {
        const r = Math.random();
        if (r < 0.08) {
          return { step: 4, effect: '🚀', msg: '🔥 용궁 부스터 점화!! 4칸 대역전 질주!' };
        }
        if (r < 0.25) {
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
      if (Math.random() < 0.11) {
        return { step: 5, effect: '⚡️', msg: '🌀 시공간 왜곡 워프 발동!! (+5칸 텔레포트)' };
      }
      const step = Math.random() < 0.30 ? 1 : 0;
      return { step, effect: '━', msg: (step === 0 ? '점액질 분비 중...' : '1mm씩 조심스럽게 전진') };
    }
  }
];

const VERTICAL_TRACK_HEIGHT = 15; // 0 ~ 14 레인, 15번째가 결승선 통과!
const FINISH_LINE = VERTICAL_TRACK_HEIGHT;

const races = {};
let raceCounter = 1;

function getRaceBettingText(race) {
  const horseList = race.horses.map((h, i) => {
    const wins = getHorseWins(h.name);
    const winBadge = wins > 0 ? ` | 🏆 ${wins}승` : ' | 🏆 0승';
    return `${i + 1}번 ${h.emoji} **${h.title}** (${h.name})\n` +
           `   • 배당: **${h.odds}x** | 특성: **[${h.trait}]**${winBadge}\n` +
           `   • _${h.desc}_`;
  }).join('\n\n');

  let betList = '아직 배팅이 없습니다.';
  if (race.bets.size > 0) {
    betList = Array.from(race.bets.values())
      .map(b => `• **${b.name}**: ${b.horseId}번(${b.racerName})에 ${formatKoreanNumber(b.amount)} P`)
      .join('\n');
  }

  return `🎪 **[제 ${race.raceNo}회 대환장 동물 달리기 대회] 배팅 오픈!**\n\n` +
    `🏁 **출전 선수 명단**:\n${horseList}\n\n` +
    `📊 **배팅 내역**:\n${betList}\n\n` +
    `💬 **배팅 방법**: 버튼 클릭 또는 채팅창에 **\`1번 3000\`**, **\`2번 5천\`**, **\`3번 올인\`** 타이핑!\n` +
    `👇 배팅 후 [🏁 경기 시작] 을 누르세요! (1분 뒤 자동 출발)\n` +
    `⚠️ **주의**: 경주가 시작되면 달리는 화면이 가려지지 않도록 채팅이 자동 삭제됩니다.`;
}

function getRaceBettingKeyboard(race) {
  const horseButtons = race.horses.map((h, i) => {
    return [
      Markup.button.callback(`${h.emoji} ${i + 1}번 (+1천)`, `bet_${i + 1}_1000`),
      Markup.button.callback(`${h.emoji} ${i + 1}번 (+5천)`, `bet_${i + 1}_5000`),
      Markup.button.callback(`${h.emoji} ${i + 1}번 (올인)`, `bet_${i + 1}_all`)
    ];
  });
  horseButtons.push([Markup.button.callback('🏁 경기 시작 (출발!)', 'start_race_now')]);
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

    const autoStartAt = Date.now() + 60000;

    races[chatId] = {
      raceNo: raceCounter++,
      threadId,
      state: 'betting',
      autoStartAt,
      autoStartTimer: null,
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

    // ⏳ 60초 후 자동 출발 타이머 설정
    races[chatId].autoStartTimer = setTimeout(async () => {
      const currentRace = races[chatId];
      if (currentRace && currentRace.state === 'betting') {
        try {
          await runVerticalRaceAnimation(chatId, ctx);
        } catch (e) {}
      }
    }, 60000);
  }

  async function runVerticalRaceAnimation(chatId, ctx) {
    const race = races[chatId];
    if (!race || race.state !== 'betting') return;

    if (race.autoStartTimer) {
      clearTimeout(race.autoStartTimer);
      race.autoStartTimer = null;
    }

    race.state = 'racing';

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
    const liveExtra = { parse_mode: 'Markdown' };
    if (threadId) liveExtra.message_thread_id = threadId;

    // 🎯 부자 핸디캡(밸런스 조절) 계산
    // 보유 포인트 1,000만 P 이상 부자가 배팅한 말 판별
    const RICH_POINT_THRESHOLD = 10000000;
    const richTargetHorses = new Set();
    for (const [userId, bet] of race.bets.entries()) {
      const w = getWallet(userId, bet.name);
      if (w && (w.points + (bet.amount || 0)) >= RICH_POINT_THRESHOLD) {
        richTargetHorses.add(bet.horseId);
      }
    }

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
          if (h.calcStep) {
            outcome = h.calcStep(turn, h);
          } else {
            const s = Math.floor(Math.random() * 2) + 1;
            outcome = { step: s, effect: (s > 1 ? '💨' : '━'), msg: '' };
          }

          // 🎲 부자 배팅마 자연스러운 미세 보정 (레이스 전체에서 단 1~2번만 살짝 페이스 조절)
          if (richTargetHorses.has(h.id) && !h.nerfedOnce && turn >= 3 && Math.random() < 0.25) {
            if (outcome.step > 1) {
              outcome.step -= 1;
              h.nerfedOnce = true;
            }
          }

          h.progress = Math.min(FINISH_LINE, h.progress + outcome.step);
          h.lastEffect = outcome.effect || '';

          if (outcome.msg && (outcome.step >= 3 || outcome.step === 0 || outcome.effect === '💦' || outcome.effect === '⚡️' || outcome.effect === '🚀')) {
            turnEvents.push(`${h.emoji} **[${h.title}]** ${outcome.msg}`);
          }

          if (h.progress >= FINISH_LINE && !h.finishScore) {
            // 결승선 통과 시 사진 판독(초정밀 미세값)에서 부자 말이 동시 통과했을 경우 코끝 차이로 밀리게만 보정
            const richPenalty = richTargetHorses.has(h.id) ? (Math.random() < 0.6 ? -0.05 : 0) : 0;
            h.finishScore = (FINISH_LINE + outcome.step * 0.1) + Math.random() * 0.09 + richPenalty;
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

      try {
        await bot.telegram.editMessageText(chatId, race.messageId, null, text, { parse_mode: 'Markdown' });
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

            winners.push(`🎉 **${bet.name}**: +${formatKoreanNumber(prize)} P (배당 ${winner.odds}x)`);
          } else {
            losers.push(`💸 **${bet.name}**: -${formatKoreanNumber(bet.amount)} P`);
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
      return { success: false, reason: `잔액이 부족합니다! (현재: ${formatKoreanNumber(w.points)} P)` };
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

    await ctx.answerCbQuery(`${res.racerDisplayName}에 ${formatKoreanNumber(res.amount)} P 배팅 완료!`);

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

    const trimmed = text.trim();
    // 패턴 매칭: "1번 3000", "1 5000", "2번 올인", "3번 1만", "1번 5천", "2번 1억", "3 1조", "1번 1해" 등
    const match = trimmed.match(/^(?:\/배팅\s+|\/bet\s+)?([1-3])(?:번)?\s+([0-9만천억조경해자양구간정재극kK,.]+|올인|all)$/i);
    if (!match) return false;

    const horseId = parseInt(match[1], 10);
    const rawAmount = match[2].toLowerCase();

    let amount = 0;
    let isAllIn = false;

    if (rawAmount === '올인' || rawAmount === 'all') {
      isAllIn = true;
    } else {
      // 단위 변환: 극, 재, 정, 간, 구, 양, 자, 해, 경, 조, 억, 만, 천, k 처리
      let numStr = rawAmount.replace(/,/g, '');
      if (numStr.endsWith('극')) {
        amount = Math.floor(parseFloat(numStr.replace('극', '')) * 1e48);
      } else if (numStr.endsWith('재')) {
        amount = Math.floor(parseFloat(numStr.replace('재', '')) * 1e44);
      } else if (numStr.endsWith('정')) {
        amount = Math.floor(parseFloat(numStr.replace('정', '')) * 1e40);
      } else if (numStr.endsWith('간')) {
        amount = Math.floor(parseFloat(numStr.replace('간', '')) * 1e36);
      } else if (numStr.endsWith('구')) {
        amount = Math.floor(parseFloat(numStr.replace('구', '')) * 1e32);
      } else if (numStr.endsWith('양')) {
        amount = Math.floor(parseFloat(numStr.replace('양', '')) * 1e28);
      } else if (numStr.endsWith('자')) {
        amount = Math.floor(parseFloat(numStr.replace('자', '')) * 1e24);
      } else if (numStr.endsWith('해')) {
        amount = Math.floor(parseFloat(numStr.replace('해', '')) * 1e20);
      } else if (numStr.endsWith('경')) {
        amount = Math.floor(parseFloat(numStr.replace('경', '')) * 1e16);
      } else if (numStr.endsWith('조')) {
        amount = Math.floor(parseFloat(numStr.replace('조', '')) * 1e12);
      } else if (numStr.endsWith('억')) {
        amount = Math.floor(parseFloat(numStr.replace('억', '')) * 1e8);
      } else if (numStr.endsWith('만')) {
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
    await ctx.answerCbQuery('경기를 시작합니다!');
    return runVerticalRaceAnimation(ctx.chat.id, ctx);
  });

  return {
    handleRace,
    handleTextBet,
    races
  };
}

module.exports = {
  initHorseRace,
  races
};
