const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BOT_TOKEN = process.env.SPYFALL_BOT_TOKEN;
if (!BOT_TOKEN) { console.error('SPYFALL_BOT_TOKEN 환경변수가 없습니다'); process.exit(1); }
const bot = new Telegraf(BOT_TOKEN);

// ==========================================
// 🍱 점심 메뉴 (오션봇 meal_parser 재사용)
// ==========================================
const AI_HOME = process.env.AI_HOME || '/home/woojoo';
const PY_BIN = process.env.PY_BIN || '/usr/bin/python3';
const LUNCH_STATE_FILE = path.join(__dirname, 'lunch_state.json');
const LUNCH_CHAT_ID = process.env.LUNCH_CHAT_ID || '-1002499084612';
const LUNCH_THREAD_ID = process.env.LUNCH_THREAD_ID ? parseInt(process.env.LUNCH_THREAD_ID, 10) : 150066;
const GAME_THREAD_ID = process.env.GAME_THREAD_ID ? parseInt(process.env.GAME_THREAD_ID, 10) : 151927;

function getThreadId(ctx) {
  if (ctx.message && ctx.message.message_thread_id) return ctx.message.message_thread_id;
  if (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.message_thread_id) {
    return ctx.callbackQuery.message.message_thread_id;
  }
  return null;
}

let lunchState = {};
function loadLunchState() {
  try {
    if (fs.existsSync(LUNCH_STATE_FILE)) lunchState = JSON.parse(fs.readFileSync(LUNCH_STATE_FILE, 'utf8'));
  } catch (e) { lunchState = {}; }
}
function saveLunchState() {
  try { fs.writeFileSync(LUNCH_STATE_FILE, JSON.stringify(lunchState, null, 2), 'utf8'); } catch (e) {}
}
loadLunchState();

