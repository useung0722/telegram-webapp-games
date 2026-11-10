const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');
const { getUserSessionCount, incrementUserSession } = require('./user-session');

// ==========================================
// 🚀 Aviator (비행기 / 로켓 크래시 게임 모듈)
// ==========================================

const aviatorGames = {};
let flightCounter = 1;

// 한국어 큰 숫자 포맷터 (경마 모듈과 통일)
function formatKoreanNumber(val) {
  if (val === undefined || val === null) return '0';
  let isNegative = false;
  let str = String(val).trim();
  if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1);
  }

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

  let bi;
  try {
    const dotPos = str.indexOf('.');
    const intPart = dotPos >= 0 ? str.slice(0, dotPos) : str;
    bi = BigInt(intPart || '0');
  } catch (e) {
    const num = Math.floor(Number(val));
    return isNaN(num) ? '0' : num.toLocaleString();
  }

  if (bi === 0n) return '0';

  const units = [
    { name: '극', val: 10n ** 48n },
    { name: '재', val: 10n ** 44n },
    { name: '정', val: 10n ** 40n },
    { name: '간', val: 10n ** 36n },
    { name: '구', val: 10n ** 32n },
    { name: '양', val: 10n ** 28n },
    { name: '자', val: 10n ** 24n },
    { name: '해', val: 10n ** 20n },
    { name: '경', val: 10n ** 16n },
    { name: '조', val: 10n ** 12n },
    { name: '억', val: 10n ** 8n },
    { name: '만', val: 10000n }
  ];

  for (const u of units) {
    if (bi >= u.val) {
      const whole = bi / u.val;
      const remainder = bi % u.val;
      const fraction = Number((remainder * 100n) / u.val) / 100;
      const total = Number(whole) + fraction;
      const formatted = (total >= 100 || Number.isInteger(total))
        ? Math.floor(total).toLocaleString()
        : total.toFixed(2).replace(/\.?0+$/, '');
      return (isNegative ? '-' : '') + formatted + u.name;
    }
  }

  return (isNegative ? '-' : '') + Number(bi).toLocaleString();
}

// 텍스트 금액 파싱 (만, 억, 조, 경, 해 등 지원)
function parseAmountText(rawAmount) {
  let numStr = String(rawAmount).toLowerCase().replace(/,/g, '').trim();
  if (numStr.endsWith('극')) return Math.floor(parseFloat(numStr.replace('극', '')) * 1e48);
  if (numStr.endsWith('재')) return Math.floor(parseFloat(numStr.replace('재', '')) * 1e44);
  if (numStr.endsWith('정')) return Math.floor(parseFloat(numStr.replace('정', '')) * 1e40);
  if (numStr.endsWith('간')) return Math.floor(parseFloat(numStr.replace('간', '')) * 1e36);
  if (numStr.endsWith('구')) return Math.floor(parseFloat(numStr.replace('구', '')) * 1e32);
  if (numStr.endsWith('양')) return Math.floor(parseFloat(numStr.replace('양', '')) * 1e28);
  if (numStr.endsWith('자')) return Math.floor(parseFloat(numStr.replace('자', '')) * 1e24);
  if (numStr.endsWith('해')) return Math.floor(parseFloat(numStr.replace('해', '')) * 1e20);
  if (numStr.endsWith('경')) return Math.floor(parseFloat(numStr.replace('경', '')) * 1e16);
  if (numStr.endsWith('조')) return Math.floor(parseFloat(numStr.replace('조', '')) * 1e12);
  if (numStr.endsWith('억')) return Math.floor(parseFloat(numStr.replace('억', '')) * 1e8);
  if (numStr.endsWith('만')) return Math.floor(parseFloat(numStr.replace('만', '')) * 10000);
  if (numStr.endsWith('천') || numStr.endsWith('k')) return Math.floor(parseFloat(numStr.replace(/[천k]/g, '')) * 1000);
  return parseInt(numStr, 10);
}

