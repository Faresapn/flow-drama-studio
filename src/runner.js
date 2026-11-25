// Menjalankan antrean scene di Google Flow lewat Playwright (browser terlihat,
// profil tetap supaya login Google cukup sekali). Gagal -> naik level perbaikan -> ulangi.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const store = require('./store');
const prompt = require('./prompt');
const { Human, sleep, rand } = require('./human');
const { notify } = require('./notify');

const ROOT = path.join(__dirname, '..');
const CFG_FILE = process.env.FLOW_CONFIG ? path.resolve(process.env.FLOW_CONFIG) : path.join(ROOT, 'config', 'flow.json');
const loadCfg = () => JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));

const state = { running: false, stopRequested: false, current: null, log: [] };
let context = null, page = null;

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('id-ID')}] ${msg}`;
  state.log.push(line);
  if (state.log.length > 400) state.log.shift();
  console.log(line);
}

// Akun Google: tiap akun punya profil Chrome sendiri (login sekali per akun).
function activeAccount() {
  const db = store.db;
  if (!db.accounts || !db.accounts.length) {
    db.accounts = [{ id: 'a1', name: 'Akun 1', profileDir: loadCfg().profileDir }];
    db.activeAccount = 'a1'; store.save();
  }
  return db.accounts.find(a => a.id === db.activeAccount) || db.accounts[0];
}
async function switchAccount(id) {
  if (state.running) throw new Error('Antrean sedang berjalan. Hentikan dulu atau tunggu selesai.');
  const acc = (store.db.accounts || []).find(a => a.id === id);
  if (!acc) throw new Error('Akun tidak ada');
  // Video yang sudah jadi tapi belum diunduh ada di akun lama: unduh dulu sebelum pindah.
  for (const ep of store.db.episodes) {
    if (ep.flowAccount === activeAccount().id && ep.scenes.some(s => s.flowName && !s.clip)) {
      log(`Sebelum ganti akun: mengunduh video ${ep.title} yang sudah jadi…`);
      await downloadEpisode(ep).catch(e => log(`Gagal mengunduh ${ep.title}: ${e.message}`));
    }
  }
  await close();
  store.db.activeAccount = acc.id; store.save();
  log(`Akun Google aktif: ${acc.name}. Kalau belum login, login di jendela Chrome yang terbuka.`);
  await openFlow();
  return acc;
}
/** Pindah ke akun tertentu kalau belum aktif (dipakai antrean: 1 drama = 1 akun Google). */
async function ensureAccount(id) {
  if (!id || id === activeAccount().id) return activeAccount();
  return switchAccount(id);
}
const accountById = id => (store.db.accounts || []).find(a => a.id === id) || null;
function addAccount(name) {
  activeAccount();
  const n = store.db.accounts.length + 1;
  const id = 'a' + Date.now().toString(36);
  const acc = { id, name: String(name || `Akun ${n}`).slice(0, 40), profileDir: `./browser-profiles/${id}` };
  store.db.accounts.push(acc); store.save();
  return acc;
}

async function openBrowser() {
  const cfg = loadCfg();
  if (context) return;
  const profile = path.resolve(ROOT, activeAccount().profileDir || cfg.profileDir);
  fs.mkdirSync(profile, { recursive: true });
  const opts = {
    headless: process.env.HEADLESS === '1',
    ...(cfg.executablePath ? { executablePath: cfg.executablePath } : {}),
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    acceptDownloads: true,
  };
  try {
    context = await chromium.launchPersistentContext(profile, cfg.executablePath ? opts : { ...opts, channel: cfg.browserChannel || 'chrome' });
  } catch (e) {
    log(`Chrome tidak ditemukan (${e.message.split('\n')[0]}), pakai Chromium bawaan Playwright.`);
    context = await chromium.launchPersistentContext(profile, opts);
  }
  context.on('close', () => { context = null; page = null; });
  page = context.pages()[0] || await context.newPage();
}

async function openFlow(url) {
  await openBrowser();
  const target = url || loadCfg().flowUrl;
  if (!page.url().startsWith(target)) await page.goto(target, { waitUntil: 'domcontentloaded' });
  return page;
}

// Buat project Flow baru (dipakai tiap serial baru). Mengembalikan URL project.
let projectBusy = null;
async function createProject(title) {
  while (projectBusy) await projectBusy.catch(() => {});
  const job = (async () => {
    const cfg = loadCfg();
    const pc = cfg.project;
    if (!pc) throw new Error('config/flow.json tidak punya bagian "project"');
    await openBrowser();
    const human = new Human(page, cfg.human);
    await page.goto(pc.homeUrl, { waitUntil: 'domcontentloaded' });
    await human.pause([2000, 4000]);
    const btn = await firstVisible(pc.newButton, 60);
    if (!btn) throw new Error(`Tombol project baru tidak ditemukan (${pc.newButton}). Sudah login?`);
    await human.click(btn);
    await page.waitForURL(/\/project\//, { timeout: 60000 });
    await human.pause([2000, 3500]);
    if (title && pc.titleInput) {
      const inp = await firstVisible(pc.titleInput, 20);
      if (inp) {
        await human.click(inp);
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.type(title, { delay: 60 });
        await page.keyboard.press('Enter');
        await human.pause();
      }
    }
    const url = page.url().split('?')[0];
    log(`Project Flow dibuat: "${title}" → ${url}`);
    return url;
  })();
  projectBusy = job;
  try { return await job; } finally { projectBusy = null; }
}

// Pastikan objek (episode) punya project Flow; buat kalau belum ada.
async function ensureProject(target, title = target.title) {
  if (target.flowProjectUrl) return target.flowProjectUrl;
  target.flowProjectStatus = 'creating'; store.save();
  try {
    target.flowProjectUrl = await createProject(title);
    target.flowProjectStatus = 'ok'; target.flowProjectError = null;
  } catch (e) {
    target.flowProjectStatus = 'error'; target.flowProjectError = e.message;
    log(`Gagal membuat project Flow "${title}": ${e.message}`);
    throw e;
  } finally { store.save(); }
  return target.flowProjectUrl;
}
// Satu project Flow per episode, supaya video antar-episode tidak tercampur.
const episodeProjectTitle = (series, ep) => (ep.title.toLowerCase().startsWith(series.title.toLowerCase()) ? ep.title : `${series.title} – ${ep.title}`).slice(0, 100);
// Versi > 1 (generate ulang) diberi akhiran supaya tidak tertukar dengan video lama di Flow.
const sceneVideoName = (ep, sc) => `Scene ${sc.n} – ${ep.title}`.slice(0, 74) + (sc.version > 1 ? ` v${sc.version}` : '');

function fill(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

async function firstVisible(selector, timeoutSec) {
  const loc = page.locator(selector);
  const end = Date.now() + timeoutSec * 1000;
  while (Date.now() < end) {
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
    await sleep(500);
  }
  return null;
}

async function runSteps(vars) {
  const cfg = loadCfg();
  const human = new Human(page, cfg.human);
  for (const step of cfg.steps) {
    if (state.stopRequested) throw new Error('Dihentikan oleh pengguna');
    const sel = step.selector ? fill(step.selector, vars) : null;
    const t = step.timeoutSec || 20;
    switch (step.do) {
      case 'goto': {
        const url = fill(step.url, vars);
        if (step.onlyIfNotOnUrl && page.url().startsWith(url)) break;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await human.pause([2000, 4000]);
        break;
      }
      case 'waitFor': {
        const el = await firstVisible(sel, t);
        if (!el && !step.optional) throw new Error(`Elemen tidak muncul: ${sel}`);
        await human.wander();
        break;
      }
      case 'click': {
        const el = await firstVisible(sel, t);
        if (!el) { if (step.optional) break; throw new Error(`Tombol tidak ditemukan: ${sel}`); }
        await human.click(el);
        break;
      }
      case 'upload': {
        const file = fill(step.file, vars);
        if (step.via === 'chooser') {
          // Flow baru: tombol tambah bahan -> Upload media (file chooser) -> setujui hak gambar -> pilih file di panel aset.
          // Bisa lebih dari satu gambar referensi (frame scene + sheet tokoh). Nama tetap: kalau sudah pernah diunggah
          // ke project, cukup dipilih lagi tanpa unggah ulang.
          const refs = (vars.refs && vars.refs.length) ? vars.refs : [{ file, name: vars.assetName || path.basename(file), label: 'Start frame' }];
          for (const ref of refs) {
            const name = ref.name || path.basename(ref.file);
            const pickSel = fill(step.pick, { ...vars, fileName: name });
            const trigSel = fill(step.trigger, vars);
            // Panel bahan mungkin masih terbuka dari gambar sebelumnya; buka hanya kalau belum.
            if (!(await firstVisible(trigSel, 1))) {
              const open = await firstVisible(fill(step.open, vars), t);
              if (!open) throw new Error(`Tombol tambah bahan tidak ditemukan: ${step.open}`);
              await human.click(open);
              await human.pause([1500, 2500]);
            }
            let pick = await firstVisible(pickSel, 3);
            if (!pick) {
              const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fds-'));
              const named = path.join(tmpDir, name);
              fs.copyFileSync(ref.file, named);
              const trig = await firstVisible(trigSel, t);
              if (!trig) throw new Error(`Tombol upload tidak ditemukan: ${step.trigger}`);
              const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: t * 1000 }), human.click(trig)]);
              await human.pause([600, 1400]);
              await fc.setFiles(named);
              if (step.agree) { const ok = await firstVisible(fill(step.agree, vars), 8); if (ok) await human.click(ok); }
              pick = await firstVisible(pickSel, t);
              fs.rm(tmpDir, { recursive: true, force: true }, () => {});
              if (!pick) throw new Error(`Gambar unggahan tidak muncul di panel aset: ${name}`);
              log(`${ref.label || 'Referensi'} diunggah ke Flow: ${name}`);
            } else log(`${ref.label || 'Referensi'} sudah ada di project, dipakai ulang: ${name}`);
            const before = step.attached ? await page.locator(step.attached).count().catch(() => 0) : 0;
            await human.click(pick);
            await human.pause([1000, 2000]);
            // Klik gambar hanya membuka pratinjau; tombol 'Tambahkan ke perintah' yang benar-benar melampirkannya.
            // Kalau sudah ada lampiran, klik gambar langsung menambahkannya; kalau belum, muncul pratinjau + tombol konfirmasi.
            const direct = step.attached ? (await page.locator(step.attached).count().catch(() => 0)) > before : false;
            if (step.confirm && !direct) {
              const add = await firstVisible(fill(step.confirm, vars), 10);
              if (!add) throw new Error(`Tombol tambahkan ke perintah tidak ditemukan: ${step.confirm}`);
              await human.click(add);
              await human.pause([1500, 2500]);
            }
            if (step.attached) {
              let n = 0;
              for (let i = 0; i < 10 && n <= before; i++) { n = await page.locator(step.attached).count().catch(() => 0); if (n <= before) await sleep(1000); }
              if (n <= before) throw new Error(`${ref.label || 'Referensi'} tidak terlampir di kotak prompt: ${name}`);
            }
          }
          break;
        }
        const input = page.locator(sel).first();
        await input.waitFor({ state: 'attached', timeout: t * 1000 });
        await human.pause([600, 1400]);
        await input.setInputFiles(file);
        await human.pause([2500, 5000]);
        break;
      }
      case 'type': {
        const el = await firstVisible(sel, t);
        if (!el) throw new Error(`Kolom prompt tidak ditemukan: ${sel}`);
        await human.type(el, fill(step.text, vars), { clear: step.clear !== false });
        break;
      }
      case 'wait': await sleep((step.sec || 1) * 1000); break;
      case 'press': await page.keyboard.press(step.key); await human.pause(); break;
      default: throw new Error(`Langkah tidak dikenal: ${step.do}`);
    }
  }
}

// Tunggu hasil: video baru muncul (berhasil) atau teks gagal muncul.
async function waitResult(videosBefore, pageTextBefore) {
  const cfg = loadCfg().result;
  const end = Date.now() + cfg.timeoutSec * 1000;
  const failCountBefore = {};
  let approved = false;
  for (const t of cfg.failTexts) failCountBefore[t] = (pageTextBefore.match(new RegExp(escapeRe(t), 'g')) || []).length;
  const countQ = txt => (cfg.questionTexts || []).reduce((n, t) => n + (txt.match(new RegExp(escapeRe(t), 'g')) || []).length, 0);
  let qSeen = countQ(pageTextBefore), replies = 0;
  while (Date.now() < end) {
    if (state.stopRequested) return { ok: false, kind: 'stopped', error: 'Dihentikan' };
    await sleep(cfg.pollSec * 1000);
    if (!approved) approved = await clickApprovals();
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    for (const t of cfg.creditTexts || []) {
      if ((text.match(new RegExp(escapeRe(t), 'gi')) || []).length > (pageTextBefore.match(new RegExp(escapeRe(t), 'gi')) || []).length)
        return { ok: false, kind: 'credits', error: `Kredit Flow habis ("${t}"). Ganti akun Google lalu klik Lanjutkan.` };
    }
    for (const t of cfg.failTexts) {
      const c = (text.match(new RegExp(escapeRe(t), 'g')) || []).length;
      if (c > failCountBefore[t]) {
        const kind = cfg.audioFailTexts.some(a => t === a) ? 'audio' : 'policy';
        return { ok: false, kind, error: `Flow menampilkan: "${t}"` };
      }
    }
    // Agen bertanya balik (mis. metode generate): jawab otomatis, maksimal 2 kali.
    const q = countQ(text);
    if (q > qSeen && cfg.questionReply && replies < 2) {
      qSeen = q; replies++;
      await replyAgent(cfg.questionReply).catch(e => log(`Gagal menjawab pertanyaan agen: ${e.message}`));
    }
    const vids = await page.locator(cfg.successSelector).count().catch(() => 0);
    // Tile yang masih diproses (pending) belum dihitung; tunggu sampai tidak ada yang pending.
    const pending = cfg.pendingSelector ? await page.locator(cfg.pendingSelector).count().catch(() => 0) : 0;
    if (vids > videosBefore && pending === 0) return { ok: true };
  }
  return { ok: false, kind: 'timeout', error: `Tidak ada hasil setelah ${cfg.timeoutSec} detik` };
}
// Tunggu video yang masih diproses (mis. dari scene sebelumnya) selesai, supaya tidak tertukar.
async function waitNoPending(maxSec = 1200) {
  const sel = loadCfg().result.pendingSelector; if (!sel) return;
  const end = Date.now() + maxSec * 1000; let said = false;
  while (Date.now() < end && !state.stopRequested) {
    const n = await page.locator(sel).count().catch(() => 0);
    if (!n) return;
    if (!said) { log(`Menunggu ${n} video yang masih diproses di Flow selesai dulu…`); said = true; }
    await sleep(10000);
  }
}
async function replyAgent(textReply) {
  const all = loadCfg();
  const human = new Human(page, all.human);
  const typeStep = all.steps.filter(x => x.do === 'type').pop();
  const sendStep = all.steps.filter(x => x.do === 'click').pop();
  const box = await firstVisible(typeStep.selector, 15);
  if (!box) throw new Error('kotak prompt tidak ada');
  await human.type(box, textReply, { clear: true });
  const send = await firstVisible(sendStep.selector, 10);
  if (!send) throw new Error('tombol kirim tidak ada');
  await human.click(send);
  log(`Agen Flow bertanya, dijawab otomatis: "${textReply}"`);
}
// Agen Flow kadang minta persetujuan sebelum membuat video (pertama kali per project ada opsi auto-approve).
async function clickApprovals() {
  const rcfg = loadCfg().result;
  for (const sel of rcfg.approveSelectors || []) {
    const loc = page.locator(sel);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false) && await el.isEnabled().catch(() => false)) {
        const label = ((await el.innerText().catch(() => '')) || sel).trim().replace(/\s+/g, ' ').slice(0, 40);
        await el.click({ timeout: 3000 }).catch(() => {});
        log(`Klik persetujuan Flow: "${label}"`);
        await sleep(1500);
        return true;
      }
    }
  }
  return false;
}

// Tunggu grid media project selesai dimuat (jumlah tile stabil) sebelum menghitung video lama.
async function settleGrid() {
  let last = -1, same = 0;
  for (let i = 0; i < 20 && same < 3; i++) {
    const n = await page.locator('flow-grid-tile-container, video').count().catch(() => 0);
    same = n === last ? same + 1 : 0; last = n;
    await sleep(1000);
  }
}

// Kunci tiap tile video yang sedang ada di grid project (thumbnail src).
async function videoSrcs() {
  const d = loadCfg().result.download || {};
  return page.evaluate(({ tile, thumb }) => [...document.querySelectorAll(tile)].map(t => { const i = t.querySelector(thumb); return (i && i.src) || t.getAttribute('aria-label') || ''; }).filter(Boolean),
    { tile: d.tile || 'video', thumb: d.thumb || 'img' }).catch(() => []);
}

// Unduh video baru (tile yang belum ada sebelum generate) lewat menu ⋮ -> Download -> 720p.
async function newTileIndex(before, timeoutSec = 120) {
  const end = Date.now() + timeoutSec * 1000;
  for (;;) {
    const idx = (await videoSrcs()).findIndex(u => !before.includes(u));
    if (idx >= 0) return idx;
    if (Date.now() > end) throw new Error('Tile video baru tidak ditemukan di project');
    await sleep(2000);
  }
}

/** Unduh semua scene episode yang sudah jadi (punya flowName) tapi belum punya klip, berdasarkan nama tile di Flow. */
async function downloadEpisode(ep) {
  const todo = ep.scenes.filter(sc => sc.flowName && !sc.clip);
  if (!todo.length) return;
  if (ep.flowAccount && ep.flowAccount !== activeAccount().id) {
    const acc = (store.db.accounts || []).find(a => a.id === ep.flowAccount);
    throw new Error(`Video ${ep.title} ada di akun "${acc ? acc.name : ep.flowAccount}". Ganti ke akun itu dulu untuk mengunduh.`);
  }
  await openFlow(ep.flowProjectUrl);
  await settleGrid();
  for (const sc of todo) {
    const dest = path.join(store.DATA_DIR, 'episodes', ep.id, 'clips', `scene_${sc.n}.mp4`);
    const tile = page.locator(`flow-grid-tile-container[aria-label="${sc.flowName.replace(/"/g, '\\"')}"]`).first();
    let d = null;
    for (let k = 0; k < 3 && !d; k++) {
      try {
        if (!(await tile.count())) throw new Error(`video "${sc.flowName}" tidak ditemukan di project`);
        d = await downloadTile(tile, dest);
      } catch (e) { log(`Scene ${sc.n}: unduh percobaan ${k + 1} gagal (${e.message.split('\n')[0]})`); await page.keyboard.press('Escape').catch(() => {}); await sleep(4000); }
    }
    if (d) { sc.clip = path.relative(store.DATA_DIR, dest).split(path.sep).join('/'); log(`Scene ${sc.n}: terunduh (${(d.bytes / 1e6).toFixed(1)} MB).`); }
    store.save();
  }
}

