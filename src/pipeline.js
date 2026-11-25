// Alur otomatis penuh untuk satu episode:
// storyboard -> potong scene -> Claude menulis isi scene -> generate di Flow (unduh tiap klip) -> gabung.
const path = require('path');
const fs = require('fs');
const store = require('./store');
const runner = require('./runner');
const { cropStoryboard } = require('./crop');
const { autoFill, episodeMeta } = require('./autoprompt');
const { mergeEpisode, frameAt } = require('./merge');
const vo = require('./vo');
const subs = require('./subs');

const epDir = ep => path.join(store.DATA_DIR, 'episodes', ep.id);
const rel = abs => path.relative(store.DATA_DIR, abs).split(path.sep).join('/');
const safe = s => String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'episode';

const { notify } = require('./notify');

const active = new Set();
// Antrean global: satu browser, jadi episode diproses bergiliran (urutan masuk).
let chain = Promise.resolve();
const queue = [];            // id episode yang menunggu giliran
const cancelled = new Set(); // id episode yang dikeluarkan dari antrean sebelum gilirannya
const waitRunner = async () => { while (runner.state.running) await new Promise(r => setTimeout(r, 3000)); };

// 1 drama = 1 akun Google. Serial lama tanpa akun: pakai akun episode terakhirnya, atau akun aktif.
function seriesAccount(series) {
  if (!series.accountId || !runner.accountById(series.accountId)) {
    const last = store.db.episodes.filter(e => e.seriesId === series.id && e.flowAccount && runner.accountById(e.flowAccount)).pop();
    series.accountId = last ? last.flowAccount : runner.activeAccount().id;
    store.save();
  }
  return runner.accountById(series.accountId);
}

function setStage(ep, stage, extra = {}) {
  ep.pipeline = { ...(ep.pipeline || {}), stage, at: Date.now(), ...extra };
  if (stage !== 'error' && stage !== 'attention') ep.pipeline.error = null;
  store.save();
}

async function mergeEp(ep, log = m => runner.log(`${ep.title}: ${m}`)) {
  const series = store.series(ep.seriesId);
  const name = ep.title.toLowerCase().startsWith(series.title.toLowerCase()) ? safe(ep.title) : `${safe(series.title)}_${safe(ep.title)}`;
  const out = path.join(epDir(ep), `${name}.mp4`);
  // VO untuk dialog yang dibuang dari prompt (tangga tingkat 3-4).
  const voDir = path.join(epDir(ep), 'vo');
  const clips = [];
  for (const s of ep.scenes) {
    clips.push({ file: path.join(store.DATA_DIR, s.clip), trimStart: s.trimStart, trimEnd: s.trimEnd, vo: await vo.sceneVO(series, s, voDir, log) });
  }
  // Subtitle: selalu buat .srt; tempel ke video kalau serial memintanya.
  let cueList = [];
  const r = await mergeEpisode(clips, out, {
    overlays: async segs => {
      cueList = subs.cues(ep.scenes, segs);
      if (!series.burnSubs || !cueList.length) return [];
      return subs.renderAll(cueList, path.join(epDir(ep), 'subs'));
    },
  });
  const srt = out.replace(/\.mp4$/, '.srt');
  if (cueList.length) fs.writeFileSync(srt, subs.toSrt(cueList));
  ep.output = { file: rel(out), srt: cueList.length ? rel(srt) : null, total: r.total, segs: r.segs, at: Date.now() };
  store.save();
  return ep.output;
}