// 식단표 파싱: oceanbot/meal_parser.py 실행 → { day, text }
function fetchLunch(showAll) {
  return new Promise((resolve) => {
    const os = require('os');
    const payloadFile = path.join(os.tmpdir(), `spyfall-lunch-${process.pid}-${Date.now()}.json`);
    const pyFile = path.join(os.tmpdir(), `spyfall-lunch-${process.pid}-${Date.now()}.py`);
    const code = [
      'import sys, json',
      `sys.path.insert(0, ${JSON.stringify(__dirname)})`,
      'import meal_parser',
      'day = meal_parser.today_menu(meal_parser.parse(meal_parser.fetch_html()))',
      `text = meal_parser.format_message(day, show_all=${showAll ? 'True' : 'False'})`,
      `open(${JSON.stringify(payloadFile)}, "w", encoding="utf-8").write(json.dumps({"day": day, "text": text}, ensure_ascii=False))`
    ].join('\n');
    const cleanup = () => { for (const f of [pyFile, payloadFile]) { try { fs.unlinkSync(f); } catch (e) {} } };
    fs.writeFileSync(pyFile, code, 'utf8');
    execFile(PY_BIN, [pyFile], { timeout: 45000, maxBuffer: 1024 * 1024 }, (err) => {
      try {
        if (err) throw err;
        const out = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
        resolve({ day: out.day, text: out.text || '🍱 오늘 식단 정보를 찾지 못했습니다.' });
      } catch (e) {
        resolve({ day: null, text: '⚠️ 식단표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      } finally {
        cleanup();
      }
    });
  });
}

// 코너 이름 + 메뉴 미리보기 (투표 선택지, 최대 10개)
function lunchCornerOptions(day) {
  if (!day || !Array.isArray(day.lunch)) return [];
  const opts = [];
  for (const c of day.lunch) {
    const items = (c.items || []).filter(Boolean);
    if (!items.length) continue;
    const label = (c.corner || '메뉴').trim();
    let preview = items.slice(0, 2).join(' / ');
    if (preview.length > 45) preview = preview.slice(0, 45) + '…';
    opts.push(`${label} · ${preview}`);
  }
  return opts.slice(0, 10);
}

function kstDateKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
}

async function sendLunchMenu(chatId, showAll, threadId) {
  const { day, text } = await fetchLunch(!!showAll);
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (threadId) extra.message_thread_id = threadId;

  try {
    await bot.telegram.sendMessage(chatId, text, extra);
  } catch (e) {
    const fallbackExtra = {};
    if (threadId) fallbackExtra.message_thread_id = threadId;
    await bot.telegram.sendMessage(chatId, text.replace(/<[^>]+>/g, ''), fallbackExtra);
  }
  return day;
}

// 오늘 투표 없으면 1개 생성 (중복 생성 방지)
async function ensureLunchPoll(chatId, day, threadId) {
  const key = String(chatId) + (threadId ? `_${threadId}` : '');
  const today = kstDateKey();
  const existing = lunchState[key];
  if (existing && existing.date === today && existing.messageId) return existing.messageId;

  const options = lunchCornerOptions(day);
  if (!options.length) return null;
  try {
    const extra = {
      is_anonymous: false,
      allows_multiple_answers: false
    };
    if (threadId) extra.message_thread_id = threadId;

    const poll = await bot.telegram.sendPoll(chatId, '오늘 점심 뭐 드실래요? 🍽', options, extra);
    lunchState[key] = { date: today, messageId: poll.message_id, options };
    saveLunchState();
    return poll.message_id;
  } catch (e) {
    return null;
  }
}

async function handleLunch(ctx, showAll) {
  const chatId = ctx.chat.id;
  const threadId = getThreadId(ctx) || (String(chatId) === String(LUNCH_CHAT_ID) ? LUNCH_THREAD_ID : null);
  try { await ctx.sendChatAction('typing'); } catch (e) {}
  const day = await sendLunchMenu(chatId, showAll, threadId);
  if (!day) return;

  const key = String(chatId) + (threadId ? `_${threadId}` : '');
  const today = kstDateKey();
  const existing = lunchState[key];
  if (existing && existing.date === today && existing.messageId) {
    try {
      const extra = {
        reply_to_message_id: existing.messageId,
        disable_web_page_preview: true
      };
      if (threadId) extra.message_thread_id = threadId;
      await bot.telegram.sendMessage(chatId, `☝️ 오늘 점심 투표는 위 메시지에서 계속 하실 수 있습니다.`, extra);
    } catch (e) {}
    return;
  }
  await ensureLunchPoll(chatId, day, threadId);
}

async function handleLunchAll(ctx) { return handleLunch(ctx, true); }

// ==========================================
// 💰 유저 지갑 영구 저장 (DB 대용 JSON 파일)
// ==========================================
const DB_FILE = path.join(__dirname, 'wallets.json');
let wallets = {};
try {
  if (fs.existsSync(DB_FILE)) {
    wallets = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
} catch (e) {
  wallets = {};
}

function saveWallets() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(wallets, null, 2), 'utf8');
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

function getWallet(userId, name) {
  if (!wallets[userId]) {
    wallets[userId] = {
      name: name || '익명',
      points: 10000,
      lastBeg: 0,
      raceCount: 0,
      wins: 0,
      maxOdds: 0,
      maxProfit: 0,
      begCount: 0,
      bankruptHit: false,
      allInWon: false,
      unlockedTitles: [],
      activeTitle: null
    };
    saveWallets();
  }
  const w = wallets[userId];
  if (name && w.name !== name) {
    w.name = name;
  }
  if (w.raceCount === undefined) w.raceCount = 0;
  if (w.wins === undefined) w.wins = 0;
  if (w.maxOdds === undefined) w.maxOdds = 0;
  if (w.maxProfit === undefined) w.maxProfit = 0;
  if (w.begCount === undefined) w.begCount = 0;
  if (w.bankruptHit === undefined) w.bankruptHit = false;
  if (w.allInWon === undefined) w.allInWon = false;
  if (!w.unlockedTitles) w.unlockedTitles = [];
  return w;
}

// ==========================================
// 🎖️ 텔레그램 단톡방 맞춤 칭호(Custom Title) 시스템
// ==========================================
const TITLE_DEFINITIONS = [
  // 1. 자산/지갑 단계형
  { id: 't_dirt', name: '💸 흙수저 탈출', cleanName: '흙수저 탈출', desc: '잔액 1만 P 이상', check: (w) => (w.points || 0) >= 10000 },
  { id: 't_mid', name: '💼 중산층', cleanName: '중산층', desc: '잔액 5만 P 이상', check: (w) => (w.points || 0) >= 50000 },
  { id: 't_rich', name: '💰 백만장자', cleanName: '백만장자', desc: '잔액 10만 P 이상', check: (w) => (w.points || 0) >= 100000 },
  { id: 't_dia', name: '💎 다이아 수저', cleanName: '다이아 수저', desc: '잔액 50만 P 이상', check: (w) => (w.points || 0) >= 500000 },
  { id: 't_mansour', name: '👑 만수르', cleanName: '만수르', desc: '잔액 100만 P 이상', check: (w) => (w.points || 0) >= 1000000 },

  // 2. 경마/도박 업적형
  { id: 't_first_win', name: '🥉 경마 입문자', cleanName: '경마 입문자', desc: '경마 1위 1회 적중', check: (w) => (w.wins || 0) >= 1 },
  { id: 't_god', name: '🏇 경마의 신', cleanName: '경마의 신', desc: '경마 1위 5회 적중', check: (w) => (w.wins || 0) >= 5 },
  { id: 't_legend', name: '🦄 전설의 기수', cleanName: '전설의 기수', desc: '경마 1위 15회 적중', check: (w) => (w.wins || 0) >= 15 },
  { id: 't_underdog', name: '🎯 역배의 제왕', cleanName: '역배의 제왕', desc: '배당 3.0배 이상 적중', check: (w) => (w.maxOdds || 0) >= 3.0 },
  { id: 't_miracle', name: '⚡ 기적의 눈썰미', cleanName: '기적의 눈썰미', desc: '배당 5.0배 이상 적중', check: (w) => (w.maxOdds || 0) >= 5.0 },
  { id: 't_jackpot', name: '🎰 잭팟 마스터', cleanName: '잭팟 마스터', desc: '한 판에 5만 P 이상 수익', check: (w) => (w.maxProfit || 0) >= 50000 },
  { id: 't_bigwin', name: '🌊 한강 뷰', cleanName: '한강 뷰', desc: '한 판에 20만 P 이상 수익', check: (w) => (w.maxProfit || 0) >= 200000 },
  { id: 't_bankrupt', name: '☠️ 깡통 계좌', cleanName: '깡통 계좌', desc: '배팅 후 잔액 0 P 기록', check: (w) => !!w.bankruptHit },
  { id: 't_allin', name: '🎲 인생 한방러', cleanName: '인생 한방러', desc: '올인 배팅 승리 경험', check: (w) => !!w.allInWon },
  { id: 't_gambler', name: '🚨 도박 중독', cleanName: '도박 중독', desc: '경마 누적 10회 참여', check: (w) => (w.raceCount || 0) >= 10 },
  { id: 't_vip', name: '💎 마사회 VIP', cleanName: '마사회 VIP', desc: '경마 누적 30회 참여', check: (w) => (w.raceCount || 0) >= 30 },

  // 3. 알바/근면성실형
  { id: 't_cleaner', name: '🧹 탕비실 반장', cleanName: '탕비실 반장', desc: '알바(구걸) 5회 달성', check: (w) => (w.begCount || 0) >= 5 },
  { id: 't_worker', name: '📦 쿠팡 에이스', cleanName: '쿠팡 에이스', desc: '알바(구걸) 15회 달성', check: (w) => (w.begCount || 0) >= 15 },
  { id: 't_begking', name: '🪙 동냥 마스터', cleanName: '동냥 마스터', desc: '알바(구걸) 30회 달성', check: (w) => (w.begCount || 0) >= 30 }
];

function getAllTitlesForUser(w) {
  const titles = [...TITLE_DEFINITIONS];
  if (w.legacyTitleName) {
    titles.unshift({
      id: 't_legacy',
      name: `🏛️ ${w.legacyTitleName}`,
      cleanName: w.legacyTitleName,
      desc: '리셋 이전 명예 자산가 기념 칭호',
      check: () => true
    });
  }
  return titles;
}

function checkAndUnlockTitles(w) {
  if (!w.unlockedTitles) w.unlockedTitles = [];
  const newlyUnlocked = [];
  for (const t of TITLE_DEFINITIONS) {
    if (!w.unlockedTitles.includes(t.id) && t.check(w)) {
      w.unlockedTitles.push(t.id);
      newlyUnlocked.push(t);
    }
  }
  return newlyUnlocked;
}

async function applyCustomTitle(chatId, userId, rawTitle) {
  try {
    const cleanTitle = (rawTitle || '').trim().slice(0, 16);

    if (!cleanTitle) {
      // 칭호 해제 시 관리자 권한 회수
      await bot.telegram.promoteChatMember(chatId, userId, {
        can_manage_chat: false,
        can_change_info: false,
        can_delete_messages: false,
        can_invite_users: false,
        can_restrict_members: false,
        can_pin_messages: false,
        can_promote_members: false
      });
      return { ok: true, removed: true };
    }

    const member = await bot.telegram.getChatMember(chatId, userId);
    if (member.status === 'creator') {
      return {
        ok: false,
        isCreator: true,
        cleanTitle,
        error: '방장(Owner)님은 텔레그램 정책상 봇이 칭호를 바꿀 수 없습니다! [그룹 설정 > 관리자 > 내 프로필]에서 수동으로 입력해 주세요.'
      };
    }

    // 관리자 승격 시 안전한 최소 권한(초대 링크 생성만 허용)
    await bot.telegram.promoteChatMember(chatId, userId, {
      can_manage_chat: false,
      can_change_info: false,
      can_delete_messages: false,
      can_invite_users: true,
      can_restrict_members: false,
      can_pin_messages: false,
      can_promote_members: false
    });

    await bot.telegram.setChatAdministratorCustomTitle(chatId, userId, cleanTitle);
    return { ok: true, title: cleanTitle };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ==========================================
// 🤥 라이어 게임 데이터 & 룸
// ==========================================
const TITLES = [
  '연기대상', '프로 구라쟁이', '순수 100% 시민', '표정관리 장인', '동공지진 유발자',
  '사내 눈치 9단', '포커페이스 달인', '의심병 말기', '영혼 없는 리액션', '억울함 1타 강사',
  '몰이 당하는 막내', '심리전 마스터', '명탐정 코난', '발연기 권위자', '칼퇴 요정'
];

function getRandomTitle() {
  return TITLES[Math.floor(Math.random() * TITLES.length)];
}

// 🔘 메시지 하단 공통 명령어 인라인 키보드 (게임방 / 경마 결과 등)
function getGameActionButtons() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🏇 경마', 'cmd_race'),
      Markup.button.callback('🚀 비행기', 'cmd_aviator'),
      Markup.button.callback('⏳ 예정', 'cmd_upcoming')
    ],
    [
      Markup.button.callback('💰 내지갑', 'cmd_wallet'),
      Markup.button.callback('🎖️ 내칭호', 'cmd_title'),
      Markup.button.callback('🏆 랭킹', 'cmd_rank')
    ]
  ]);
}