// 크래시 배수 생성 알고리즘 (하우스 엣지 및 세션/부자 동적 보정)
function generateCrashPoint(hasRichPassenger, sessionType) {
  // 1) 🎯 부자(1,000만 P 이상) 또는 세션 16판 이상 과몰입 유저 탑승 시:
  //    약 55% 확률로 1.00x ~ 1.35x 극초반에 폭발(침몰) 유도
  const isTargetNerf = hasRichPassenger || sessionType === 'veteran';
  if (isTargetNerf && Math.random() < 0.55) {
    const earlyFails = [1.00, 1.05, 1.10, 1.18, 1.25, 1.32];
    return earlyFails[Math.floor(Math.random() * earlyFails.length)];
  }

  // 2) 🎁 세션 초반(1~8판) 유저 탑승 시:
  //    초반 즉사(1.00x) 확률 0%, 안정적인 비행(최소 1.8x ~ 높은 고도 보장)
  if (sessionType === 'rookie') {
    const r = Math.random();
    const crash = 1.60 + (1.2 / (1 - r * 0.85)); // 최소 1.8x ~ 9.6x
    return Math.round(crash * 100) / 100;
  }

  const r = Math.random();
  // 기본 4% 확률로 이륙 즉시 폭발 (1.00x)
  if (r < 0.04) return 1.00;
  // 표준 Crash 공식: Crash = 0.96 / (1 - r)
  const crash = 0.96 / (1 - r);
  return Math.max(1.01, Math.round(crash * 100) / 100);
}

// 대기실 안내 메시지 생성
function getLobbyText(game) {
  let passengerList = '아직 탑승자가 없습니다.';
  if (game.bets.size > 0) {
    passengerList = Array.from(game.bets.values())
      .map(b => `• 🧑‍✈️ **${b.name}**: ${formatKoreanNumber(b.amount)} P`)
      .join('\n');
  }

  return `🛫 **[제 ${game.flightNo}편 Aviator 에어라인] 탑승 수속 중!**\n\n` +
    `비행기가 이륙하면 배수가 점점 치솟습니다!\n` +
    `비행기가 불시에 **공중 폭발💥하기 전**에 [🪂 탈출하기]를 눌러 익절하세요!\n\n` +
    `👥 **현재 탑승 명단 (${game.bets.size}명)**:\n${passengerList}\n\n` +
    `💬 **배팅 방법**: 버튼 클릭 또는 채팅창에 **\`비행기 50000\`**, **\`비행기 1억\`**, **\`비행기 올인\`** 타이핑!\n` +
    `👇 배팅 후 [🚀 이륙하기] 를 누르면 즉시 출발합니다! (1분 뒤 자동 이륙)`;
}

// 대기실 키보드
function getLobbyKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('+1천 P', 'av_bet_1000'),
      Markup.button.callback('+5천 P', 'av_bet_5000'),
      Markup.button.callback('+1만 P', 'av_bet_10000')
    ],
    [
      Markup.button.callback('+5만 P', 'av_bet_50000'),
      Markup.button.callback('+10만 P', 'av_bet_100000'),
      Markup.button.callback('🔥 올인', 'av_bet_all')
    ],
    [Markup.button.callback('🚀 이륙하기 (지금 출발!)', 'av_start_now')]
  ]);
}

// 비행 중 텍스트 & 아스키 궤적 생성
function getFlightText(game) {
  const mult = game.currentMultiplier.toFixed(2);
  const flightSec = (game.elapsedMs / 1000).toFixed(1);
  const step = Math.max(0, Math.min(10, Math.floor((game.elapsedMs || 0) / 1000)));
  const trail = '━'.repeat(step);

  let passengerStatus = [];
  for (const b of game.bets.values()) {
    if (b.cashedOut) {
      passengerStatus.push(`• 🪂 **${b.name}**: **${b.cashMultiplier.toFixed(2)}x** 탈출 성공! (+${formatKoreanNumber(b.profit)} P 이익)`);
    } else {
      passengerStatus.push(`• ✈️ **${b.name}**: 탑승 중... (${formatKoreanNumber(b.amount)} P)`);
    }
  }

  return `✈️ **FLYING HIGH... [제 ${game.flightNo}편]** ✈️\n\n` +
    `📈 **현재 배수**:  🚀 **\`${mult}x\`** (${flightSec}초 경과)\n` +
    `🛫 **고도 궤적**:  \`${trail}✈️\`\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `👥 **탑승자 현황**:\n${passengerStatus.join('\n')}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `⚡️ 언제 터질지 모릅니다! 버튼을 누르면 **서버 실시간 배율**로 즉시 탈출합니다!`;
}

