const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'user_sessions.json');
const SESSION_EXPIRE_MS = 2 * 60 * 60 * 1000; // 2시간 활동 없으면 신규 세션으로 리셋

let sessions = {};
try {
  if (fs.existsSync(SESSION_FILE)) {
    sessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  }
} catch (e) {
  sessions = {};
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {}
}

function getUserSessionCount(userId) {
  const now = Date.now();
  const s = sessions[userId] || { count: 0, lastPlayed: 0 };
  if (now - s.lastPlayed > SESSION_EXPIRE_MS) {
    return 0; // 세션 만료 시 0
  }
  return s.count || 0;
}

function incrementUserSession(userId) {
  const now = Date.now();
  const s = sessions[userId] || { count: 0, lastPlayed: 0 };
  if (now - s.lastPlayed > SESSION_EXPIRE_MS) {
    s.count = 0;
  }
  s.count += 1;
  s.lastPlayed = now;
  sessions[userId] = s;
  saveSessions();
  return s.count;
}

module.exports = {
  getUserSessionCount,
  incrementUserSession
};
