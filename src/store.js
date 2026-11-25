// Penyimpanan sederhana berbasis file JSON (data/db.json).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { series: [], episodes: [] };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { console.error('db.json rusak, mulai kosong:', e.message); }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}
function saveNow() {
  clearTimeout(saveTimer);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const id = () => crypto.randomUUID().slice(0, 8);

function newScene(n) {
  return {
    n,
    title: `Scene ${n}`,
    startFrame: null,      // strip baris storyboard (path relatif ke data/)
    singleFrame: null,     // foto shot 1 saja
    setting: '',
    characters: [],        // key tokoh yang muncul
    shots: Array.from({ length: 5 }, (_, i) => ({ action: '', dialogue: '' })),
    audio: '',
    customPrompt: '',      // kalau diisi, dipakai menggantikan prompt template
    status: 'draft',       // draft | queued | running | done | failed | manual
    fixLevel: 0,
    needsVO: [],           // dialog yang dibuang dan perlu VO
    attempts: [],          // {at, level, prompt, frame, result, error}
    clip: null,            // video hasil yang diunggah manual
  };
}

module.exports = {
  DATA_DIR,
  get db() { return db; },
  save, saveNow, id, newScene,
  series(id_) { return db.series.find(s => s.id === id_); },
  episode(id_) { return db.episodes.find(e => e.id === id_); },
  scene(epId, n) { const e = db.episodes.find(x => x.id === epId); return e && e.scenes.find(s => s.n === Number(n)); },
};
