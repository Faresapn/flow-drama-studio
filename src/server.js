const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const store = require('./store');
const { cropStoryboard } = require('./crop');
const prompt = require('./prompt');
const runner = require('./runner');
const pipeline = require('./pipeline');
const autoprompt = require('./autoprompt');
const vo = require('./vo');

const app = express();
const PORT = process.env.PORT || 4777;
// Default hanya bisa dibuka dari Mac ini. HOST=0.0.0.0 untuk membuka ke jaringan (tidak disarankan).
const HOST = process.env.HOST || '127.0.0.1';
const upload = multer({ dest: path.join(store.DATA_DIR, 'tmp') });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/files', express.static(store.DATA_DIR));

const epDir = ep => path.join(store.DATA_DIR, 'episodes', ep.id);
const rel = abs => path.relative(store.DATA_DIR, abs).split(path.sep).join('/');
const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(e => res.status(400).json({ error: e.message }));

// ---------- Series ----------
// Pengaturan tambahan serial: gaya Claude, suara VO, subtitle tempel, judul & thumbnail otomatis.
function applySeriesSettings(s, b) {
  if (b.style && typeof b.style === 'object') {
    s.style = {
      dialog: Object.keys(autoprompt.STYLES).includes(b.style.dialog) ? b.style.dialog : '',
      model: autoprompt.MODELS.includes(b.style.model) ? b.style.model : '',
      notes: String(b.style.notes || '').slice(0, 600),
    };
  }
  if (b.voices && typeof b.voices === 'object') s.voices = Object.fromEntries(Object.entries(b.voices).filter(([k, v]) => k && v).map(([k, v]) => [String(k).trim(), String(v).trim()]));
  if (b.defaultVoice !== undefined) s.defaultVoice = String(b.defaultVoice || '').trim();
  if (b.burnSubs !== undefined) s.burnSubs = !!b.burnSubs;
  if (b.autoMeta !== undefined) s.autoMeta = !!b.autoMeta;
}
app.get('/api/options', (req, res) => res.json({ styles: Object.keys(autoprompt.STYLES), models: autoprompt.MODELS, voEnabled: vo.enabled() }));

app.get('/api/state', (req, res) => res.json({ ...store.db, queue: pipeline.queue, runner: { running: runner.state.running, current: runner.state.current } }));

// 1 drama = 1 akun Google: akun yang dipilih harus ada.
function checkAccount(id) {
  if (!runner.accountById(id)) throw new Error('Akun Google tidak ditemukan');
  return id;
}

app.post('/api/series', wrap((req, res) => {
  const accountId = req.body.accountId ? checkAccount(req.body.accountId) : runner.activeAccount().id;
  const s = { id: store.id(), title: req.body.title || 'Serial baru', characters: req.body.characters || [], accountId, createdAt: Date.now() };
  applySeriesSettings(s, req.body);
  store.db.series.push(s); store.save(); res.json(s);
  // Project Flow dibuat per episode saat episode mulai diproses.
}));
// Sheet tokoh serial: dipakai sebagai gambar referensi ke-2 di setiap generate (konsistensi wajah & baju).
app.post('/api/series/:id/character-sheet', upload.single('file'), wrap((req, res) => {
  const s = store.series(req.params.id); if (!s) throw new Error('Serial tidak ada');
  if (!req.file) throw new Error('File sheet tokoh tidak ada');
  const dir = path.join(store.DATA_DIR, 'series', s.id); fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, `${s.id}_sheet_${Date.now()}${path.extname(req.file.originalname || '') || '.png'}`);
  fs.renameSync(req.file.path, dst);
  s.characterSheet = rel(dst); store.save(); res.json(s);
}));
app.put('/api/series/:id', wrap((req, res) => {
  const s = store.series(req.params.id); if (!s) throw new Error('Serial tidak ada');
  Object.assign(s, { title: req.body.title ?? s.title, characters: req.body.characters ?? s.characters });
  if (req.body.accountId && req.body.accountId !== s.accountId) s.accountId = checkAccount(req.body.accountId);
  applySeriesSettings(s, req.body);
  store.save(); res.json(s);
}));
app.delete('/api/series/:id', wrap((req, res) => {
  store.db.series = store.db.series.filter(s => s.id !== req.params.id);
  store.db.episodes = store.db.episodes.filter(e => e.seriesId !== req.params.id);
  store.save(); res.json({ ok: true });
}));