async function downloadNewVideo(before, dest, timeoutSec = 120, renameTo = null) {
  const d = loadCfg().result.download;
  const end = Date.now() + timeoutSec * 1000;
  let idx = -1;
  while (Date.now() < end && idx < 0) {
    const now = await videoSrcs();
    idx = now.findIndex(u => !before.includes(u));
    if (idx < 0) await sleep(2000);
  }
  if (idx < 0) throw new Error('Tile video baru tidak ditemukan di project');
  const tile = page.locator(d.tile).nth(idx);
  const r = await downloadTile(tile, dest);
  // Beri nama tile di Flow (mis. "Scene 3 – Episode 1") supaya video tidak tertukar saat dicek manual.
  if (renameTo) await renameTile(tile, renameTo).then(() => log(`Video di Flow diberi nama: ${renameTo}`)).catch(e => log(`Gagal memberi nama video di Flow: ${e.message}`));
  return r;
}

async function renameTile(tile, name) {
  const d = loadCfg().result.download;
  await page.keyboard.press('Escape').catch(() => {});
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  await tile.click({ button: 'right' }); await sleep(rand(600, 1100));
  await page.locator(d.rename || "[role=menuitem]:has-text('Ganti nama'), [role=menuitem]:has-text('Rename')").first().click({ timeout: 8000 });
  await sleep(rand(800, 1300));
  const ok = await page.evaluate(() => document.activeElement && document.activeElement.tagName === 'INPUT');
  if (!ok) throw new Error('kolom nama tidak muncul');
  await page.keyboard.press('Meta+A');
  await page.keyboard.type(name, { delay: rand(20, 50) });
  await page.keyboard.press('Enter');
  await sleep(1000);
}

