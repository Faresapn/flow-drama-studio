// Alur otomatis penuh untuk satu episode:
// storyboard -> potong scene -> Claude menulis isi scene -> generate di Flow (unduh tiap klip) -> gabung.
const path = require('path');
const fs = require('fs');
const store = require('./store');
const runner = require('./runner');
const { cropStoryboard } = require('./crop');
const { autoFill } = require('./autoprompt');
const { mergeEpisode } = require('./merge');

const epDir = ep => path.join(store.DATA_DIR, 'episodes', ep.id);
const rel = abs => path.relative(store.DATA_DIR, abs).split(path.sep).join('/');
const safe = s => String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'episode';

const active = new Set();
// Antrean global: satu browser, jadi episode diproses bergiliran.
let chain = Promise.resolve();

function setStage(ep, stage, extra = {}) {
  ep.pipeline = { ...(ep.pipeline || {}), stage, at: Date.now(), ...extra };
  if (stage !== 'error' && stage !== 'attention') ep.pipeline.error = null;
  store.save();
}

async function mergeEp(ep) {
  const series = store.series(ep.seriesId);
  const name = ep.title.toLowerCase().startsWith(series.title.toLowerCase()) ? safe(ep.title) : `${safe(series.title)}_${safe(ep.title)}`;
  const out = path.join(epDir(ep), `${name}.mp4`);
  const clips = ep.scenes.map(s => ({ file: path.join(store.DATA_DIR, s.clip), trimStart: s.trimStart, trimEnd: s.trimEnd }));
  const r = await mergeEpisode(clips, out);
  ep.output = { file: rel(out), total: r.total, segs: r.segs, at: Date.now() };
  store.save();
  return ep.output;
}

async function crop(ep) {
  const dir = path.join(epDir(ep), 'frames'); fs.mkdirSync(dir, { recursive: true });
  const crops = await cropStoryboard(path.join(store.DATA_DIR, ep.storyboard), dir, ep.scenes.length);
  crops.forEach(c => {
    const sc = ep.scenes.find(s => s.n === c.n);
    if (sc) { sc.startFrame = rel(c.rowFile); sc.singleFrame = rel(c.photoFile); }
  });
  store.save();
}

async function process_(epId, { skipPrompt = false, onlyScenes = null } = {}) {
  const ep = store.episode(epId); if (!ep) return;
  const series = store.series(ep.seriesId);
  const log = m => runner.log(`${ep.title}: ${m}`);
  try {
    if (!ep.storyboard) throw new Error('Storyboard belum diunggah');
    if (!ep.scenes.every(s => s.startFrame)) { setStage(ep, 'cropping'); await crop(ep); }

    const needPrompt = !skipPrompt && ep.scenes.some(s => !s.customPrompt && !s.shots.some(x => x.action));
    if (needPrompt) {
      setStage(ep, 'prompting');
      await autoFill(series, ep, path.join(store.DATA_DIR, ep.storyboard), log);
      store.save();
    }

    // Scene yang sudah jadi di Flow (punya nama) tinggal diunduh, tidak di-generate ulang.
    const todo = ep.scenes.filter(s => !s.clip && !(s.status === 'done' && s.flowName) && (!onlyScenes || onlyScenes.includes(s.n))).map(s => s.n);
    if (todo.length) {
      setStage(ep, 'generating');
      // Scene tanpa klip yang tertanda selesai (mis. unduhan gagal) dikerjakan ulang.
      ep.scenes.filter(s => todo.includes(s.n) && s.status === 'done').forEach(s => { s.status = 'draft'; });
      while (runner.state.running) await new Promise(r => setTimeout(r, 3000));
      const { done } = await runner.runQueue(ep.id, todo);
      await done;
    }

    if (ep.scenes.some(s => s.flowName && !s.clip)) {
      setStage(ep, 'downloading');
      log('Semua video jadi. Mengunduh dari Flow berdasarkan nama scene…');
      while (runner.state.running) await new Promise(r => setTimeout(r, 3000));
      await runner.downloadEpisode(ep);
    }

    const missing = ep.scenes.filter(s => !s.clip);
    if (missing.length) {
      const credit = missing.find(s => /Kredit Flow habis/.test(s.lastError || ''));
      setStage(ep, 'attention', { error: credit ? `${credit.lastError} Scene tersisa: ${missing.map(s => s.n).join(', ')}.` : `Scene ${missing.map(s => s.n).join(', ')} belum punya video (cek manual / unggah sendiri), lalu klik Lanjutkan.` });
      log(ep.pipeline.error);
      return;
    }

    setStage(ep, 'merging');
    log('Menggabungkan semua scene…');
    await mergeEp(ep);
    setStage(ep, 'done');
    log(`Episode jadi (${ep.output.total} detik). Siap diunduh.`);
  } catch (e) {
    setStage(ep, 'error', { error: e.message });
    log(`Alur otomatis berhenti: ${e.message}`);
  }
}

/** Mulai (atau lanjutkan) alur otomatis episode. Kembali langsung; proses jalan di belakang. */
function start(epId, opts) {
  if (active.has(epId)) throw new Error('Episode ini sedang diproses');
  const ep = store.episode(epId); if (!ep) throw new Error('Episode tidak ada');
  active.add(epId);
  setStage(ep, 'waiting');
  chain = chain.then(() => process_(epId, opts)).finally(() => active.delete(epId));
  return { ok: true };
}

module.exports = { start, mergeEp, isActive: id => active.has(id) };