// ==========================================
// 🏇 대환장 동물 달리기 대회 (경마/배팅 모듈 로드)
// ==========================================
const { initHorseRace } = require('./games/horse-race');
const { scheduleDaily7AMPatch } = require('./games/auto-balancer');
const { handleRace, handleTextBet, races } = initHorseRace(bot, {
  getThreadId,
  GAME_THREAD_ID,
  getWallet,
  saveWallets,
  checkAndUnlockTitles,
  getGameActionButtons,
  formatKoreanNumber
});

// ⏰ 매일 KST 07:00 동물 달리기 일일 자동 밸런스 패치 스케줄러 등록
scheduleDaily7AMPatch(bot, LUNCH_CHAT_ID, GAME_THREAD_ID);

// ==========================================
// 🚀 Aviator (비행기 크래시 모듈 로드)
// ==========================================
const { initAviator } = require('./games/aviator');
const { handleAviator, handleTextAviatorBet, aviatorGames } = initAviator(bot, {
  getThreadId,
  GAME_THREAD_ID,
  getWallet,
  saveWallets,
  checkAndUnlockTitles,
  getGameActionButtons,
  formatKoreanNumber
});

// ==========================================
// 🛡️ 토픽별 명령어 격리 / 안내 미들웨어
// ==========================================
function isGameCmd(cmd) {
  const c = normalizeCmd(cmd);
  return ['지갑', 'wallet', '내돈', '돈', '잔액', '구걸', 'beg', '알바', '충전', '랭킹', 'rank', '순위', '부자',
          '경마', 'race', '말', '경주', '비행기', '비행', 'aviator', 'crash', '크래시'].includes(c);
}