// ---------- Episode ----------
app.post('/api/episodes', wrap((req, res) => {
  const { seriesId, title, sceneCount = 6 } = req.body;
  if (!store.series(seriesId)) throw new Error('Pilih serial dulu');
  const ep = { id: store.id(), seriesId, title: title || 'Episode baru', storyboard: null, scenes: Array.from({ length: sceneCount }, (_, i) => store.newScene(i + 1)), output: null, createdAt: Date.now() };
  store.db.episodes.push(ep); store.save(); res.json(ep);
}));
app.put('/api/episodes/:id', wrap((req, res) => {
  const ep = store.episode(req.params.id); if (!ep) throw new Error('Episode tidak ada');
  if (req.body.title) ep.title = req.body.title;
  store.save(); res.json(ep);
}));
app.delete('/api/episodes/:id', wrap((req, res) => {
  store.db.episodes = store.db.episodes.filter(e => e.id !== req.params.id); store.save(); res.json({ ok: true });
}));

// Upload storyboard -> crop otomatis jadi start frame per scene.
app.post('/api/episodes/:id/storyboard', upload.single('file'), wrap(async (req, res) => {
  const ep = store.episode(req.params.id); if (!ep) throw new Error('Episode tidak ada');
  const dir = path.join(epDir(ep), 'frames'); fs.mkdirSync(dir, { recursive: true });
  const sb = path.join(epDir(ep), 'storyboard' + path.extname(req.file.originalname || '.png'));
  fs.renameSync(req.file.path, sb);
  ep.storyboard = rel(sb);
  const crops = await cropStoryboard(sb, dir, ep.scenes.length);
  crops.forEach(c => {
    const sc = ep.scenes.find(s => s.n === c.n);
    if (sc) { sc.startFrame = rel(c.rowFile); sc.singleFrame = rel(c.photoFile); }
  });
  store.save();
  // Storyboard baru = jalankan alur otomatis penuh (kecuali ?auto=0).
  if (req.query.auto !== '0' && !pipeline.isActive(ep.id)) pipeline.start(ep.id);
  res.json(ep);
}));

// Serial -> langsung unggah storyboard: buat episode baru lalu jalankan alur otomatis.
app.post('/api/series/:id/storyboard', upload.single('file'), wrap(async (req, res) => {
  const series = store.series(req.params.id); if (!series) throw new Error('Serial tidak ada');
  if (!req.file) throw new Error('File storyboard tidak ada');
  const n = store.db.episodes.filter(e => e.seriesId === series.id).length + 1;
  const ep = { id: store.id(), seriesId: series.id, title: `Episode ${n}`, storyboard: null, scenes: Array.from({ length: 6 }, (_, i) => store.newScene(i + 1)), output: null, createdAt: Date.now() };
  store.db.episodes.push(ep);
  const sb = path.join(epDir(ep), 'storyboard' + (path.extname(req.file.originalname || '') || '.png'));
  fs.mkdirSync(epDir(ep), { recursive: true });
  fs.renameSync(req.file.path, sb);
  ep.storyboard = rel(sb); store.save();
  pipeline.start(ep.id);
  res.json(ep);
}));

