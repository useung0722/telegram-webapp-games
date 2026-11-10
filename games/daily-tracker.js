const fs = require('fs');
const path = require('path');

const DAILY_FILE = path.join(__dirname, '..', 'daily_horse_stats.json');
let dailyStats = {};

try {
  if (fs.existsSync(DAILY_FILE)) {
    dailyStats = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'));
  }
} catch (e) {
  dailyStats = {};
}

function saveDailyStats() {
  try {
    fs.writeFileSync(DAILY_FILE, JSON.stringify(dailyStats, null, 2), 'utf8');
  } catch (e) {}
}

function getKSTDateString(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10); // YYYY-MM-DD
}

function recordDailyRace(winnerName, participantNames) {
  const todayKey = getKSTDateString();
  if (!dailyStats[todayKey]) {
    dailyStats[todayKey] = {
      totalRaces: 0,
      stats: {}
    };
  }

  dailyStats[todayKey].totalRaces += 1;
  const dayStats = dailyStats[todayKey].stats;

  for (const name of participantNames) {
    if (!dayStats[name]) {
      dayStats[name] = { races: 0, wins: 0 };
    }
    dayStats[name].races += 1;
    if (name === winnerName) {
      dayStats[name].wins += 1;
    }
  }

  saveDailyStats();
}

function getDailyStats(dateKey) {
  return dailyStats[dateKey] || null;
}

module.exports = {
  recordDailyRace,
  getDailyStats,
  getKSTDateString
};
