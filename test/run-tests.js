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

  const sample = path.join(__dirname, 'sample-storyboard.png');
  if (fs.existsSync(sample)) {
    const { cropStoryboard } = require('../src/crop');
    const r = await cropStoryboard(sample, fs.mkdtempSync(path.join(os.tmpdir(), 'fds-')), 6);
    assert(r.length === 6);
    console.log('crop storyboard contoh: LULUS (6 scene)');
  }
})().catch(e => { console.error('GAGAL:', e.message); process.exit(1); });
