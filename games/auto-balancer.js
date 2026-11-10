const fs = require('fs');
const path = require('path');
const { getDailyStats, getKSTDateString } = require('./daily-tracker');

const MODIFIERS_FILE = path.join(__dirname, '..', 'animal_modifiers.json');
let modifiers = {};

try {
  if (fs.existsSync(MODIFIERS_FILE)) {
    modifiers = JSON.parse(fs.readFileSync(MODIFIERS_FILE, 'utf8'));
  }
} catch (e) {
  modifiers = {};
}

function saveModifiers() {
  try {
    fs.writeFileSync(MODIFIERS_FILE, JSON.stringify(modifiers, null, 2), 'utf8');
  } catch (e) {}
}

function getAnimalModifier(animalName) {
  return modifiers[animalName] || { stepBonusProb: 0, nerfedProb: 0 };
}

// 각 동물의 기본 설계 목표 승률
const TARGET_WIN_RATES = {
  '치타': { min: 0.40, max: 0.50 },
  '호랑이': { min: 0.35, max: 0.45 },
  '경주마': { min: 0.33, max: 0.43 },
  '토끼': { min: 0.30, max: 0.40 },
  '늑대': { min: 0.30, max: 0.40 },
  '원숭이': { min: 0.25, max: 0.35 },
  '치와와': { min: 0.25, max: 0.35 },
  '돼지': { min: 0.20, max: 0.30 },
  '가재': { min: 0.20, max: 0.30 },
  '거북이': { min: 0.12, max: 0.20 },
  '달팽이': { min: 0.08, max: 0.14 },
  '새': { min: 0.10, max: 0.18 }
};

// 매일 오전 7시 밸런스 패치 실행 함수
async function performDailyBalancePatch(bot, chatId, threadId) {
  // 어제 날짜 계산 (KST 기준)
  const now = new Date();
  const yesterdayDate = new Date(now.getTime() - 24 * 3600 * 1000);
  const yesterdayKey = getKSTDateString(yesterdayDate);
  const data = getDailyStats(yesterdayKey);

  const buffList = [];
  const nerfList = [];
  const statSummary = [];

  if (!data || !data.stats || Object.keys(data.stats).length === 0 || data.totalRaces < 3) {
    // 표본 부족 시
    const noticeText = `📢 **[대환장 동물 달리기 정기 점검 안내]**\n\n` +
      `어제(${yesterdayKey})는 경주 표본(총 ${data ? data.totalRaces : 0}회)이 적어 선수단 능력치가 유지됩니다.\n` +
      `오늘도 즐거운 레이스 되세요! 🎪`;

    if (bot && chatId) {
      try {
        const extra = { parse_mode: 'Markdown' };
        if (threadId) extra.message_thread_id = threadId;
        await bot.telegram.sendMessage(chatId, noticeText, extra);
      } catch (e) {}
    }
    return;
  }

  // 동물별 승률 분석 및 미세 보정
  for (const [name, target] of Object.entries(TARGET_WIN_RATES)) {
    const s = data.stats[name];
    if (!s || s.races < 3) continue; // 최소 3경기 이상 출전한 동물만

    const winRate = s.wins / s.races;
    const winRatePct = (winRate * 100).toFixed(1);
    statSummary.push(`• **${name}**: ${s.wins}승 / ${s.races}전 (승률 ${winRatePct}%)`);

    if (!modifiers[name]) {
      modifiers[name] = { stepBonusProb: 0, nerfedProb: 0 };
    }

    if (winRate > target.max) {
      // 너프 필요 (최대 10%까지 페이스 조절)
      modifiers[name].nerfedProb = Math.min(0.12, (modifiers[name].nerfedProb || 0) + 0.03);
      modifiers[name].stepBonusProb = Math.max(0, (modifiers[name].stepBonusProb || 0) - 0.02);
      nerfList.push(`• **${name}** (승률 ${winRatePct}% 폭주 🔻): 후반 페이스 조절 확률 +3% 증가`);
    } else if (winRate < target.min) {
      // 버프 필요 (최대 10%까지 추가 전진)
      modifiers[name].stepBonusProb = Math.min(0.12, (modifiers[name].stepBonusProb || 0) + 0.03);
      modifiers[name].nerfedProb = Math.max(0, (modifiers[name].nerfedProb || 0) - 0.02);
      buffList.push(`• **${name}** (승률 ${winRatePct}% 저조 🔺): 중반 스퍼트 확률 +3% 상향`);
    }
  }

  saveModifiers();

  let patchBody = '';
  if (buffList.length > 0) {
    patchBody += `🔺 **[선수단 컨디션 상향 (버프)]**\n${buffList.join('\n')}\n\n`;
  }
  if (nerfList.length > 0) {
    patchBody += `🔻 **[선수단 컨디션 조절 (너프)]**\n${nerfList.join('\n')}\n\n`;
  }
  if (buffList.length === 0 && nerfList.length === 0) {
    patchBody += `✨ **모든 선수가 설계 목표 승률 범위 내에서 완벽한 황금 밸런스를 유지 중입니다!**\n\n`;
  }

  const noticeText = `📢 **[대환장 동물 달리기 일일 자동 밸런스 패치 완료]** 🏁\n\n` +
    `어제(${yesterdayKey}) 진행된 **총 ${data.totalRaces}회**의 레이스 빅데이터를 바탕으로 선수단 밸런스가 자동 조정되었습니다.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${patchBody}` +
    `📊 **어제 선수단 주요 전적**:\n` +
    `${statSummary.slice(0, 6).join('\n')}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `오늘도 새로운 승률과 함께 치열한 레이스를 즐겨보세요! 🎪`;

  if (bot && chatId) {
    try {
      const extra = { parse_mode: 'Markdown' };
      if (threadId) extra.message_thread_id = threadId;
      await bot.telegram.sendMessage(chatId, noticeText, extra);
    } catch (e) {}
  }
}

// 7시 타이머 스케줄러 등록
function scheduleDaily7AMPatch(bot, chatId, threadId) {
  function getNext7AMDelay() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600 * 1000);
    const targetKst = new Date(kst);
    targetKst.setUTCHours(7, 0, 0, 0); // KST 07:00
    if (targetKst <= kst) {
      targetKst.setUTCDate(targetKst.getUTCDate() + 1);
    }
    return targetKst.getTime() - kst.getTime();
  }

  const delay = getNext7AMDelay();
  console.log(`[AutoBalancer] 다음 밸런스 패치 예정 시간까지: ${(delay / 3600000).toFixed(2)} 시간 후 (KST 07:00)`);

  setTimeout(async () => {
    try {
      await performDailyBalancePatch(bot, chatId, threadId);
    } catch (e) {
      console.error('[AutoBalancer Error]', e);
    }
    // 24시간 주기로 반복
    setInterval(async () => {
      try {
        await performDailyBalancePatch(bot, chatId, threadId);
      } catch (e) {
        console.error('[AutoBalancer Error]', e);
      }
    }, 24 * 3600 * 1000);
  }, delay);
}

module.exports = {
  getAnimalModifier,
  performDailyBalancePatch,
  scheduleDaily7AMPatch
};