function isLunchCmd(cmd) {
  const c = normalizeCmd(cmd);
  return ['런치', 'lunch', '점심', '메뉴', '점심메뉴', '런치전체', 'lunchall', '식단', '전체메뉴'].includes(c);
}

function checkTopicRouting(ctx, rawCmd) {
  if (ctx.chat.type === 'private') return true; // 개인 DM은 제한 없음
  const threadId = getThreadId(ctx);
  const chatId = String(ctx.chat.id);

  // 대상 S급직원 그룹방이 아니면 기존대로 허용
  if (chatId !== String(LUNCH_CHAT_ID)) return true;

  // 일반(General) 토픽 (threadId가 없거나 1인 경우)에서는 모든 봇 명령어 차단
  if (!threadId || threadId === 1) {
    ctx.reply('💬 일반 대화방에서는 봇 명령어를 사용할 수 없습니다.\n• 점심 메뉴: [점심메뉴] 토픽\n• 게임/경마/지갑: [게임방] 토픽\n을 이용해 주세요!');
    return false;
  }

  // 1) 점심 명령어인데 점심방이 아닌 다른 토픽에서 호출한 경우
  if (isLunchCmd(rawCmd)) {
    if (threadId !== LUNCH_THREAD_ID) {
      ctx.reply(`🍱 점심 메뉴는 [점심메뉴] 토픽에서 확인하실 수 있습니다!`);
      return false;
    }
  }

  // 2) 게임/지갑 명령어인데 게임방이 아닌 다른 토픽에서 호출한 경우
  if (isGameCmd(rawCmd)) {
    if (threadId !== GAME_THREAD_ID) {
      ctx.reply(`🎮 게임/경마/지갑 명령어는 [게임방] 토픽에서 이용해 주세요!`);
      return false;
    }
  }

  return true;
}

// ==========================================
// 🛡️ 경주 중 채팅 방지 미들웨어
// ==========================================
bot.use(async (ctx, next) => {
  if (!ctx.message || !ctx.chat) return next();

  const chatId = ctx.chat.id;
  const race = races[chatId];

  if (race && race.state === 'racing') {
    if (ctx.message.message_id !== race.messageId) {
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (e) {}
      return;
    }
  }

  return next();
});

