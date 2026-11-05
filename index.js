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

const WORD_PACKS = [
  { category: '음식 / 배달', words: ['탕수육', '마라탕', '치킨', '피자', '떡볶이', '짜장면', '삼겹살', '초밥', '햄버거', '라면', '김치찌개', '돈까스', '곱창', '족발', '붕어빵'] },
  { category: '직장 생활 / 회사', words: ['탕비실', '야근', '월급', '사원증', '법인카드', '연차', '회의실', '커피머신', '슬랙', '엑셀', '보고서', '대표님', '회식', '칼퇴', '출근길'] },
  { category: '전자제품 / IT', words: ['노트북', '스마트폰', '무선이어폰', '보조배터리', '마우스', '키보드', '스마트워치', '태블릿', '모니터', '냉장고', '에어컨', '로봇청소기', '선풍기'] },
  { category: '동물', words: ['호랑이', '강아지', '고양이', '판다', '기린', '코끼리', '펭귄', '돌고래', '캥거루', '카멜레온', '원숭이', '토끼', '악어', '햄스터'] },
  { category: '장소 / 여행', words: ['제주도', '놀이공원', '워터파크', '영화관', '찜질방', '공항', '도서관', '편의점', '헬스장', '노래방', '캠핑장', '백화점', '동물원'] },
  { category: '일상 / 취미', words: ['유튜브', '넷플릭스', '인스타그램', '낮잠', '쇼핑', '독서', '달리기', '낚시', '등산', '게임', '골프', '보드게임'] }
];

const games = {};

function getLobbyText(game) {
  const playerList = game.players.size > 0
    ? Array.from(game.players.values()).map((p, i) => `${i + 1}. [${p.title}] **${p.name}**`).join('\n')
    : '(아직 참가자가 없습니다)';

  return '☕️ **[커피 내기 라이어 게임] 대기실!**\n\n' +
    '아래 [🙋 참가하기] 버튼을 눌러주세요 (최소 3명).\n' +
    '버튼이 대화에 밀렸다면 `/끌올` 로 언제든 끌어올릴 수 있습니다.\n\n' +
    '☕️ **벌칙 룰**:\n' +
    '• 라이어 패배 시 👉 **라이어가 커피 쏘기!**\n' +
    '• 라이어 승리 시 👉 **나머지 시민 중 랜덤 1명이 커피 쏘기!** 🎯\n\n' +
    `👥 **참가자 명단 (${game.players.size}명)**:\n${playerList}`;
}

function getLobbyKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🙋 참가하기', 'join_game'), Markup.button.callback('🚪 나가기', 'leave_game')],
    [Markup.button.callback('🚀 바로 시작하기', 'force_start')]
  ]);
}

// 🔘 메시지 하단 공통 명령어 인라인 키보드 (게임방 / 경마 결과 등)
function getGameActionButtons() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🏇 다음 경마', 'cmd_race'),
      Markup.button.callback('💰 내 지갑', 'cmd_wallet'),
      Markup.button.callback('🧹 구걸(알바)', 'cmd_beg')
    ],
    [
      Markup.button.callback('🎖️ 내 칭호', 'cmd_title'),
      Markup.button.callback('🏆 부자 랭킹', 'cmd_rank'),
      Markup.button.callback('🤥 라이어 게임', 'cmd_game')
    ],
    [
      Markup.button.callback('🍱 점심 메뉴', 'cmd_lunch')
    ]
  ]);
}

// ==========================================
// 🏇 대환장 동물 달리기 대회 (경마/배팅 모듈 로드)
// ==========================================
const { initHorseRace } = require('./games/horse-race');
const { handleRace, races } = initHorseRace(bot, {
  getThreadId,
  GAME_THREAD_ID,
  getWallet,
  saveWallets,
  checkAndUnlockTitles,
  getGameActionButtons
});