// Unduh satu tile video: klik kanan (menu konteks) -> Download -> 720p. Cadangan: hover -> Opsi lainnya.
async function downloadTile(tile, dest) {
  const d = loadCfg().result.download;
  await page.keyboard.press('Escape').catch(() => {});
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  const item = page.locator(d.item).first();
  await tile.click({ button: 'right' }); await sleep(rand(700, 1300));
  if (!(await item.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => {});
    await tile.hover(); await sleep(rand(700, 1400));
    await tile.locator(d.more).first().click({ timeout: 15000 });
    await sleep(rand(600, 1200));
  }
  const dl = page.waitForEvent('download', { timeout: 90000 });
  await item.click();
  await sleep(rand(600, 1200));
  const q = page.locator(d.quality).first();
  if (await q.isVisible().catch(() => false)) await q.click();
  const file = await dl;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await file.saveAs(dest);
  const bytes = fs.statSync(dest).size;
  if (bytes < 50000) throw new Error(`File video terlalu kecil (${bytes} byte)`);
  await page.keyboard.press('Escape').catch(() => {});
  return { bytes };
}

async function flowScreenshot(tag) {
  if (!page) return null;
  try {
    const dir = path.join(store.DATA_DIR, 'debug'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${tag}.png`);
    await page.screenshot({ path: file, timeout: 15000 });
    log(`Screenshot halaman Flow disimpan: ${file}`);
    return file;
  } catch { return null; }
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function runScene(ep, scene) {
  const cfg = loadCfg();
  const series = store.series(ep.seriesId);
  while (scene.status !== 'done' && !state.stopRequested) {
    const ladderMax = prompt.loadRules().ladder.length - 1;
    if (scene.fixLevel >= ladderMax || scene.attempts.length >= cfg.maxAttemptsPerScene) {
      scene.status = 'manual'; store.save();
      log(`Scene ${scene.n}: semua cara perbaikan habis, ditandai CEK MANUAL.`);
      return;
    }
    const built = prompt.build(series, ep, scene, scene.fixLevel);
    const frameRel = built.frame === 'single' && scene.singleFrame ? scene.singleFrame : scene.startFrame;
    if (!frameRel) { scene.status = 'failed'; scene.lastError = 'Start frame belum ada'; store.save(); return; }
    const frameAbs = path.join(store.DATA_DIR, frameRel);

    scene.status = 'running'; scene.pauseReason = null; store.save();
    state.current = { episode: ep.title, scene: scene.n, level: built.level, levelName: built.levelName };
    log(`${ep.title} · Scene ${scene.n} · percobaan ${scene.attempts.length + 1} · level ${built.level} (${built.levelName})`);

    const attempt = { at: new Date().toISOString(), level: built.level, levelName: built.levelName, frame: built.frame, prompt: built.prompt };
    try {
      if (ep.flowProjectUrl && ep.flowAccount && ep.flowAccount !== activeAccount().id) {
        log(`Akun Google berganti: ${ep.title} dibuatkan project baru di akun ${activeAccount().name}.`);
        ep.flowProjectUrl = null;
      }
      const flowUrl = cfg.project ? await ensureProject(ep, episodeProjectTitle(series, ep)) : cfg.flowUrl;
      ep.flowAccount = activeAccount().id;
      await openFlow(flowUrl);
      await settleGrid();
      await waitNoPending();
      const videosBefore = await page.locator(loadCfg().result.successSelector).count().catch(() => 0);
      const srcsBefore = await videoSrcs();
      const textBefore = await page.evaluate(() => document.body.innerText).catch(() => '');
      const refs = [{ file: frameAbs, label: 'Frame scene', name: `${ep.id}_scene${scene.n}_${frameRel === scene.singleFrame ? 'single' : 'row'}_${require('crypto').createHash('md5').update(fs.readFileSync(frameAbs)).digest('hex').slice(0, 6)}${path.extname(frameAbs) || '.png'}` }];
      const sheetAbs = series.characterSheet ? path.join(store.DATA_DIR, series.characterSheet) : null;
      if (sheetAbs && fs.existsSync(sheetAbs)) refs.push({ file: sheetAbs, label: 'Sheet tokoh', name: path.basename(sheetAbs) });
      else if (!state._warnedSheet) { state._warnedSheet = true; log('Serial ini belum punya sheet tokoh; hanya frame scene yang dipakai sebagai referensi.'); }
      await runSteps({ flowUrl, startFrame: frameAbs, refs, prompt: built.prompt });
      log(`Scene ${scene.n}: prompt terkirim, menunggu hasil…`);
      const r = await waitResult(videosBefore, textBefore);
      attempt.result = r.ok ? 'ok' : r.kind;
      if (!r.ok) attempt.error = r.error;
      scene.attempts.push(attempt);
      if (r.ok) {
        scene.status = 'done';
        scene.needsVO = built.needsVO;
        const name = sceneVideoName(ep, scene);
        try {
          const idx = await newTileIndex(srcsBefore);
          await renameTile(page.locator(loadCfg().result.download.tile).nth(idx), name);
          scene.flowName = name;
          log(`Scene ${scene.n}: BERHASIL, video di Flow diberi nama "${name}" (diunduh setelah semua scene jadi).`);
        } catch (e) {
          // Gagal memberi nama: langsung unduh saja supaya video tidak hilang jejak.
          log(`Scene ${scene.n}: BERHASIL, tapi gagal memberi nama (${e.message.split('\n')[0]}). Langsung diunduh.`);
          try {
            const dest = path.join(store.DATA_DIR, 'episodes', ep.id, 'clips', `scene_${scene.n}.mp4`);
            const d = await downloadNewVideo(srcsBefore, dest);
            scene.clip = path.relative(store.DATA_DIR, dest).split(path.sep).join('/');
            log(`Scene ${scene.n}: video terunduh (${(d.bytes / 1e6).toFixed(1)} MB).`);
          } catch (e2) { scene.lastError = e2.message; log(`Scene ${scene.n}: unduh juga gagal (${e2.message.split('\n')[0]}).`); }
        }
      } else if (r.kind === 'credits') {
        scene.status = 'queued'; scene.lastError = r.error;
        state.stopRequested = true;
        log(`Scene ${scene.n}: ${r.error}`);
      } else if (r.kind === 'stopped') {
        scene.status = 'queued';
      } else if (r.kind === 'timeout') {
        // Video tidak muncul: jangan coba terus, jeda supaya bisa dibuat manual.
        scene.status = 'failed'; scene.lastError = r.error; scene.pauseReason = 'timeout';
        state.stopRequested = true;
        log(`Scene ${scene.n}: ${r.error}. Antrean dijeda.`);
      } else {
        scene.fixLevel = prompt.nextLevel(scene.fixLevel, r.kind);
        scene.status = 'queued';
        log(`Scene ${scene.n}: gagal (${r.error}). Naik ke level ${scene.fixLevel}.`);
      }
    } catch (e) {
      attempt.result = 'error'; attempt.error = e.message;
      scene.attempts.push(attempt);
      scene.status = 'failed'; scene.lastError = e.message; scene.pauseReason = 'flow';
      state.stopRequested = true; // jeda: scene berikutnya tidak dicoba sampai kamu lanjutkan
      log(`Scene ${scene.n}: ERROR otomasi: ${e.message}. Antrean dijeda. Cek selector di config/flow.json.`);
      // Kemungkinan tampilan Flow berubah: simpan screenshot dan beri tahu.
      const shot = await flowScreenshot(`${ep.id}_scene${scene.n}`);
      scene.lastScreenshot = shot ? path.relative(store.DATA_DIR, shot).split(path.sep).join('/') : null;
      notify('Tampilan Flow mungkin berubah, antrean dijeda', `${ep.title} scene ${scene.n}: ${e.message.split('\n')[0].slice(0, 160)}. Buat scene ini manual atau jalankan npm run calibrate.${shot ? ` Screenshot: ${shot}` : ''}`, shot);
      store.save();
      return;
    }
    store.save();
    if (scene.status !== 'done' && !state.stopRequested) await sleep(rand(8000, 15000));
  }
}

async function runQueue(epId, sceneNs) {
  if (state.running) throw new Error('Antrean sedang berjalan');
  const ep = store.episode(epId);
  if (!ep) throw new Error('Episode tidak ditemukan');
  state.running = true; state.stopRequested = false;
  const targets = ep.scenes.filter(s => (!sceneNs || sceneNs.includes(s.n)) && s.status !== 'done');
  targets.forEach(s => { s.status = 'queued'; if (s.status === 'manual') s.fixLevel = 0; });
  store.save();
  log(`Mulai antrean ${ep.title}: scene ${targets.map(s => s.n).join(', ')}`);
  const done = (async () => {
    try {
      for (let i = 0; i < targets.length; i++) {
        if (state.stopRequested) break;
        await runScene(ep, targets[i]);
        if (i < targets.length - 1 && !state.stopRequested) {
          const [a, b] = loadCfg().pauseBetweenScenesSec;
          const wait = rand(a, b);
          log(`Istirahat ${Math.round(wait)} detik sebelum scene berikutnya…`);
          await sleep(wait * 1000);
        }
      }
      log(state.stopRequested ? 'Antrean dihentikan.' : 'Antrean selesai.');
    } finally {
      state.running = false; state.current = null; state.stopRequested = false;
      ep.scenes.forEach(s => { if (s.status === 'queued' || s.status === 'running') s.status = 'draft'; });
      store.save();
    }
  })();
  return { done };
}

function stop() { state.stopRequested = true; log('Permintaan berhenti diterima, menunggu langkah saat ini selesai…'); }

async function close() { if (context) await context.close().catch(() => {}); context = null; page = null; }

module.exports = { sceneVideoName, state, log, activeAccount, switchAccount, ensureAccount, accountById, addAccount, downloadEpisode, newTileIndex, downloadNewVideo, downloadTile, renameTile, videoSrcs, runQueue, runSteps, stop, openFlow, createProject, ensureProject, close, loadCfg, get page() { return page; } };