// ==========================================
// 📢 한글 명령어 & /헬프 도움말
// ==========================================
async function sendHelp(ctx) {
  return ctx.reply(
    '🎮 **사내 미니게임 봇 명령어 안내**\n\n' +
    '🏇 **실시간 동물 달리기 (경마 배팅)**\n' +
    '• `/경마` (또는 `/race`) : 달리기 대회 대기실 오픈\n' +
    '• 배팅 방법: `1번 50000`, `2번 1.5억`, `3번 올인` 등 자유 입력\n\n' +
    '🚀 **Aviator 비행기 (크래시 배팅)**\n' +
    '• `/비행기` (또는 `/aviator`) : 비행기 탑승 수속 오픈\n' +
    '• 배팅 방법: `비행기 50000`, `비행기 1억`, `비행기 올인` 등 자유 입력\n' +
    '• 비행 중 **[🪂 지금 탈출하기]**를 눌러 폭발 전에 익절하세요!\n\n' +
    '💰 **포인트 & 랭킹**\n' +
    '• `/지갑` (또는 `/wallet`) : 내 포인트 잔액 확인\n' +
    '• `/랭킹` (또는 `/rank`) : 사내 부자 순위 TOP 10\n' +
    '• `/칭호` (또는 `/title`) : 내 맞춤 칭호 도감 및 장착\n' +
    '• `/구걸` (또는 `/beg`) : 탕비실 분리수거 알바 (+5,000P 충전)\n\n' +
    '🍱 **점심 메뉴 (사내 식단표)**\n' +
    '• `/런치` (또는 `/lunch`) : 오늘 중식 메뉴 + 코너 투표\n' +
    '• `/런치전체` (또는 `/lunchall`) : 조식·중식·석식 전체\n' +
    '• 매일 오전 8시에 자동으로 전송됩니다.\n\n' +
    '💡 `/헬프` (또는 `/help`) 입력 시 언제든 이 설명을 다시 볼 수 있습니다!\n' +
    '👇 아래 버튼을 눌러 바로 명령어를 실행할 수 있습니다.',
    {
      parse_mode: 'Markdown',
      ...getGameActionButtons()
    }
  );
}

// ==========================================
// ⌨️ 명령어 매칭 유틸 (별칭 테이블은 파일 하단)
// ==========================================
function cmdWrap(fn) {
  return async (ctx, ...rest) => {
    const raw = (ctx.message && ctx.message.text) || '';
    if (!checkTopicRouting(ctx, raw)) return;
    return fn(ctx, ...rest);
  };
}

function stripAt(text) {
  return String(text || '').replace(/@\w+/g, '').trim();
}

function handleHelp(ctx) { return sendHelp(ctx); }

function handleWallet(ctx) {
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);
  return ctx.reply(`💰 **${w.name}** 님의 지갑\n잔액: **${formatKoreanNumber(w.points)} P**`, {
    parse_mode: 'Markdown',
    ...getGameActionButtons()
  });
}

function handleBeg(ctx) {
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);
  const now = Date.now();

  if (w.points >= 5000) {
    return ctx.reply(`🙄 아직 ${formatKoreanNumber(w.points)} P나 있으면서 구걸을 하시게요? 5,000 P 미만일 때만 가능합니다!`);
  }

  if (now - w.lastBeg < 10000) {
    const remainSec = Math.ceil((10000 - (now - w.lastBeg)) / 1000);
    return ctx.reply(`⏳ 탕비실 청소 알바 쿨타임 중입니다! (${remainSec}초 후 가능)`);
  }

  w.points += 5000;
  w.lastBeg = now;
  w.begCount = (w.begCount || 0) + 1;
  checkAndUnlockTitles(w);
  saveWallets();
  return ctx.reply(`🧹 탕비실 분리수거 알바 완료! **+5,000 P** 충전되었습니다.\n현재 잔액: **${formatKoreanNumber(w.points)} P**`, {
    parse_mode: 'Markdown',
    ...getGameActionButtons()
  });
}

function handleRank(ctx) {
  const sorted = Object.values(wallets).sort((a, b) => b.points - a.points).slice(0, 10);
  if (sorted.length === 0) return ctx.reply('아직 등록된 지갑 데이터가 없습니다.');

  const lines = sorted.map((w, idx) => {
    let medal = `${idx + 1}등`;
    if (idx === 0) medal = '🥇 1등';
    else if (idx === 1) medal = '🥈 2등';
    else if (idx === 2) medal = '🥉 3등';
    return `${medal}: **${w.name}** — ${formatKoreanNumber(w.points)} P`;
  }).join('\n');

  return ctx.reply(`🏆 **[사내 부자 랭킹 TOP 10]** 🏆\n\n${lines}`, {
    parse_mode: 'Markdown',
    ...getGameActionButtons()
  });
}


// ==========================================
// 🔘 인라인 버튼 명령어 디스패처 (말풍선 밑 버튼 동작)
// ==========================================
bot.action('cmd_race', async (ctx) => {
  await ctx.answerCbQuery('🏇 경마 대기실을 엽니다!');
  return handleRace(ctx);
});

bot.action('cmd_wallet', async (ctx) => {
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);
  const popupText = `💰 [내 지갑 정보]\n👤 ${w.name} 님\n잔액: ${formatKoreanNumber(w.points)} P`;
  return ctx.answerCbQuery(popupText, { show_alert: true });
});

