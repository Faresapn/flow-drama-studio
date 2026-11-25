const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const store = require('./store');
const { cropStoryboard } = require('./crop');
const prompt = require('./prompt');
const runner = require('./runner');
const pipeline = require('./pipeline');

const app = express();
const PORT = process.env.PORT || 4777;
const upload = multer({ dest: path.join(store.DATA_DIR, 'tmp') });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/files', express.static(store.DATA_DIR));

const epDir = ep => path.join(store.DATA_DIR, 'episodes', ep.id);
const rel = abs => path.relative(store.DATA_DIR, abs).split(path.sep).join('/');
const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(e => res.status(400).json({ error: e.message }));

// ---------- Series ----------
app.get('/api/state', (req, res) => res.json({ ...store.db, queue: pipeline.queue, runner: { running: runner.state.running, current: runner.state.current } }));

// 1 drama = 1 akun Google: akun yang dipilih harus ada.
function checkAccount(id) {
  if (!runner.accountById(id)) throw new Error('Akun Google tidak ditemukan');
  return id;
}

app.post('/api/series', wrap((req, res) => {
  const accountId = req.body.accountId ? checkAccount(req.body.accountId) : runner.activeAccount().id;
  const s = { id: store.id(), title: req.body.title || 'Serial baru', characters: req.body.characters || [], accountId, createdAt: Date.now() };
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

app.listen(PORT, () => {
  console.log(`\n  Flow Drama Studio jalan di  http://localhost:${PORT}\n`);
});

process.on('SIGINT', async () => { store.saveNow(); await runner.close(); process.exit(0); });