// ==========================================
// 🛡️ 토픽별 명령어 격리 / 안내 미들웨어
// ==========================================
function isGameCmd(cmd) {
  const c = normalizeCmd(cmd);
  return ['지갑', 'wallet', '내돈', '돈', '잔액', '구걸', 'beg', '알바', '충전', '랭킹', 'rank', '순위', '부자',
          '경마', 'race', '말', '경주', '게임', 'game', '라이어', '끌올', 'up', 'pull',
          '시작', 'startgame', '스타트', '투표', 'vote', '종료', 'stopgame', '스톱'].includes(c);
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
    '🏇 **실시간 경마 대회 (배팅 게임)**\n' +
    '• `/경마` (또는 `/race`) : 경마 대회 대기실 오픈\n' +
    '• `/지갑` (또는 `/wallet`) : 내 포인트 잔액 확인 (기본 10,000P)\n' +
    '• `/랭킹` (또는 `/rank`) : 사내 부자 순위 TOP 10\n' +
    '• `/구걸` (또는 `/beg`) : 탕비실 분리수거 알바 (+2,000P 충전)\n\n' +
    '🤥 **라이어 게임 (커피 내기)**\n' +
    '• `/게임` (또는 `/game`) : 라이어 게임 대기실 생성\n' +
    '• `/끌올` (또는 `/up`) : 대기실 카드를 맨 아래로 재소환\n' +
    '• `/시작` (또는 `/startgame`) : 게임 시작\n' +
    '• `/투표` (또는 `/vote`) : 실시간 다수결 투표판 오픈\n' +
    '• `/종료` (또는 `/stopgame`) : 게임 강제 중단\n\n' +
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
  return ctx.reply(`💰 **${w.name}** 님의 지갑\n잔액: **${w.points.toLocaleString()} P**`, {
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
    return ctx.reply(`🙄 아직 ${w.points.toLocaleString()} P나 있으면서 구걸을 하시게요? 5,000 P 미만일 때만 가능합니다!`);
  }

  if (now - w.lastBeg < 180000) {
    const remainSec = Math.ceil((180000 - (now - w.lastBeg)) / 1000);
    return ctx.reply(`⏳ 탕비실 청소 알바 쿨타임 중입니다! (${remainSec}초 후 가능)`);
  }

  w.points += 2000;
  w.lastBeg = now;
  w.begCount = (w.begCount || 0) + 1;
  checkAndUnlockTitles(w);
  saveWallets();
  return ctx.reply(`🧹 탕비실 분리수거 알바 완료! **+2,000 P** 충전되었습니다.\n현재 잔액: **${w.points.toLocaleString()} P**`, {
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
    return `${medal}: **${w.name}** — ${w.points.toLocaleString()} P`;
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
  const popupText = `💰 [내 지갑 정보]\n👤 ${w.name} 님\n잔액: ${w.points.toLocaleString()} P`;
  return ctx.answerCbQuery(popupText, { show_alert: true });
});

bot.action('cmd_beg', async (ctx) => {
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);
  const now = Date.now();

  if (w.points >= 5000) {
    return ctx.answerCbQuery(`🙄 알바 불가!\n잔액이 5,000 P 이상이면 알바를 할 수 없습니다.\n(현재 잔액: ${w.points.toLocaleString()} P)`, { show_alert: true });
  }

  if (now - w.lastBeg < 180000) {
    const remainSec = Math.ceil((180000 - (now - w.lastBeg)) / 1000);
    return ctx.answerCbQuery(`⏳ 탕비실 청소 알바 쿨타임 중!\n${remainSec}초 후에 다시 가능합니다.`, { show_alert: true });
  }

  w.points += 2000;
  w.lastBeg = now;
  w.begCount = (w.begCount || 0) + 1;
  checkAndUnlockTitles(w);
  saveWallets();
  return ctx.answerCbQuery(`🧹 탕비실 분리수거 알바 완료! (+2,000 P)\n현재 잔액: ${w.points.toLocaleString()} P`, { show_alert: true });
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
    return `${medal}: **${w.name}** — ${w.points.toLocaleString()} P`;
  }).join('\n');

  return ctx.reply(`🏆 **[사내 부자 랭킹 TOP 10]** 🏆\n\n${lines}`, {
    parse_mode: 'Markdown',
    ...getGameActionButtons()
  });
});