bot.action('cmd_beg', async (ctx) => {
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);
  const now = Date.now();

  if (w.points >= 5000) {
    return ctx.answerCbQuery(`🙄 알바 불가!\n잔액이 5,000 P 이상이면 알바를 할 수 없습니다.\n(현재 잔액: ${formatKoreanNumber(w.points)} P)`, { show_alert: true });
  }

  if (now - w.lastBeg < 10000) {
    const remainSec = Math.ceil((10000 - (now - w.lastBeg)) / 1000);
    return ctx.answerCbQuery(`⏳ 탕비실 청소 알바 쿨타임 중!\n${remainSec}초 후에 다시 가능합니다.`, { show_alert: true });
  }

  w.points += 5000;
  w.lastBeg = now;
  w.begCount = (w.begCount || 0) + 1;
  checkAndUnlockTitles(w);
  saveWallets();
  return ctx.answerCbQuery(`🧹 탕비실 분리수거 알바 완료! (+5,000 P)\n현재 잔액: ${formatKoreanNumber(w.points)} P`, { show_alert: true });
});

bot.action('cmd_rank', async (ctx) => {
  await ctx.answerCbQuery();
  const sorted = Object.values(wallets).sort((a, b) => b.points - a.points).slice(0, 10);
  if (sorted.length === 0) return ctx.reply('아직 등록된 지갑 데이터가 없습니다.');

  const lines = sorted.map((w, idx) => {
    let medal = `${idx + 1}등`;
    if (idx === 0) medal = '🥇 1등';
    else if (idx === 1) medal = '🥈 2등';
    else if (idx === 2) medal = '🥉 3등';
    return `${medal}: **${w.name}** — ${formatKoreanNumber(w.points)} P`;
  }).join('\n');

  return ctx.reply(`🏆 **[사내 부자 랭킹 TOP 10]** 🏆\n\n${lines}`, {
    parse_mode: 'Markdown',
    ...getGameActionButtons()
  });
});

bot.action('cmd_aviator', async (ctx) => {
  await ctx.answerCbQuery('🚀 비행기 탑승을 준비합니다!');
  return handleAviator(ctx);
});

bot.action('cmd_upcoming', async (ctx) => {
  return ctx.answerCbQuery('⏳ 새로운 미니게임이 곧 추가될 예정입니다! 기대해 주세요 🎲', { show_alert: true });
});

bot.action('cmd_lunch', async (ctx) => {
  await ctx.answerCbQuery('🍱 오늘 점심 메뉴를 조회합니다!');
  const chatId = ctx.chat.id;
  const threadId = getThreadId(ctx) || (String(chatId) === String(LUNCH_CHAT_ID) ? LUNCH_THREAD_ID : null);
  const day = await sendLunchMenu(chatId, false, threadId);
  await ensureLunchPoll(chatId, day, threadId);
});

// ==========================================
// 🎖️ 칭호 조회, 선택, 해제 핸들러 & UI
// ==========================================
function getTitleSelectKeyboard(userId) {
  const w = wallets[userId] || { unlockedTitles: [] };
  checkAndUnlockTitles(w);
  const rows = [];

  const allDefs = getAllTitlesForUser(w);
  const unlocked = allDefs.filter(t => (w.unlockedTitles || []).includes(t.id));

  for (let i = 0; i < unlocked.length; i += 2) {
    const r = [];
    const t1 = unlocked[i];
    const isAct1 = w.activeTitle === t1.cleanName;
    r.push(Markup.button.callback((isAct1 ? '✅ ' : '') + t1.name, `set_title_${t1.id}`));

    if (i + 1 < unlocked.length) {
      const t2 = unlocked[i + 1];
      const isAct2 = w.activeTitle === t2.cleanName;
      r.push(Markup.button.callback((isAct2 ? '✅ ' : '') + t2.name, `set_title_${t2.id}`));
    }
    rows.push(r);
  }

  rows.push([
    Markup.button.callback('❌ 칭호 해제', 'clear_title'),
    Markup.button.callback('🔄 새로고침', 'refresh_title')
  ]);

  return Markup.inlineKeyboard(rows);
}