// 비행 중 키보드 (실시간 탈출 버튼)
function getFlightKeyboard(mult) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`🪂 지금 탈출하기 (${mult.toFixed(2)}x)`, 'av_cashout')]
  ]);
}

/**
 * Aviator 모듈 등록
 */
function initAviator(bot, helpers) {
  const {
    getThreadId,
    GAME_THREAD_ID,
    getWallet,
    saveWallets,
    checkAndUnlockTitles,
    getGameActionButtons
  } = helpers;

  // 비행 시작 로직
  async function startFlight(chatId, ctx) {
    const game = aviatorGames[chatId];
    if (!game || game.state !== 'lobby') return;

    if (game.autoStartTimer) {
      clearTimeout(game.autoStartTimer);
      game.autoStartTimer = null;
    }

    if (game.bets.size === 0) {
      try {
        const extra = { parse_mode: 'Markdown' };
        if (game.threadId) extra.message_thread_id = game.threadId;
        await bot.telegram.sendMessage(chatId, '⚠️ 아무도 탑승하지 않아 비행이 취소되었습니다.', extra);
      } catch (e) {}
      delete aviatorGames[chatId];
      return;
    }

    // 🎯 부자 판별 & 세션 피로도 확인
    const RICH_POINT_THRESHOLD = 10000000;
    let hasRichPassenger = false;
    let hasRookie = false;
    let hasVeteran = false;

    for (const b of game.bets.values()) {
      const w = getWallet(b.userId, b.name);
      const sessionCount = incrementUserSession(b.userId);

      if (w && ((w.points || 0) + (b.amount || 0)) >= RICH_POINT_THRESHOLD) {
        hasRichPassenger = true;
      }
      if (sessionCount <= 8) {
        hasRookie = true;
      } else if (sessionCount >= 16) {
        hasVeteran = true;
      }
    }

    let sessionType = 'normal';
    if (hasVeteran) sessionType = 'veteran';
    else if (hasRookie) sessionType = 'rookie';

    game.state = 'flying';
    game.tick = 0;
    game.startTime = Date.now();
    game.elapsedMs = 0;
    game.currentMultiplier = 1.00;
    game.crashMultiplier = generateCrashPoint(hasRichPassenger, sessionType);
    game.lastTelegramUpdate = Date.now();
    game.isEditingMessage = false;

    // 이전 대기실 카드 정리
    if (game.lastLobbyMessageId) {
      try {
        await ctx.deleteMessage(game.lastLobbyMessageId);
      } catch (e) {}
    }

    // 시작 안내 메시지 전송
    let flightMsg;
    try {
      const extra = {
        parse_mode: 'Markdown',
        ...getFlightKeyboard(1.00)
      };
      const threadId = game.threadId || getThreadId(ctx) || GAME_THREAD_ID;
      if (threadId) extra.message_thread_id = threadId;
      flightMsg = await bot.telegram.sendMessage(chatId, getFlightText(game), extra);
      game.flightMessageId = flightMsg.message_id;
    } catch (e) {
      console.error('❌ Aviator startFlight error:', e);
      return;
    }

    // ⚡ 100ms (0.1초) 초정밀 서버 틱 루프
    const TICK_INTERVAL = 100; // 0.1초 서버 계산 주기
    const TELEGRAM_SYNC_INTERVAL = 2000; // 2초 주기 텔레그램 화면 갱신

    const flightTimer = setInterval(async () => {
      // 1) 0.1초 단위 시간 경과 및 수학적 배수 계산
      // t초 경과 시: 배수 = e^(0.10 * t) 곡선 (실제 크래시 게임 표준 지수 모델, 배율 상승 가속)
      // 0초: 1.00x, 2초: ~1.22x, 5초: ~1.65x, 10초: ~2.72x, 20초: ~7.39x, 30초: ~20.09x
      game.elapsedMs = Date.now() - game.startTime;
      const tSec = game.elapsedMs / 1000;
      const calculatedMult = Math.exp(0.10 * tSec);
      game.currentMultiplier = Math.round(calculatedMult * 100) / 100;

      // 2) 실시간 폭발(Crash) 감지 (0.1초 단위로 정확히 감지)
      if (game.currentMultiplier >= game.crashMultiplier) {
        clearInterval(flightTimer);
        game.state = 'crashed';
        const finalCrash = game.crashMultiplier.toFixed(2);

        // 결과 정산
        const survivors = [];
        const casualties = [];

        for (const b of game.bets.values()) {
          const w = getWallet(b.userId, b.name);
          if (b.cashedOut) {
            w.points += b.payout;
            w.wins = (w.wins || 0) + 1;
            survivors.push(`• 🪂 **${b.name}**: **${b.cashMultiplier.toFixed(2)}x** 탈출 성공! (+${formatKoreanNumber(b.profit)} P 이익)`);
          } else {
            if (w.points <= 0) {
              w.points = 100000;
              w.bankruptHit = true;
              casualties.push(`• 💀 **${b.name}**: 폭발로 침몰... (-${formatKoreanNumber(b.amount)} P) ➡️ 💥 파산 구제금 +10만 P 자동 지급!`);
            } else {
              casualties.push(`• 💀 **${b.name}**: 폭발로 침몰... (-${formatKoreanNumber(b.amount)} P)`);
            }
          }
        }
        saveWallets();

        // 칭호 체크
        const newlyUnlocked = [];
        for (const b of game.bets.values()) {
          const w = getWallet(b.userId, b.name);
          const unlocked = checkAndUnlockTitles(w);
          for (const title of unlocked) {
            newlyUnlocked.push(`🎉 **${b.name}**님이 새 칭호 획득: 🎖️ **[${title}]**`);
          }
        }
        saveWallets();

        // 비행 메시지를 폭발 애니메이션으로 수정
        try {
          await bot.telegram.editMessageText(
            chatId,
            game.flightMessageId,
            null,
            `💥💥 **BOOM!! [제 ${game.flightNo}편 폭발!]** 💥💥\n\n` +
            `비행기가 **\`${finalCrash}x\`** (${(game.elapsedMs / 1000).toFixed(1)}초) 고도에서 공중 분해되었습니다!\n` +
            `\`━━━━━━━━━💥💨💨\``,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {}

        // 최종 정산표 전송
        let resultText = `📋 **[제 ${game.flightNo}편 비행 기록 & 정산]**\n\n` +
          `🏁 **폭발 고도**: **${finalCrash}x** (${(game.elapsedMs / 1000).toFixed(1)}초)\n\n` +
          `━━━━━━━━━━━━━━━\n`;

        if (survivors.length > 0) {
          resultText += `🏆 **탈출 성공자 (생존)**:\n${survivors.join('\n')}\n\n`;
        }
        if (casualties.length > 0) {
          resultText += `💀 **탈출 실패자 (희생자)**:\n${casualties.join('\n')}\n\n`;
        }

        if (newlyUnlocked.length > 0) {
          resultText += `━━━━━━━━━━━━━━━\n` + newlyUnlocked.join('\n') + `\n`;
        }

        resultText += `━━━━━━━━━━━━━━━\n아래 버튼을 눌러 다음 비행을 준비하거나 지갑/경마를 확인하세요!`;

        setTimeout(async () => {
          try {
            const extra = { parse_mode: 'Markdown', ...getGameActionButtons() };
            if (game.threadId) extra.message_thread_id = game.threadId;
            await bot.telegram.sendMessage(chatId, resultText, extra);
          } catch (e) {}
          delete aviatorGames[chatId];
        }, 1200);

        return;
      }

      // 3) 2초 주기 텔레그램 화면 메시지 갱신 (Rate Limit 방어 & 논블로킹)
      const now = Date.now();
      if (now - game.lastTelegramUpdate >= TELEGRAM_SYNC_INTERVAL && !game.isEditingMessage) {
        game.lastTelegramUpdate = now;
        game.isEditingMessage = true;
        try {
          await bot.telegram.editMessageText(
            chatId,
            game.flightMessageId,
            null,
            getFlightText(game),
            {
              parse_mode: 'Markdown',
              ...getFlightKeyboard(game.currentMultiplier)
            }
          );
        } catch (e) {
          // 동일 텍스트 수정 에러 등 무시
        } finally {
          game.isEditingMessage = false;
        }
      }
    }, TICK_INTERVAL);
  }

  // 배팅 처리 함수
  function processBet(chatId, user, amount, isAllIn) {
    const game = aviatorGames[chatId];
    if (!game || game.state !== 'lobby') {
      return { success: false, reason: '현재 탑승 수속 시간이 아닙니다.' };
    }

    const rawName = user.first_name + (user.last_name ? ' ' + user.last_name : '');
    const w = getWallet(user.id, rawName);

    if (w.points <= 0) {
      return { success: false, reason: '보유 포인트가 0P입니다! `/구걸` 로 충전하세요.' };
    }

    let finalAmount = amount;
    if (isAllIn) {
      finalAmount = w.points;
    }

    if (finalAmount <= 0) {
      return { success: false, reason: '올바른 배팅 금액을 입력해주세요.' };
    }

    if (w.points < finalAmount) {
      return {
        success: false,
        reason: `포인트가 부족합니다! (보유: ${formatKoreanNumber(w.points)} P, 신청: ${formatKoreanNumber(finalAmount)} P)`
      };
    }

    // 기존 배팅이 있다면 누적
    const existing = game.bets.get(user.id);
    if (existing) {
      w.points -= finalAmount;
      existing.amount += finalAmount;
      saveWallets();
      return { success: true, updated: true, total: existing.amount, name: rawName };
    }

    w.points -= finalAmount;
    game.bets.set(user.id, {
      userId: user.id,
      name: rawName,
      amount: finalAmount,
      cashedOut: false,
      cashMultiplier: 0,
      payout: 0,
      profit: 0
    });
    saveWallets();

    return { success: true, updated: false, total: finalAmount, name: rawName };
  }

  // 명령어 /비행기 핸들러
  async function handleAviator(ctx) {
    if (ctx.chat.type === 'private') {
      return ctx.reply('⚠️ Aviator는 단톡방(그룹)에서 함께 즐겨주세요!');
    }

    const chatId = ctx.chat.id;
    if (aviatorGames[chatId]) {
      return ctx.reply('⚠️ 이미 준비 중이거나 비행 중인 게임이 있습니다!');
    }

    const threadId = getThreadId(ctx) || GAME_THREAD_ID;
    const autoStartAt = Date.now() + 60000;

    aviatorGames[chatId] = {
      flightNo: flightCounter++,
      threadId,
      state: 'lobby',
      autoStartAt,
      autoStartTimer: null,
      bets: new Map(),
      lastLobbyMessageId: null,
      flightMessageId: null,
      currentMultiplier: 1.00,
      crashMultiplier: 1.00,
      tick: 0
    };

    const game = aviatorGames[chatId];
    const extra = {
      parse_mode: 'Markdown',
      ...getLobbyKeyboard()
    };
    if (threadId) extra.message_thread_id = threadId;

    const sent = await bot.telegram.sendMessage(chatId, getLobbyText(game), extra);
    game.lastLobbyMessageId = sent.message_id;

    // 60초 자동 출발 타이머
    game.autoStartTimer = setTimeout(async () => {
      if (aviatorGames[chatId] && aviatorGames[chatId].state === 'lobby') {
        await startFlight(chatId, ctx);
      }
    }, 60000);
  }

  // 텍스트 배팅 감지 (예: "비행기 50000", "비행기 1억", "비행기 올인", "aviator 1만")
  async function handleTextAviatorBet(ctx, text) {
    const chatId = ctx.chat.id;
    const game = aviatorGames[chatId];
    if (!game || game.state !== 'lobby') return false;

    const trimmed = text.trim();
    const match = trimmed.match(/^(?:\/)?(?:비행기|비행|aviator|crash|크래시)\s+([0-9만천억조경해자양구간정재극kK,.]+|올인|all)$/i);
    if (!match) return false;

    const rawAmount = match[1].toLowerCase();
    let isAllIn = (rawAmount === '올인' || rawAmount === 'all');
    let amount = 0;

    if (!isAllIn) {
      amount = parseAmountText(rawAmount);
      if (!amount || isNaN(amount) || amount <= 0) return false;
    }

    const res = processBet(chatId, ctx.from, amount, isAllIn);
    try {
      await ctx.deleteMessage();
    } catch (e) {}

    if (!res.success) {
      try {
        const warnMsg = await ctx.reply(`⚠️ [${res.name || '알림'}] ${res.reason}`);
        setTimeout(() => ctx.deleteMessage(warnMsg.message_id).catch(() => {}), 4000);
      } catch (e) {}
      return true;
    }

    // 대기실 메시지 갱신
    try {
      if (game.lastLobbyMessageId) {
        await bot.telegram.editMessageText(
          chatId,
          game.lastLobbyMessageId,
          null,
          getLobbyText(game),
          {
            parse_mode: 'Markdown',
            ...getLobbyKeyboard()
          }
        );
      }
    } catch (e) {}

    return true;
  }

  // 콜백 쿼리 핸들러 등록
  bot.action(/^av_bet_(\d+|all)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const game = aviatorGames[chatId];
    if (!game || game.state !== 'lobby') {
      return ctx.answerCbQuery('현재 탑승 수속 시간이 아닙니다.');
    }

    const val = ctx.match[1];
    const isAllIn = (val === 'all');
    const amount = isAllIn ? 0 : parseInt(val, 10);

    const res = processBet(chatId, ctx.from, amount, isAllIn);
    if (!res.success) {
      return ctx.answerCbQuery(`⚠️ ${res.reason}`, { show_alert: true });
    }

    await ctx.answerCbQuery(`✅ 탑승 완료! 총 배팅: ${formatKoreanNumber(res.total)} P`);

    try {
      await ctx.editMessageText(getLobbyText(game), {
        parse_mode: 'Markdown',
        ...getLobbyKeyboard()
      });
    } catch (e) {}
  });

  // 이륙 버튼
  bot.action('av_start_now', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = aviatorGames[chatId];
    if (!game || game.state !== 'lobby') {
      return ctx.answerCbQuery('대기 중인 비행기가 없습니다.');
    }
    await ctx.answerCbQuery('🚀 지금 이륙합니다!');
    await startFlight(chatId, ctx);
  });

  // 실시간 탈출(캐시아웃) 버튼
  bot.action('av_cashout', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = aviatorGames[chatId];
    if (!game || game.state !== 'flying') {
      return ctx.answerCbQuery('현재 비행 중이 아닙니다.');
    }

    const userId = ctx.from.id;
    const bet = game.bets.get(userId);
    if (!bet) {
      return ctx.answerCbQuery('⚠️ 이번 비행에 탑승하지 않았습니다!', { show_alert: true });
    }

    if (bet.cashedOut) {
      return ctx.answerCbQuery(`이미 ${bet.cashMultiplier.toFixed(2)}x에서 탈출하셨습니다! 🪂`);
    }

    // 즉시 탈출 확정
    bet.cashedOut = true;
    bet.cashMultiplier = game.currentMultiplier;
    bet.payout = Math.floor(bet.amount * game.currentMultiplier);
    bet.profit = bet.payout - bet.amount;

    await ctx.answerCbQuery(`🎉 [${bet.cashMultiplier.toFixed(2)}x] 탈출 성공! (+${formatKoreanNumber(bet.profit)} P 이익)`, { show_alert: true });
  });

  return {
    handleAviator,
    handleTextAviatorBet,
    aviatorGames
  };
}

module.exports = {
  initAviator
};
