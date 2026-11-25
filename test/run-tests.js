// Uji cepat tanpa browser: tangga prompt dan crop storyboard contoh.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { build, nextLevel } = require('../src/prompt');

(async () => {
  const series = { characters: [{ key: 'H', role: 'The husband', look: 'x' }] };
  const ep = { scenes: [1, 2, 3] };
  const scene = { n: 2, setting: 'a kitchen.', characters: ['H'], avoid: 'throwing money',
    shots: [{ action: 'he angrily throws one Rp20.000 banknote', dialogue: 'Dua puluh ribu!' }, { action: 'b', dialogue: '' }, { action: 'c', dialogue: '' }, { action: 'd', dialogue: '' }, { action: 'e', dialogue: 'Halo' }], audio: 'kitchen' };
  const L = [0, 1, 2, 3, 4].map(l => build(series, ep, scene, l));
  assert(L[0].frame === 'row' && L[0].prompt.includes('Rp20.000'));
  assert(!/throws|Rp20|throwing money/.test(L[1].prompt), 'tingkat 1 harus menghaluskan kata');
  assert(L[2].frame === 'single' && !L[2].prompt.includes('STORYBOARD INSTRUCTION'));
  assert(L[3].needsVO.length === 1 && L[3].prompt.includes('"Halo"'), 'tingkat 3 hanya membuang dialog berisiko');
  assert(L[4].needsVO.length === 2 && !L[4].prompt.includes('"Halo"'));
  assert(nextLevel(0, 'audio') === 3 && nextLevel(1, 'policy') === 2);
  console.log('tangga prompt: LULUS');

  // Storyboard asli (kalau ada di test/) atau storyboard buatan.
  const { cropStoryboard } = require('../src/crop');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-'));
  let sample = path.join(__dirname, 'sample-storyboard.png');
  if (!fs.existsSync(sample)) sample = await require('./make-sample').makeSample(path.join(tmp, 'sample.png'));
  const r = await cropStoryboard(sample, tmp, 6);
  assert(r.length === 6);
  console.log('crop storyboard contoh: LULUS (6 scene)');

  // Subtitle: waktu cue mengikuti shot dan potongan klip.
  const subs = require('../src/subs');
  const sc = { shots: [{ dialogue: 'Halo' }, { dialogue: '' }, { dialogue: 'Apa kabar?' }, { dialogue: '' }, { dialogue: '' }] };
  const cues = subs.cues([sc, sc], [{ trimStart: 0.5, length: 9.5 }, { trimStart: 0, length: 10 }]);
  assert(cues.length === 4 && Math.abs(cues[0].start) < 1e-9 && Math.abs(cues[2].start - 9.5) < 1e-9, 'waktu subtitle salah');
  assert(subs.toSrt(cues).includes('00:00:09,500 --> '), 'format srt salah');
  console.log('subtitle: LULUS');
})().catch(e => { console.error('GAGAL:', e.message); process.exit(1); });