bot.action('cmd_game', async (ctx) => {
  await ctx.answerCbQuery('🤥 라이어 게임 대기실을 엽니다!');
  return handleLobby(ctx);
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

  const unlocked = TITLE_DEFINITIONS.filter(t => (w.unlockedTitles || []).includes(t.id));

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

  const activeStr = w.activeTitle ? `현재 장착: **${w.activeTitle}**` : '현재 장착: (없음)';
  const unlockedIds = new Set(w.unlockedTitles || []);

  const listStr = TITLE_DEFINITIONS.map(t => {
    const isUnlocked = unlockedIds.has(t.id);
    const statusIcon = isUnlocked ? '🔓' : '🔒';
    const tag = isUnlocked ? (w.activeTitle === t.cleanName ? ' [장착중]' : ' [선택가능]') : ' [미달성]';
    return `${statusIcon} **${t.name}**${tag}\n   • 조건: ${t.desc}`;
  }).join('\n');

  return `🎖️ **[${w.name} 님의 맞춤 칭호 도감]**\n\n` +
    `${activeStr}\n` +
    `💡 해금 완료: **${unlockedIds.size}** / ${TITLE_DEFINITIONS.length} 개\n\n` +
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
  await ctx.answerCbQuery();
  return handleTitle(ctx);
});

