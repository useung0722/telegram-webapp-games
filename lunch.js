#!/usr/bin/env node
/**
 * 점심 메뉴 전송 (systemd 타이머용).
 *
 * 봇 프로세스와 별개로 Telegram Bot API를 직접 호출한다.
 * (같은 봇 토큰으로 getUpdates를 동시에 폴링하면 409 Conflict가 나므로
 *  sendMessage/sendPoll만 호출한다.)
 *
 * 사용: node lunch.js [--all]
 * 환경: LUNCH_CHAT_ID (기본 -1002499084612), LUNCH_DRY_RUN=1 이면 전송 안 함
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BOT_TOKEN = process.env.SPYFALL_BOT_TOKEN;

const AI_HOME = process.env.AI_HOME || '/home/woojoo';
const PY_BIN = process.env.PY_BIN || '/usr/bin/python3';
const CHAT_ID = process.env.LUNCH_CHAT_ID || '-1002499084612';
const THREAD_ID = process.env.LUNCH_THREAD_ID ? parseInt(process.env.LUNCH_THREAD_ID, 10) : undefined;
const DRY_RUN = process.env.LUNCH_DRY_RUN === '1';
const STATE_FILE = path.join(__dirname, 'lunch_state.json');
const SHOW_ALL = process.argv.includes('--all');

function kstDateKey(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d || new Date());
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
}

function fetchLunch() {
  return new Promise((resolve, reject) => {
    const payloadFile = path.join(require('os').tmpdir(), `spyfall-lunch-${process.pid}.json`);
    const pyFile = path.join(require('os').tmpdir(), `spyfall-lunch-${process.pid}.py`);
    const code = [
      'import sys, json',
      `sys.path.insert(0, ${JSON.stringify(__dirname)})`,
      'import meal_parser',
      'day = meal_parser.today_menu(meal_parser.parse(meal_parser.fetch_html()))',
      `text = meal_parser.format_message(day, show_all=${SHOW_ALL ? 'True' : 'False'})`,
      `open(${JSON.stringify(payloadFile)}, "w", encoding="utf-8").write(json.dumps({"day": day, "text": text}, ensure_ascii=False))`
    ].join('\n');
    fs.writeFileSync(pyFile, code, 'utf8');
    execFile(PY_BIN, [pyFile], { timeout: 45000, maxBuffer: 1024 * 1024 }, (err) => {
      try {
        if (err) throw err;
        resolve(JSON.parse(fs.readFileSync(payloadFile, 'utf8')));
      } catch (e) {
        reject(e);
      } finally {
        for (const f of [pyFile, payloadFile]) { try { fs.unlinkSync(f); } catch (e) {} }
      }
    });
  });
}

function cornerOptions(day) {
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

async function api(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method} 실패: ${data.description || res.status}`);
  return data.result;
}

async function main() {
  if (!BOT_TOKEN) throw new Error('SPYFALL_BOT_TOKEN 환경변수가 없습니다');

  const { day, text } = await fetchLunch();
  if (DRY_RUN) {
    console.log('[DRY RUN] 메뉴:\n' + text);
    console.log('[DRY RUN] 투표 선택지:', cornerOptions(day));
    return 0;
  }

  const sendMsgPayload = {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (THREAD_ID) sendMsgPayload.message_thread_id = THREAD_ID;

  try {
    await api('sendMessage', sendMsgPayload);
  } catch (e) {
    const fallbackPayload = { chat_id: CHAT_ID, text: String(text).replace(/<[^>]+>/g, '') };
    if (THREAD_ID) fallbackPayload.message_thread_id = THREAD_ID;
    await api('sendMessage', fallbackPayload);
  }

  const state = loadState();
  const key = String(CHAT_ID);
  const today = kstDateKey();
  const opts = cornerOptions(day);

  if (state[key] && state[key].date === today && state[key].messageId) {
    console.log(`메뉴 전송 완료 / 오늘 투표 이미 존재 (#${state[key].messageId}) — 재생성 안 함`);
    return 0;
  }
  if (!opts.length) {
    console.log('메뉴 전송 완료 / 코너 메뉴 없음 → 투표 생략');
    return 0;
  }

  const pollPayload = {
    chat_id: CHAT_ID,
    question: '오늘 점심 뭐 드실래요? 🍽',
    options: opts,
    is_anonymous: false,
    allows_multiple_answers: false
  };
  if (THREAD_ID) pollPayload.message_thread_id = THREAD_ID;

  const poll = await api('sendPoll', pollPayload);
  state[key] = { date: today, messageId: poll.message_id, options: opts };
  saveState(state);
  console.log(`메뉴 전송 완료 / 신규 투표 생성 (#${poll.message_id}, 선택지 ${opts.length}개)`);
  return 0;
}

main().then(code => process.exit(code)).catch(e => {
  console.error('실패:', e.message);
  process.exit(1);
});
