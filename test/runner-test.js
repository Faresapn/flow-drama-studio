// Uji runner terhadap halaman Flow tiruan: gagal kebijakan -> gagal audio -> berhasil.
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/flow.mock.json', 'utf8'));
cfg.flowUrl = cfg.flowUrl.replace('__DIR__', __dirname);
cfg.profileDir = require('os').tmpdir() + '/fds-mock-profile';
if (!fs.existsSync(cfg.executablePath || '')) delete cfg.executablePath;
const resolved = require('os').tmpdir() + '/flow.mock.resolved.json';
fs.writeFileSync(resolved, JSON.stringify(cfg));
process.env.FLOW_CONFIG = resolved;
process.env.HEADLESS = '1';
const store = require('../src/store');
const runner = require('../src/runner');
const { sleep } = require('../src/human');
(async () => {
  // Serial + episode uji dengan satu scene berisi dialog soal uang.
  const series = { id: 'test', title: 'Uji', characters: [{ key: 'H', role: 'The husband', look: 'Indonesian man, 35' }, { key: 'W', role: 'The wife', look: 'Indonesian woman, 30, pink hijab' }] };
  const ep = { id: 'testep', seriesId: 'test', title: 'Uji Runner', scenes: [store.newScene(1)] };
  const cleanup = () => { store.db.series = store.db.series.filter(s => s.id !== 'test'); store.db.episodes = store.db.episodes.filter(e => e.id !== 'testep'); };
  cleanup(); store.db.series.push(series); store.db.episodes.push(ep);
  const sc = ep.scenes[0];
  fs.writeFileSync(require('path').join(store.DATA_DIR, 'test_frame.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  sc.startFrame = 'test_frame.png'; sc.singleFrame = 'test_frame.png';
  sc.setting = 'inside a small wooden house.'; sc.characters = ['H', 'W'];
  sc.shots = [{ action: 'he opens a tin', dialogue: '' }, { action: 'he holds the money', dialogue: '' }, { action: 'a', dialogue: '' }, { action: 'she is teary', dialogue: 'Mas, itu buat Nayla...' }, { action: 'he pockets it', dialogue: 'Ini uang dapur, punyaku juga.' }];
  await runner.runQueue(ep.id, [1]);
  const t0 = Date.now();
  while (runner.state.running && Date.now() - t0 < 600000) await sleep(1000);
  const last = await runner.page.evaluate(() => window.__last);
  console.log('RESULT status=', sc.status, 'fixLevel=', sc.fixLevel, 'attempts=', sc.attempts.map(a => `${a.level}:${a.result}`).join(' '));
  console.log('needsVO=', JSON.stringify(sc.needsVO));
  console.log('last submit: hasFile=', last.hasFile, 'promptLen=', last.prompt.length, 'promptStart=', JSON.stringify(last.prompt.slice(0, 80)));
  console.log('prompt matches attempt:', last.prompt.trim() === sc.attempts[sc.attempts.length - 1].prompt.trim());
  const pass = sc.status === 'done' && sc.attempts.map(a => a.level + ':' + a.result).join(' ') === '0:policy 1:audio 3:ok' && last.hasFile === 1;
  console.log(pass ? 'RUNNER TEST: LULUS' : 'RUNNER TEST: GAGAL');
  cleanup(); fs.unlinkSync(require('path').join(store.DATA_DIR, 'test_frame.png'));
  await runner.close(); store.saveNow(); process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