bot.action(/^set_title_(.+)$/, async (ctx) => {
  const titleId = ctx.match[1];
  const user = ctx.from;
  const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');
  const w = getWallet(user.id, name);
  const targetTitle = TITLE_DEFINITIONS.find(t => t.id === titleId);

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
// 🤥 라이어 게임 한글 명령어
// ==========================================
async function handleLobby(ctx) {
  if (ctx.chat.type === 'private') {
    return ctx.reply('⚠️ 라이어 게임은 단톡방(그룹)에서 진행해야 재밌습니다. 그룹에 초대해주세요!');
  }

  const chatId = ctx.chat.id;
  if (games[chatId] && (games[chatId].state === 'playing' || games[chatId].state === 'voting')) {
    return ctx.reply('⚠️ 이미 진행 중인 라이어 게임이 있습니다. 종료하려면 `/종료` 를 입력하세요.');
  }

  if (games[chatId] && games[chatId].lastLobbyMessageId) {
    try {
      await ctx.deleteMessage(games[chatId].lastLobbyMessageId);
    } catch (e) {}
  }

  const threadId = getThreadId(ctx) || GAME_THREAD_ID;
  games[chatId] = {
    threadId,
    state: 'lobby',
    players: new Map(),
    userRoles: new Map(),
    liarId: null,
    category: null,
    word: null,
    lastLobbyMessageId: null,
    votes: new Map()
  };

  const sentMsg = await ctx.reply(getLobbyText(games[chatId]), {
    parse_mode: 'Markdown',
    ...getLobbyKeyboard()
  });

  games[chatId].lastLobbyMessageId = sentMsg.message_id;
}

async function handlePullUp(ctx) {
  const chatId = ctx.chat.id;
  const game = games[chatId];

  if (!game || game.state !== 'lobby') {
    return ctx.reply('⚠️ 현재 대기 중인 게임이 없습니다. `/게임` 으로 대기실을 만드세요.');
  }

  if (game.lastLobbyMessageId) {
    try {
      await ctx.deleteMessage(game.lastLobbyMessageId);
    } catch (e) {}
  }

  const sentMsg = await ctx.reply(getLobbyText(game), {
    parse_mode: 'Markdown',
    ...getLobbyKeyboard()
  });

  game.lastLobbyMessageId = sentMsg.message_id;
}

bot.action('join_game', async (ctx) => {
  const chatId = ctx.chat.id;
  const game = games[chatId];
  if (!game || game.state !== 'lobby') return ctx.answerCbQuery('대기 중인 게임이 없습니다.');

  const user = ctx.from;
  const rawName = user.first_name + (user.last_name ? ' ' + user.last_name : '');

  if (game.players.has(user.id)) return ctx.answerCbQuery('이미 참가하셨습니다! ✅');

  const title = getRandomTitle();
  game.players.set(user.id, { name: rawName, title });
  await ctx.answerCbQuery(`[${title}] ${rawName}님 참가 완료!`);

  try {
    await ctx.editMessageText(getLobbyText(game), { parse_mode: 'Markdown', ...getLobbyKeyboard() });
  } catch (e) {}
});

bot.action('leave_game', async (ctx) => {
  const chatId = ctx.chat.id;
  const game = games[chatId];
  if (!game || game.state !== 'lobby') return ctx.answerCbQuery('대기 중인 게임이 없습니다.');

  const user = ctx.from;
  if (!game.players.has(user.id)) return ctx.answerCbQuery('참가 상태가 아닙니다.');

  game.players.delete(user.id);
  await ctx.answerCbQuery('대기실에서 나왔습니다.');

  try {
    await ctx.editMessageText(getLobbyText(game), { parse_mode: 'Markdown', ...getLobbyKeyboard() });
  } catch (e) {}
});

bot.action('check_my_role', async (ctx) => {
  const chatId = ctx.chat.id;
  const game = games[chatId];
  if (!game || (game.state !== 'playing' && game.state !== 'voting')) {
    return ctx.answerCbQuery('현재 진행 중인 게임이 없습니다.', { show_alert: true });
  }

  const userId = ctx.from.id;
  if (!game.players.has(userId)) {
    return ctx.answerCbQuery('⚠️ 이번 게임 참가자가 아닙니다!', { show_alert: true });
  }

  const roleText = game.userRoles.get(userId) || '정보가 없습니다.';
  return ctx.answerCbQuery(roleText, { show_alert: true });
});

async function startGameLogic(chatId, ctx) {
  const game = games[chatId];
  if (!game || game.state !== 'lobby') return ctx.reply('대기 중인 게임이 없습니다.');

  const playerIds = Array.from(game.players.keys());
  if (playerIds.length < 3) return ctx.reply(`⚠️ 최소 3명 이상 참가해야 합니다! (현재 ${playerIds.length}명)`);

  game.state = 'playing';
  game.votes = new Map();

  const pack = WORD_PACKS[Math.floor(Math.random() * WORD_PACKS.length)];
  const word = pack.words[Math.floor(Math.random() * pack.words.length)];
  game.category = pack.category;
  game.word = word;

  const liarIndex = Math.floor(Math.random() * playerIds.length);
  game.liarId = playerIds[liarIndex];

  game.userRoles.clear();
  for (const pId of playerIds) {
    const pInfo = game.players.get(pId);
    if (pId === game.liarId) {
      game.userRoles.set(pId, `🤥 [당신은 라이어입니다!]\n칭호: [${pInfo.title}]\n\n📂 카테고리: [ ${pack.category} ]\n\n⚠️ 지면 커피 사야 합니다! 눈치껏 아는 척하세요!`);
    } else {
      game.userRoles.set(pId, `👤 [당신은 시민입니다!]\n칭호: [${pInfo.title}]\n\n📂 카테고리: [ ${pack.category} ]\n🎯 제시어: [ ${word} ]\n\n라이어를 못 잡거나 라이어가 맞히면 우리 중 1명이 커피 당첨!`);
    }
  }

  const order = [...playerIds].sort(() => Math.random() - 0.5);
  const orderText = order.map((id, idx) => {
    const p = game.players.get(id);
    return `${idx + 1}번: [${p.title}] **${p.name}**`;
  }).join('\n');

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔍 내 비밀 제시어 확인하기 (팝업)', 'check_my_role')],
    [Markup.button.callback('🗳️ 라이어 실시간 투표 시작', 'open_vote')]
  ]);

  const startMsg = `☕️ **커피 내기 라이어 게임 시작!**\n\n` +
    `📂 **카테고리**: **[ ${pack.category} ]**\n` +
    `👥 참가자: **${playerIds.length}명** (시민 ${playerIds.length - 1}명, 라이어 1명)\n\n` +
    `👇 **아래 버튼을 눌러 본인의 제시어/라이어 여부를 확인하세요!**\n\n` +
    `🗣️ **설명 순서**:\n${orderText}\n\n` +
    `한 바퀴 설명을 마친 후, [🗳️ 라이어 실시간 투표 시작] 버튼을 누르세요!`;

  const threadId = game.threadId || getThreadId(ctx) || GAME_THREAD_ID;
  const startExtra = { parse_mode: 'Markdown', ...keyboard };
  if (threadId) startExtra.message_thread_id = threadId;

  await bot.telegram.sendMessage(chatId, startMsg, startExtra);
}