/** Judul, deskripsi, hashtag, dan thumbnail (dipilih Claude dari beberapa frame). Tidak menghentikan alur kalau gagal. */
async function makeMeta(ep, log = m => runner.log(`${ep.title}: ${m}`)) {
  const series = store.series(ep.seriesId);
  if (!ep.output) throw new Error('Episode belum digabung');
  const dir = path.join(epDir(ep), 'thumbs'); fs.mkdirSync(dir, { recursive: true });
  const video = path.join(store.DATA_DIR, ep.output.file);
  const frames = [];
  let t = 0;
  for (const seg of ep.output.segs || []) {
    const f = path.join(dir, `cand_${seg.scene}.jpg`);
    await frameAt(video, t + seg.length * 0.45, f).then(() => frames.push(f)).catch(() => {});
    t += seg.length;
  }
  if (!frames.length) throw new Error('Tidak bisa mengambil frame dari video');
  log('Claude menulis judul, deskripsi, hashtag, dan memilih thumbnail…');
  const m = await episodeMeta(series, ep, frames, dir);
  const thumb = path.join(dir, 'thumbnail.jpg');
  fs.copyFileSync(frames[m.thumbnail], thumb);
  ep.meta = { title: m.title, description: m.description, hashtags: m.hashtags, thumbnail: rel(thumb), at: Date.now() };
  store.save();
  return ep.meta;
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

async function process_(epId, { skipPrompt = false, onlyScenes = null, resume = false } = {}) {
  const qi = queue.indexOf(epId); if (qi >= 0) queue.splice(qi, 1);
  if (cancelled.delete(epId)) return;
  const ep = store.episode(epId); if (!ep) return;
  const series = store.series(ep.seriesId);
  if (!series) return;
  const log = m => runner.log(`${ep.title}: ${m}`);
  const label = `${series.title} · ${ep.title}`;
  try {
    if (!ep.storyboard) throw new Error('Storyboard belum diunggah');
    const acc = seriesAccount(series);
    if (resume) acc.creditOut = null;
    if (acc.creditOut) {
      const msg = `Kredit Flow akun "${acc.name}" habis. Isi kredit lalu klik Lanjutkan.`;
      setStage(ep, 'attention', { error: msg });
      log(msg);
      return;
    }
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
      await waitRunner();
      await runner.ensureAccount(acc.id);
      const { done } = await runner.runQueue(ep.id, todo);
      await done;
    }

    if (ep.scenes.some(s => s.flowName && !s.clip)) {
      setStage(ep, 'downloading');
      log('Semua video jadi. Mengunduh dari Flow berdasarkan nama scene…');
      await waitRunner();
      await runner.ensureAccount(ep.flowAccount || acc.id);
      await runner.downloadEpisode(ep);
    }

    const missing = ep.scenes.filter(s => !s.clip);
    if (missing.length) {
      const credit = missing.find(s => /Kredit Flow habis/.test(s.lastError || ''));
      if (credit) acc.creditOut = Date.now();
      setStage(ep, 'attention', { error: credit ? `${credit.lastError} (akun "${acc.name}") Scene tersisa: ${missing.map(s => s.n).join(', ')}.` : `Scene ${missing.map(s => s.n).join(', ')} belum punya video (cek manual / unggah sendiri), lalu klik Lanjutkan.` });
      log(ep.pipeline.error);
      notify(credit ? `Kredit habis: ${acc.name}` : `Perlu dicek: ${label}`, ep.pipeline.error);
      return;
    }

    setStage(ep, 'merging');
    log('Menggabungkan semua scene…');
    await mergeEp(ep, log);
    if (series.autoMeta !== false) await makeMeta(ep, log).catch(e => log(`Judul & thumbnail gagal dibuat: ${e.message}`));
    setStage(ep, 'done');
    log(`Episode jadi (${ep.output.total} detik). Siap diunduh.`);
    notify(`Episode jadi: ${label}`, `${ep.output.total} detik. Siap diunduh di dashboard.`);
  } catch (e) {
    setStage(ep, 'error', { error: e.message });
    log(`Alur otomatis berhenti: ${e.message}`);
    notify(`Berhenti: ${label}`, e.message);
  } finally {
    if (!queue.length) { runner.log('Antrean episode kosong.'); }
  }
}

/** Mulai (atau lanjutkan) alur otomatis episode. Kembali langsung; proses jalan di belakang. */
function start(epId, opts) {
  if (active.has(epId)) throw new Error('Episode ini sedang diproses');
  const ep = store.episode(epId); if (!ep) throw new Error('Episode tidak ada');
  active.add(epId);
  queue.push(epId);
  setStage(ep, 'waiting');
  chain = chain.then(() => process_(epId, opts)).finally(() => active.delete(epId));
  return { ok: true, position: queue.length };
}

/** Keluarkan episode dari antrean (hanya yang belum mulai diproses). */
function cancel(epId) {
  const i = queue.indexOf(epId);
  if (i < 0) throw new Error('Episode ini tidak sedang menunggu di antrean');
  queue.splice(i, 1); cancelled.add(epId);
  const ep = store.episode(epId); if (ep) setStage(ep, 'stopped');
  return { ok: true };
}

/** Hentikan semua: scene yang sedang jalan berhenti setelah langkah ini, antrean dikosongkan. */
function stopAll() {
  for (const id of [...queue]) cancel(id);
  runner.stop();
}

module.exports = { start, cancel, stopAll, mergeEp, makeMeta, seriesAccount, isActive: id => active.has(id), get queue() { return [...queue]; } };
