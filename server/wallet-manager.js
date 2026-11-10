const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'wallets.json');
let wallets = {};

function loadWallets() {
  try {
    if (fs.existsSync(DB_FILE)) {
      wallets = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    wallets = {};
  }
}
loadWallets();

function saveWallets() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(wallets, null, 2), 'utf8');
  } catch (e) {
    console.error('saveWallets error:', e);
  }
}

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

  try {
    let bn = BigInt(str.split('.')[0] || '0');
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

function parseAmountText(rawAmount, currentPoints = 0) {
  let numStr = String(rawAmount || '').toLowerCase().replace(/,/g, '').trim();
  if (!numStr) return 0;
  if (numStr === '올인' || numStr === 'all' || numStr === 'allin') {
    return Math.max(0, Math.floor(currentPoints));
  }
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
  if (numStr.endsWith('만')) return Math.floor(parseFloat(numStr.replace('만', '')) * 1e4);
  if (numStr.endsWith('k')) return Math.floor(parseFloat(numStr.replace('k', '')) * 1e3);
  if (numStr.endsWith('m')) return Math.floor(parseFloat(numStr.replace('m', '')) * 1e6);

  const num = parseFloat(numStr);
  return isNaN(num) ? 0 : Math.floor(num);
}

const TITLE_DEFINITIONS = [
  { id: 't_dirt', name: '💸 흙수저 탈출', cleanName: '흙수저 탈출', desc: '잔액 150만 P 이상', check: (w) => (w.points || 0) >= 1500000 },
  { id: 't_mid', name: '💼 중산층', cleanName: '중산층', desc: '잔액 300만 P 이상', check: (w) => (w.points || 0) >= 3000000 },
  { id: 't_rich', name: '💰 백만장자', cleanName: '백만장자', desc: '잔액 1,000만 P 이상', check: (w) => (w.points || 0) >= 10000000 },
  { id: 't_dia', name: '💎 다이아 수저', cleanName: '다이아 수저', desc: '잔액 5,000만 P 이상', check: (w) => (w.points || 0) >= 50000000 },
  { id: 't_mansour', name: '👑 만수르', cleanName: '만수르', desc: '잔액 1억 P 이상', check: (w) => (w.points || 0) >= 100000000 },
  { id: 't_first_win', name: '🥉 경마 입문자', cleanName: '경마 입문자', desc: '경마 1위 3회 적중', check: (w) => (w.wins || 0) >= 3 },
  { id: 't_god', name: '🏇 승리의 베테랑', cleanName: '승리의 베테랑', desc: '경마 1위 20회 적중', check: (w) => (w.wins || 0) >= 20 },
  { id: 't_legend', name: '🦄 전설의 기수', cleanName: '전설의 기수', desc: '경마 1위 50회 적중', check: (w) => (w.wins || 0) >= 50 },
  { id: 't_underdog', name: '🎯 역배의 제왕', cleanName: '역배의 제왕', desc: '배당 10.0배 이상 적중', check: (w) => (w.maxOdds || 0) >= 10.0 },
  { id: 't_miracle', name: '⚡ 기적의 눈썰미', cleanName: '기적의 눈썰미', desc: '배당 30.0배 이상 적중', check: (w) => (w.maxOdds || 0) >= 30.0 },
  { id: 't_jackpot', name: '🎰 잭팟 마스터', cleanName: '잭팟 마스터', desc: '한 판에 100만 P 이상 수익', check: (w) => (w.maxProfit || 0) >= 1000000 },
  { id: 't_bigwin', name: '🌊 한강 뷰', cleanName: '한강 뷰', desc: '한 판에 1,000만 P 이상 수익', check: (w) => (w.maxProfit || 0) >= 10000000 },
  { id: 't_bankrupt', name: '☠️ 깡통 계좌', cleanName: '깡통 계좌', desc: '배팅 후 잔액 0 P 기록', check: (w) => !!w.bankruptHit },
  { id: 't_allin', name: '🎲 인생 한방러', cleanName: '인생 한방러', desc: '올인 배팅 승리 경험', check: (w) => !!w.allInWon },
  { id: 't_gambler', name: '🚨 도박 중독', cleanName: '도박 중독', desc: '경마 누적 50회 참여', check: (w) => (w.raceCount || 0) >= 50 },
  { id: 't_vip', name: '💎 마사회 VIP', cleanName: '마사회 VIP', desc: '경마 누적 150회 참여', check: (w) => (w.raceCount || 0) >= 150 },
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

function getWallet(userId, name) {
  if (!wallets[userId]) {
    wallets[userId] = {
      name: name || '플레이어',
      points: 1000000, // 시즌 2 기본 100만 포인트
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
  // 파산 자동 지원 (잔액 0원 시 100,000P 자동 지원)
  if (w.points <= 0) {
    w.points = 100000;
    saveWallets();
  }
  checkAndUnlockTitles(w);
  return w;
}

function getTopRankings(limit = 10) {
  return Object.entries(wallets)
    .map(([id, w]) => ({
      id,
      name: w.name || '익명',
      points: w.points || 0,
      formattedPoints: formatKoreanNumber(w.points || 0),
      activeTitle: w.activeTitle || '',
      wins: w.wins || 0,
      raceCount: w.raceCount || 0
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

module.exports = {
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
};