bot.action('force_start', async (ctx) => {
  await ctx.answerCbQuery();
  return startGameLogic(ctx.chat.id, ctx);
});

async function handleStartGame(ctx) {
  return startGameLogic(ctx.chat.id, ctx);
}

function getVoteStatusText(game) {
  const total = game.players.size;
  const votedCount = game.votes.size;
  const voteCounts = {};
  for (const targetId of game.votes.values()) {
    voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
  }

  const statusLines = Array.from(game.players.entries()).map(([id, p]) => {
    const votesForMe = voteCounts[id] || 0;
    const voteBar = '█'.repeat(votesForMe);
    return `• [${p.title}] **${p.name}**: ${votesForMe}표 ${voteBar}`;
  }).join('\n');

  return `🗳️ **[라이어 검거 투표 진행 중!]**\n\n` +
    `의심되는 사람의 버튼을 눌러 투표하세요 (재투표 가능).\n` +
    `투표 현황: **${votedCount} / ${total}명 완료**\n\n` +
    `📊 **실시간 득표 현황**:\n${statusLines}\n\n` +
    `모두 투표했거나 마감하려면 아래 [🚨 투표 마감 & 개표] 버튼을 누르세요.`;
}

function getVoteKeyboard(game) {
  const buttons = Array.from(game.players.entries()).map(([id, p]) => {
    return [Markup.button.callback(`👉 [${p.title}] ${p.name}`, `cast_vote_${id}`)];
  });
  buttons.push([Markup.button.callback('🚨 투표 마감 & 개표하기', 'close_vote')]);
  return Markup.inlineKeyboard(buttons);
}

async function openVoteDialog(chatId, ctx) {
  const game = games[chatId];
  if (!game || (game.state !== 'playing' && game.state !== 'voting')) {
    return ctx.reply('현재 진행 중인 라이어 게임이 없습니다.');
  }

  game.state = 'voting';
  game.votes = new Map();

  await ctx.reply(getVoteStatusText(game), {
    parse_mode: 'Markdown',
    ...getVoteKeyboard(game)
  });
}

bot.action('open_vote', async (ctx) => {
  await ctx.answerCbQuery();
  return openVoteDialog(ctx.chat.id, ctx);
});

async function handleVoteCmd(ctx) {
  return openVoteDialog(ctx.chat.id, ctx);
}