function getTitleListText(w) {
  checkAndUnlockTitles(w);
  saveWallets();

  const allDefs = getAllTitlesForUser(w);
  const activeStr = w.activeTitle ? `현재 장착: **${w.activeTitle}**` : '현재 장착: (없음)';
  const unlockedIds = new Set(w.unlockedTitles || []);

  const listStr = allDefs.map(t => {
    const isUnlocked = unlockedIds.has(t.id);
    const statusIcon = isUnlocked ? '🔓' : '🔒';
    const tag = isUnlocked ? (w.activeTitle === t.cleanName ? ' [장착중]' : ' [선택가능]') : ' [미달성]';
    return `${statusIcon} **${t.name}**${tag}\n   • 조건: ${t.desc}`;
  }).join('\n');

  return `🎖️ **[${w.name} 님의 맞춤 칭호 도감]**\n\n` +
    `${activeStr}\n` +
    `💡 해금 완료: **${unlockedIds.size}** / ${allDefs.length} 개\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${listStr}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `👇 아래 버튼을 눌러 그룹방에 표시될 칭호를 장착하세요!`;
}

async function handleTitle(ctx) {
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);

  return ctx.reply(getTitleListText(w), {
    parse_mode: 'Markdown',
    ...getTitleSelectKeyboard(user.id)
  });
}

bot.action('cmd_title', async (ctx) => {
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);
  checkAndUnlockTitles(w);
  saveWallets();

  const allDefs = getAllTitlesForUser(w);
  const activeStr = w.activeTitle ? `[${w.activeTitle}]` : '(없음)';
  const unlockedIds = new Set(w.unlockedTitles || []);
  const unlockedTitles = allDefs.filter(t => unlockedIds.has(t.id));

  // 텔레그램 콜백 팝업(Alert) 200자 제한 맞춤 요약
  let namesSummary = '';
  if (unlockedTitles.length > 0) {
    namesSummary = unlockedTitles.map(t => t.cleanName).join(', ');
    if (namesSummary.length > 90) {
      namesSummary = namesSummary.slice(0, 87) + '...';
    }
  } else {
    namesSummary = '없음';
  }

  const popupText = `🎖️ [내 칭호 정보]\n` +
    `👤 ${w.name} 님\n` +
    `장착중: ${activeStr}\n` +
    `달성: ${unlockedIds.size} / ${allDefs.length}개\n\n` +
    `보유: ${namesSummary}\n\n` +
    `👉 장착/해제는 채팅창에 /칭호 입력!`;

  try {
    return await ctx.answerCbQuery(popupText, { show_alert: true });
  } catch (e) {
    return ctx.answerCbQuery(`🎖️ 장착중: ${activeStr} (달성 ${unlockedIds.size}개)\n변경은 /칭호 입력!`, { show_alert: true });
  }
});

bot.action(/^set_title_(.+)$/, async (ctx) => {
  const titleId = ctx.match[1];
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);
  const allDefs = getAllTitlesForUser(w);
  const targetTitle = allDefs.find(t => t.id === titleId);

  if (!targetTitle) {
    return ctx.answerCbQuery('존재하지 않는 칭호입니다.', { show_alert: true });
  }

  checkAndUnlockTitles(w);
  if (!(w.unlockedTitles || []).includes(titleId)) {
    return ctx.answerCbQuery(`🔒 아직 달성하지 못한 칭호입니다!\n조건: ${targetTitle.desc}`, { show_alert: true });
  }

  const res = await applyCustomTitle(ctx.chat.id, user.id, targetTitle.cleanName);
  if (!res.ok) {
    if (res.isCreator) {
      w.activeTitle = targetTitle.cleanName;
      saveWallets();
      return ctx.answerCbQuery(`👑 방장 계정 안내\n텔레그램 보안상 방장의 칭호는 봇이 바꿀 수 없습니다.\n[그룹 설정 > 관리자]에서 직접 [${targetTitle.cleanName}] 로 변경해 주세요! (봇 도감 장착 완료)`, { show_alert: true });
    }
    if (res.error && res.error.includes('RIGHT_FORBIDDEN')) {
      return ctx.answerCbQuery('⚠️ 봇에게 [새 관리자 추가/관리] 권한이 없어 맞춤 칭호를 변경하지 못했습니다! 방장님께 봇 관리자 권한을 부여해달라고 요청해주세요.', { show_alert: true });
    }
    return ctx.answerCbQuery(`⚠️ 텔레그램 칭호 설정 실패: ${res.error}`, { show_alert: true });
  }

  w.activeTitle = targetTitle.cleanName;
  saveWallets();

  await ctx.answerCbQuery(`✅ [${targetTitle.cleanName}] 칭호를 장착했습니다!`, { show_alert: true });

  try {
    await ctx.editMessageText(getTitleListText(w), {
      parse_mode: 'Markdown',
      ...getTitleSelectKeyboard(user.id)
    });
  } catch (e) {}
});

bot.action('clear_title', async (ctx) => {
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);

  const res = await applyCustomTitle(ctx.chat.id, user.id, '');
  w.activeTitle = null;
  saveWallets();

  if (!res.ok && !res.isCreator) {
    return ctx.answerCbQuery(`⚠️ 칭호 해제 중 알림: ${res.error || '권한 없음'} (봇 내부 해제 완료)`, { show_alert: true });
  }

  await ctx.answerCbQuery('❌ 칭호가 해제되었습니다.', { show_alert: true });
  try {
    await ctx.editMessageText(getTitleListText(w), {
      parse_mode: 'Markdown',
      ...getTitleSelectKeyboard(user.id)
    });
  } catch (e) {}
});

bot.action('refresh_title', async (ctx) => {
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);
  await ctx.answerCbQuery('새로고침 되었습니다.');
  try {
    await ctx.editMessageText(getTitleListText(w), {
      parse_mode: 'Markdown',
      ...getTitleSelectKeyboard(user.id)
    });
  } catch (e) {}
});


// ==========================================
// ⌨️ 한글 명령어 관대한 매칭 (오타·공백·대소문자 무시)
// Telegraf exact-match로는 /경 마, /헬프@oceanspybot 같은 입력이 누락되므로 보조 핸들러 추가
// ==========================================
const CMD_ALIASES = [
  { keys: ['start', 'help', '헬프', '도움말', '명령어', '도움'], fn: sendHelp },
  { keys: ['지갑', 'wallet', '내돈', '돈', '잔액'], fn: handleWallet },
  { keys: ['구걸', 'beg', '알바', '충전'], fn: handleBeg },
  { keys: ['칭호', 'title', '칭호목록', '내칭호'], fn: handleTitle },
  { keys: ['랭킹', 'rank', '순위', '부자'], fn: handleRank },
  { keys: ['경마', 'race', '말', '경주', '달리기'], fn: handleRace },
  { keys: ['비행기', '비행', 'aviator', 'crash', '크래시'], fn: handleAviator },
  { keys: ['런치', 'lunch', '점심', '메뉴', '점심메뉴'], fn: handleLunch },
  { keys: ['런치전체', 'lunchall', '식단', '전체메뉴'], fn: handleLunchAll }
];

function normalizeCmd(raw) {
  return stripAt(raw).replace(/^\/+/, '').replace(/\s+/g, '').toLowerCase();
}

function lookupAlias(raw) {
  const key = normalizeCmd(raw);
  if (!key) return null;
  return CMD_ALIASES.find(a => a.keys.some(k => k.toLowerCase() === key)) || null;
}

bot.on('text', async (ctx, next) => {
  const raw = ctx.message && ctx.message.text;
  if (!raw) return next();

  // 🏇 경마 대기실 텍스트 배팅 감지 (예: "1번 3000", "2번 올인", "3번 5천" 등)
  if (handleTextBet) {
    const handled = await handleTextBet(ctx, raw);
    if (handled) return; // 배팅 처리 완료 시 다음 미들웨어 건너뜀
  }

  // 🚀 Aviator 대기실 텍스트 배팅 감지 (예: "비행기 50000", "비행기 1억", "비행기 올인" 등)
  if (handleTextAviatorBet) {
    const handled = await handleTextAviatorBet(ctx, raw);
    if (handled) return;
  }

  if (!raw.trim().startsWith('/')) return next();

  const hit = lookupAlias(raw);
  if (!hit) return next();

  const isBotCommand = (ctx.message.entities || []).some(e => e.type === 'bot_command' && e.offset === 0);
  if (isBotCommand) return next(); // 위쪽 정확 매칭이 이미 처리

  if (!checkTopicRouting(ctx, raw)) return;

  try {
    return await hit.fn(ctx);
  } catch (e) {
    return ctx.reply(`⚠️ 명령어 처리 중 오류: ${e.message}`);
  }
});

// ==========================================
// 📢 명령어 등록 (정확일치) — 모든 핸들러 정의 이후
// ==========================================
bot.command(['start', 'help', '헬프', '도움말'], cmdWrap(handleHelp));
bot.command(['지갑', 'wallet', '내돈', '돈'], cmdWrap(handleWallet));
bot.command(['구걸', 'beg', '알바', '충전'], cmdWrap(handleBeg));
bot.command(['칭호', 'title'], cmdWrap(handleTitle));
bot.command(['랭킹', 'rank', '순위', '부자'], cmdWrap(handleRank));
bot.command(['런치', 'lunch', '점심', '메뉴'], cmdWrap(handleLunch));
bot.command(['런치전체', 'lunchall', '식단', '전체메뉴'], cmdWrap(handleLunchAll));
bot.command(['경마', 'race', '말', '달리기'], cmdWrap(handleRace));
bot.command(['비행기', '비행', 'aviator', 'crash', '크래시'], cmdWrap(handleAviator));

// ==========================================
// 📋 텔레그램 슬래시 메뉴 등록 (setMyCommands)
// ==========================================
const BOT_COMMANDS = [
  { command: 'help', description: '명령어 안내 (/헬프)' },
  { command: 'race', description: '동물 달리기 대회 열기 (/경마)' },
  { command: 'aviator', description: 'Aviator 비행기 탑승 (/비행기)' },
  { command: 'wallet', description: '내 포인트 잔액 (/지갑)' },
  { command: 'beg', description: '알바해서 포인트 충전 (/구걸)' },
  { command: 'title', description: '내 맞춤 칭호 도감 및 장착 (/칭호)' },
  { command: 'rank', description: '부자 랭킹 TOP 10 (/랭킹)' },
  { command: 'lunch', description: '오늘 점심 메뉴 (/런치)' },
  { command: 'lunchall', description: '조식·중식·석식 전체 (/런치전체)' }
];

async function registerCommands() {
  try {
    await bot.telegram.setMyCommands(BOT_COMMANDS);
    console.log('✅ 명령어 메뉴 등록 완료');
  } catch (e) {
    console.log('⚠️ setMyCommands 실패:', e.message);
  }
}

bot.launch().then(() => {
  console.log('🏇 Game Suite (Full Finish Line Touchdown) Bot is running...');
  registerCommands();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