// Mulai / lanjutkan alur otomatis episode.
app.post('/api/episodes/:id/auto', wrap(async (req, res) => {
  const ep = store.episode(req.params.id); if (!ep) throw new Error('Episode tidak ada');
  if (req.body && req.body.reprompt) ep.scenes.forEach(s => { s.shots = s.shots.map(() => ({ action: '', dialogue: '' })); s.customPrompt = ''; });
  res.json(pipeline.start(ep.id, { resume: true, onlyScenes: Array.isArray(req.body && req.body.scenes) ? req.body.scenes.map(Number) : null }));
}));

// Ganti start frame satu scene secara manual (mis. keyframe hasil Nano Banana).
app.post('/api/episodes/:id/scenes/:n/frame', upload.single('file'), wrap((req, res) => {
  const sc = store.scene(req.params.id, req.params.n); if (!sc) throw new Error('Scene tidak ada');
  const ep = store.episode(req.params.id);
  const which = req.query.which === 'single' ? 'singleFrame' : 'startFrame';
  const dir = path.join(epDir(ep), 'frames'); fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, `Scene_${sc.n}_${which}_${Date.now()}${path.extname(req.file.originalname || '.png')}`);
  fs.renameSync(req.file.path, dst);
  sc[which] = rel(dst); store.save(); res.json(sc);
}));

// Edit isi scene.
app.put('/api/episodes/:id/scenes/:n', wrap((req, res) => {
  const sc = store.scene(req.params.id, req.params.n); if (!sc) throw new Error('Scene tidak ada');
  for (const k of ['title', 'setting', 'characters', 'shots', 'audio', 'avoid', 'customPrompt', 'fixLevel', 'status']) if (req.body[k] !== undefined) sc[k] = req.body[k];
  // Potongan awal/akhir klip (detik). Kosong = otomatis.
  for (const k of ['trimStart', 'trimEnd']) if (req.body[k] !== undefined) {
    const v = req.body[k] === '' || req.body[k] === null ? null : Number(req.body[k]);
    if (v !== null && (!Number.isFinite(v) || v < 0)) throw new Error('Potongan harus angka detik ≥ 0');
    sc[k] = v;
  }
  if (sc.trimStart != null && sc.trimEnd != null && sc.trimEnd - sc.trimStart < 0.3) throw new Error('Potongan akhir harus lebih besar dari potongan awal');
  store.save(); res.json(sc);
}));