bot.action(/^cast_vote_(\d+)$/, async (ctx) => {
  const targetId = parseInt(ctx.match[1], 10);
  const voterId = ctx.from.id;
  const chatId = ctx.chat.id;
  const game = games[chatId];

  if (!game || game.state !== 'voting') return ctx.answerCbQuery('투표 진행 중이 아닙니다.');
  if (!game.players.has(voterId)) return ctx.answerCbQuery('⚠️ 게임 참가자만 투표할 수 있습니다!', { show_alert: true });

  const target = game.players.get(targetId);
  game.votes.set(voterId, targetId);
  await ctx.answerCbQuery(`[${target.name}] 님에게 투표했습니다!`);

  try {
    await ctx.editMessageText(getVoteStatusText(game), { parse_mode: 'Markdown', ...getVoteKeyboard(game) });
  } catch (e) {}

  if (game.votes.size === game.players.size) {
    return finalizeVoting(chatId, ctx);
  }
});

async function finalizeVoting(chatId, ctx) {
  const game = games[chatId];
  if (!game || game.state !== 'voting') return;
  if (game.votes.size === 0) return ctx.reply('⚠️ 아직 아무도 투표하지 않았습니다!');

  const counts = {};
  for (const targetId of game.votes.values()) {
    counts[targetId] = (counts[targetId] || 0) + 1;
  }

  let maxVotes = -1;
  let topCandidates = [];
  for (const [idStr, cnt] of Object.entries(counts)) {
    const id = parseInt(idStr, 10);
    if (cnt > maxVotes) {
      maxVotes = cnt;
      topCandidates = [id];
    } else if (cnt === maxVotes) {
      topCandidates.push(id);
    }
  }

  if (topCandidates.length > 1) {
    const tiedNames = topCandidates.map(id => game.players.get(id).name).join(', ');
    return ctx.reply(`⚖️ **[동점 발생!]** (${tiedNames} - 각 ${maxVotes}표)\n재토론 후 다시 \`/투표\` 로 투표해주세요!`);
  }

  const convictedId = topCandidates[0];
  const convicted = game.players.get(convictedId);
  const isLiar = (convictedId === game.liarId);
  const liar = game.players.get(game.liarId);

  game.state = 'accused';

  if (isLiar) {
    const liarButtons = Markup.inlineKeyboard([
      [
        Markup.button.callback('🎯 라이어가 단어 맞힘! (역전승)', 'liar_win_by_guess'),
        Markup.button.callback('❌ 라이어가 틀림! (시민 승)', 'citizen_win')
      ]
    ]);

    await ctx.reply(
      `📢 **투표 결과 발표!**\n\n` +
      `최다 득표자 [ **${convicted.name}** ] 님이 **${maxVotes}표**를 받아 라이어로 최종 지목되었습니다!\n\n` +
      `🎉 **검거 성공! [${convicted.title}] ${convicted.name} 님은 🤥 라이어가 맞았습니다!**\n\n` +
      `🎯 진짜 제시어: [ **${game.word}** ]\n\n` +
      `💡 **라이어의 마지막 찬스!** 제시어를 채팅으로 말해보세요:`,
      { parse_mode: 'Markdown', ...liarButtons }
    );
  } else {
    finishGameWithLiarWin(chatId, ctx, liar, convicted, `투표로 억울한 시민 [${convicted.title}] ${convicted.name} 님이 몰림 (${maxVotes}표)`);
  }
}

bot.action('close_vote', async (ctx) => {
  await ctx.answerCbQuery();
  return finalizeVoting(ctx.chat.id, ctx);
});

bot.action('liar_win_by_guess', async (ctx) => {
  const chatId = ctx.chat.id;
  const game = games[chatId];
  if (!game || game.state !== 'accused') return ctx.answerCbQuery();
  const liar = game.players.get(game.liarId);
  await ctx.answerCbQuery('라이어 역전승!');
  finishGameWithLiarWin(chatId, ctx, liar, null, '라이어가 진짜 제시어를 완벽하게 맞힘');
});

