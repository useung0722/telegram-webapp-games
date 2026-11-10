const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PY_BIN = process.env.PY_BIN || 'python';
const LUNCH_STATE_FILE = path.join(__dirname, '..', 'lunch_state.json');

let lunchVotes = {}; // date -> { cornerName -> [userId] }
try {
  if (fs.existsSync(LUNCH_STATE_FILE)) {
    lunchVotes = JSON.parse(fs.readFileSync(LUNCH_STATE_FILE, 'utf8'));
  }
} catch (e) {
  lunchVotes = {};
}

function saveLunchVotes() {
  try {
    fs.writeFileSync(LUNCH_STATE_FILE, JSON.stringify(lunchVotes, null, 2), 'utf8');
  } catch (e) {}
}

function getTodayMenu() {
  return new Promise((resolve) => {
    const code = [
      'import sys, json',
      `sys.path.insert(0, ${JSON.stringify(path.join(__dirname, '..'))})`,
      'import meal_parser',
      'try:',
      '    day = meal_parser.today_menu(meal_parser.parse(meal_parser.fetch_html()))',
      '    text = meal_parser.format_message(day, show_all=True)',
      '    print(json.dumps({"ok": True, "day": day, "text": text}, ensure_ascii=False))',
      'except Exception as e:',
      '    print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))'
    ].join('\n');

    const os = require('os');
    const pyFile = path.join(os.tmpdir(), `lunch-${Date.now()}.py`);
    fs.writeFileSync(pyFile, code, 'utf8');

    execFile(PY_BIN, [pyFile], { timeout: 15000 }, (err, stdout) => {
      try { fs.unlinkSync(pyFile); } catch (e) {}
      if (err) {
        return resolve({ ok: false, error: err.message });
      }
      try {
        const res = JSON.parse(stdout);
        resolve(res);
      } catch (e) {
        resolve({ ok: false, error: 'JSON parse error' });
      }
    });
  });
}

function voteLunch(date, corner, userId) {
  if (!lunchVotes[date]) lunchVotes[date] = {};
  
  // 기존 투표 제거
  for (const c of Object.keys(lunchVotes[date])) {
    lunchVotes[date][c] = (lunchVotes[date][c] || []).filter(u => u !== userId);
  }

  if (!lunchVotes[date][corner]) lunchVotes[date][corner] = [];
  lunchVotes[date][corner].push(userId);
  saveLunchVotes();

  return lunchVotes[date];
}

function getVotes(date) {
  return lunchVotes[date] || {};
}

module.exports = {
  getTodayMenu,
  voteLunch,
  getVotes
};