// Tempel semua prompt sekaligus (format "## SCENE 1: ..." atau blok yang diawali "Model:").
app.post('/api/episodes/:id/paste-prompts', wrap((req, res) => {
  const ep = store.episode(req.params.id); if (!ep) throw new Error('Episode tidak ada');
  const text = String(req.body.text || '').replace(/```/g, '');
  let blocks = text.split(/^\s*#{1,3}\s*SCENE\s+\d+[^\n]*\n/im).map(s => s.trim()).filter(Boolean);
  if (blocks.length < 2) blocks = text.split(/(?=^Model:)/m).map(s => s.trim()).filter(s => s.startsWith('Model:'));
  const titles = [...text.matchAll(/^\s*#{1,3}\s*SCENE\s+(\d+)\s*:?\s*([^\n]*)/gim)].map(m => m[2].trim());
  blocks.slice(0, ep.scenes.length).forEach((b, i) => {
    const sc = ep.scenes[i];
    sc.customPrompt = b.replace(/\*\*Negative prompt:\*\*\s*/i, '\nNEGATIVE PROMPT: ').trim();
    if (titles[i]) sc.title = titles[i];
  });
  store.save(); res.json({ count: Math.min(blocks.length, ep.scenes.length) });
}));

app.get('/api/episodes/:id/scenes/:n/prompt', wrap((req, res) => {
  const ep = store.episode(req.params.id); const sc = store.scene(req.params.id, req.params.n);
  const level = req.query.level != null ? Number(req.query.level) : sc.fixLevel;
  res.json(prompt.build(store.series(ep.seriesId), ep, sc, level));
}));

// Unggah video hasil (diunduh manual dari Flow).
app.post('/api/episodes/:id/scenes/:n/clip', upload.single('file'), wrap((req, res) => {
  const sc = store.scene(req.params.id, req.params.n); if (!sc) throw new Error('Scene tidak ada');
  const ep = store.episode(req.params.id);
  const dir = path.join(epDir(ep), 'clips'); fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, `scene_${sc.n}.mp4`);
  fs.renameSync(req.file.path, dst);
  sc.clip = rel(dst); sc.status = 'done'; store.save(); res.json(sc);
}));

// Gabung episode.
app.post('/api/episodes/:id/merge', wrap(async (req, res) => {
  const ep = store.episode(req.params.id); if (!ep) throw new Error('Episode tidak ada');
  const missing = ep.scenes.filter(s => !s.clip).map(s => s.n);
  if (missing.length) throw new Error(`Video scene ${missing.join(', ')} belum diunggah`);
  res.json(await pipeline.mergeEp(ep));
}));

// Generate ulang satu scene (hasil jelek tapi tidak error): video lama dilepas, versi baru dibuat,
// diunduh, lalu episode digabung ulang.
app.post('/api/episodes/:id/scenes/:n/redo', wrap((req, res) => {
  const ep = store.episode(req.params.id); if (!ep) throw new Error('Episode tidak ada');
  const sc = store.scene(ep.id, req.params.n); if (!sc) throw new Error('Scene tidak ada');
  if (pipeline.isActive(ep.id)) throw new Error('Episode ini sedang diproses. Tunggu selesai dulu.');
  if (req.body && req.body.fromLevel0) sc.fixLevel = 0;
  sc.version = (sc.version || 1) + 1;
  sc.clip = null; sc.flowName = null; sc.status = 'draft'; sc.lastError = null;
  ep.output = null; ep.meta = null;
  store.save();
  res.json(pipeline.start(ep.id, { resume: true, onlyScenes: [sc.n] }));
}));

// Buat ulang judul, deskripsi, hashtag, dan thumbnail.
app.post('/api/episodes/:id/meta', wrap(async (req, res) => {
  const ep = store.episode(req.params.id); if (!ep) throw new Error('Episode tidak ada');
  res.json(await pipeline.makeMeta(ep));
}));

// Aturan perbaikan: Claude mengusulkan kata baru dari prompt yang pernah ditolak; pengguna memilih mana yang dipakai.
function recentFailures(limit = 15) {
  const out = [];
  for (const ep of store.db.episodes) for (const sc of ep.scenes) for (const a of sc.attempts || [])
    if (a.result === 'policy' || a.result === 'audio') out.push({ at: a.at, error: a.error, level: a.level, prompt: a.prompt });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}
app.post('/api/rules/suggest', wrap(async (req, res) => {
  const fails = recentFailures();
  if (!fails.length) throw new Error('Belum ada prompt yang ditolak Flow. Usulan bisa dibuat setelah ada kegagalan.');
  res.json({ ...(await autoprompt.suggestRules(fails, prompt.loadRules(), store.DATA_DIR)), basedOn: fails.length });
}));
app.post('/api/rules/apply', wrap((req, res) => {
  const file = path.join(__dirname, '..', 'config', 'fix-rules.json');
  const rules = JSON.parse(fs.readFileSync(file, 'utf8'));
  const escRe = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const have = new Set(rules.replacements.map(r => String(r[0]).toLowerCase()));
  let added = 0;
  for (const r of req.body.replacements || []) {
    if (!Array.isArray(r) || !r[0] || typeof r[1] !== 'string') continue;
    const from = escRe(String(r[0]).toLowerCase());
    if (have.has(from)) continue;
    rules.replacements.push([from, r[1]]); have.add(from); added++;
  }
  const risky = new Set(rules.riskyDialogueWords.map(w => w.toLowerCase()));
  for (const w of req.body.riskyDialogueWords || []) { const x = String(w).toLowerCase().trim(); if (x && !risky.has(x)) { rules.riskyDialogueWords.push(x); risky.add(x); added++; } }
  fs.writeFileSync(file, JSON.stringify(rules, null, 2) + '\n');
  res.json({ added });
}));

// Statistik: percobaan, kegagalan per jenis, tingkat tertinggi, perkiraan kredit terpakai.
app.get('/api/stats', (req, res) => {
  const blank = () => ({ episodes: 0, scenes: 0, scenesDone: 0, attempts: 0, ok: 0, policy: 0, audio: 0, timeout: 0, credits: 0, error: 0, maxLevel: 0, needsVO: 0, generations: 0 });
  const add = (t, ep) => {
    t.episodes++;
    for (const sc of ep.scenes) {
      t.scenes++; if (sc.clip) t.scenesDone++;
      t.needsVO += (sc.needsVO || []).length;
      for (const a of sc.attempts || []) {
        t.attempts++;
        const k = ['ok', 'policy', 'audio', 'timeout', 'credits'].includes(a.result) ? a.result : 'error';
        t[k]++;
        if (k !== 'error') t.generations++; // prompt benar-benar terkirim ke Flow
        t.maxLevel = Math.max(t.maxLevel, a.level || 0);
      }
    }
  };
  const total = blank();
  const series = store.db.series.map(s => {
    const t = blank();
    const eps = store.db.episodes.filter(e => e.seriesId === s.id);
    eps.forEach(e => { add(t, e); add(total, e); });
    const episodes = eps.map(e => { const x = blank(); add(x, e); return { id: e.id, title: e.title, ...x }; });
    return { id: s.id, title: s.title, ...t, list: episodes };
  });
  const errors = {};
  for (const ep of store.db.episodes) for (const sc of ep.scenes) for (const a of sc.attempts || []) if (a.error) errors[a.error] = (errors[a.error] || 0) + 1;
  res.json({ total, series, topErrors: Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 8) });
});

// ---------- Runner ----------
// Akun Google Flow (profil Chrome terpisah per akun).
app.get('/api/accounts', (req, res) => { const active = runner.activeAccount().id; res.json({ accounts: store.db.accounts, active }); });
app.post('/api/accounts', wrap(async (req, res) => {
  const acc = runner.addAccount(req.body && req.body.name);
  res.json(acc);
  runner.switchAccount(acc.id).catch(e => runner.log(`Gagal pindah akun: ${e.message}`));
}));
app.post('/api/accounts/active', wrap(async (req, res) => res.json(await runner.switchAccount(req.body.id))));
app.post('/api/run', wrap(async (req, res) => {
  const ep = store.episode(req.body.episodeId); if (!ep) throw new Error('Episode tidak ada');
  if (runner.state.running) throw new Error('Antrean sedang berjalan');
  await runner.ensureAccount(pipeline.seriesAccount(store.series(ep.seriesId)).id);
  await runner.runQueue(ep.id, req.body.scenes); res.json({ ok: true });
}));
app.post('/api/stop', (req, res) => { pipeline.stopAll(); res.json({ ok: true }); });
app.delete('/api/queue/:id', wrap((req, res) => res.json(pipeline.cancel(req.params.id))));
app.post('/api/open-flow', wrap(async (req, res) => {
  const ep = req.body && req.body.episodeId ? store.episode(req.body.episodeId) : null;
  await runner.openFlow(ep && ep.flowProjectUrl ? ep.flowProjectUrl : undefined); res.json({ ok: true });
}));
app.get('/api/log', (req, res) => res.json({ log: runner.state.log.slice(-150), running: runner.state.running, current: runner.state.current }));
app.get('/api/rules', (req, res) => res.json(prompt.loadRules()));

app.listen(PORT, HOST, () => {
  console.log(`\n  Flow Drama Studio jalan di  http://localhost:${PORT}${HOST === '127.0.0.1' ? '' : `  (terbuka di ${HOST})`}\n`);
});

process.on('SIGINT', async () => { store.saveNow(); await runner.close(); process.exit(0); });