bot.action('citizen_win', async (ctx) => {
  const chatId = ctx.chat.id;
  const game = games[chatId];
  if (!game || game.state !== 'accused') return ctx.answerCbQuery();
  const liar = game.players.get(game.liarId);
  await ctx.answerCbQuery('시민 팀 승리!');

  const resultMsg = `🏆 **시민 팀 최종 승리!**\n\n` +
    `🤥 라이어 [${liar.title}] **${liar.name}** 님이 검거되었고, 단어도 맞히지 못했습니다!\n` +
    `🎯 제시어는 [ **${game.word}** ] 이었습니다.\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `☕️☕️ **커피 당첨자** ☕️☕️\n` +
    `👉 오늘 커피는 패배한 라이어 [${liar.title}] **${liar.name}** 님이 쏩니다! 👏🎉\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `다음 판은 \`/게임\` 으로 시작하세요!`;

  await ctx.reply(resultMsg, { parse_mode: 'Markdown' });
  delete games[chatId];
});

async function finishGameWithLiarWin(chatId, ctx, liar, wrongAccused, reason) {
  const game = games[chatId];
  if (!game) return;

  const citizenList = Array.from(game.players.entries())
    .filter(([id]) => id !== game.liarId)
    .map(([, info]) => info);

  const unluckyCitizen = citizenList[Math.floor(Math.random() * citizenList.length)];

  let resultMsg = `🏆 **라이어의 완벽한 승리!** (${reason})\n\n` +
    `🤥 라이어는 바로 [${liar.title}] **${liar.name}** 님이었습니다!\n` +
    `🎯 제시어는 [ **${game.word}** ] 이었습니다.\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `☕️☕️ **커피 당첨자 (덤터기 룰)** ☕️☕️\n` +
    `라이어를 잡지 못한 죄!\n` +
    `시민들 중 룰렛에 당첨된 불운의 주인공은...\n\n` +
    `👉 💥 [${unluckyCitizen.title}] **${unluckyCitizen.name}** 님 당첨!! 💥\n\n` +
    `오늘 커피 맛있게 잘 마시겠습니다! ☕️👏\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `복수전은 \`/게임\` 으로 시작하세요!`;

  await ctx.reply(resultMsg, { parse_mode: 'Markdown' });
  delete games[chatId];
}

async function handleStopGame(ctx) {
  const chatId = ctx.chat.id;
  if (!games[chatId]) return ctx.reply('진행 중인 라이어 게임이 없습니다.');
  delete games[chatId];
  return ctx.reply('🛑 라이어 게임이 강제로 종료되었습니다.');
}

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
  { keys: ['게임', 'game', '라이어'], fn: handleLobby },
  { keys: ['끌올', 'up', 'pull'], fn: handlePullUp },
  { keys: ['시작', 'startgame', '스타트'], fn: handleStartGame },
  { keys: ['투표', 'vote'], fn: handleVoteCmd },
  { keys: ['종료', 'stopgame', '스톱'], fn: handleStopGame },
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
  if (!raw || !raw.trim().startsWith('/')) return next();

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
bot.command(['게임', 'game'], cmdWrap(handleLobby));
bot.command(['끌올', 'up', 'pull'], cmdWrap(handlePullUp));
bot.command(['시작', 'startgame'], cmdWrap(handleStartGame));
bot.command(['투표', 'vote'], cmdWrap(handleVoteCmd));
bot.command(['종료', 'stopgame'], cmdWrap(handleStopGame));

// ==========================================
// 📋 텔레그램 슬래시 메뉴 등록 (setMyCommands)
// ==========================================
const BOT_COMMANDS = [
  { command: 'help', description: '명령어 안내 (/헬프)' },
  { command: 'game', description: '라이어 게임 대기실 열기 (/게임)' },
  { command: 'startgame', description: '게임 시작 (/시작)' },
  { command: 'vote', description: '라이어 투표판 열기 (/투표)' },
  { command: 'up', description: '대기실 카드 끌어올리기 (/끌올)' },
  { command: 'stopgame', description: '게임 강제 종료 (/종료)' },
  { command: 'race', description: '경마 대회 열기 (/경마)' },
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
