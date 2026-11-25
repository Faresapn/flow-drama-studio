// Memotong gambar "storyboard lengkap" menjadi baris per scene (start frame)
// dan foto shot 1 per scene (start frame cadangan untuk level perbaikan 2).
const sharp = require('sharp');

const isCream = (mean, sat) => mean > 225 && sat < 40;

function runs(flags, minLen, mergeGap) {
  // flags[i] true = konten (bukan krem). Kembalikan [start, end] inklusif.
  const out = [];
  let s = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i];
    if (on && s < 0) s = i;
    if (!on && s >= 0) { out.push([s, i - 1]); s = -1; }
  }
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= mergeGap) last[1] = r[1];
    else merged.push([...r]);
  }
  return merged.filter(r => r[1] - r[0] + 1 >= minLen);
}

async function analyze(file) {
  const img = sharp(file).removeAlpha();
  const meta = await img.metadata();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const px = (x, y) => {
    const i = (y * W + x) * C;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return [(r + g + b) / 3, Math.max(r, g, b) - Math.min(r, g, b)];
  };
  return { W, H, px, meta, data, C };
}

function rowFlags(a, x0, x1, y0 = 0, y1 = a.H - 1) {
  const flags = [];
  for (let y = y0; y <= y1; y++) {
    let m = 0, s = 0, n = 0;
    for (let x = x0; x < x1; x += 2) { const [mm, ss] = a.px(x, y); m += mm; s += ss; n++; }
    flags.push(!isCream(m / n, s / n));
  }
  return flags;
}

// Baris dianggap "foto" kalau sebagian besar pikselnya bukan krem (teks caption tidak lolos).
function rowFlagsFrac(a, x0, x1, y0, y1, frac = 0.6) {
  const flags = [];
  for (let y = y0; y <= y1; y++) {
    let k = 0, n = 0;
    for (let x = x0; x < x1; x += 2) { const [m, s] = a.px(x, y); if (!isCream(m, s)) k++; n++; }
    flags.push(k / n > frac);
  }
  return flags;
}

function colFlags(a, x0, x1, y0, y1) {
  const flags = [];
  for (let x = x0; x < x1; x++) {
    let m = 0, s = 0, n = 0;
    for (let y = y0; y <= y1; y += 2) { const [mm, ss] = a.px(x, y); m += mm; s += ss; n++; }
    flags.push(!isCream(m / n, s / n));
  }
  return flags;
}

/**
 * Deteksi baris scene.
 * @returns {{W,H,rows:[{y0,y1,photoY0,photoY1,shot1:{x0,x1}}]}}
 */
async function detect(file, sceneCount = 6) {
  const a = await analyze(file);
  const { W, H } = a;
  let flags = rowFlags(a, Math.round(W * 0.17), Math.round(W * 0.98));
  // Pita merah/gelap selebar gambar (header judul, footer rangkuman) bukan baris scene: jadikan pemisah
  // supaya tidak menyatu dengan baris foto pertama/terakhir.
  const x0r = Math.round(W * 0.17), x1r = Math.round(W * 0.98);
  flags = flags.map((f, y) => {
    if (!f) return f;
    let k = 0, n = 0;
    for (let x = x0r; x < x1r; x += 3) {
      const i = (y * W + x) * a.C;
      const r = a.data[i], g = a.data[i + 1], b = a.data[i + 2];
      if (r > g + 50 && r > b + 50) k++; n++;
    }
    return k / n < 0.55;
  });
  // Pita foto: blok konten tinggi (> 6% tinggi gambar). Gap kecil (<8px) disatukan.
  let bands = runs(flags, Math.round(H * 0.06), 7);
  // Buang header (mulai di paling atas).
  bands = bands.filter(b => b[0] > H * 0.025);
  if (bands.length < 1) throw new Error('Tidak menemukan baris scene di storyboard ini.');
  // Pita yang terlalu tinggi (menyatu dengan footer/caption) dipotong ke tinggi median.
  const hs = bands.slice(0, sceneCount).map(b => b[1] - b[0]).sort((x, y) => x - y);
  const medH = hs[Math.floor(hs.length / 2)] || Math.round(H * 0.1);
  bands = bands.map((b, i) => (i < sceneCount && b[1] - b[0] > medH * 1.35) ? [b[0], b[0] + medH] : b);
  const photoBands = bands.slice(0, sceneCount);
  const footer = bands[sceneCount];
  const pitches = [];
  for (let i = 1; i < photoBands.length; i++) pitches.push(photoBands[i][0] - photoBands[i - 1][0]);
  const pitch = pitches.length ? pitches.sort((x, y) => x - y)[Math.floor(pitches.length / 2)] : Math.round(H * 0.14);

  const rows = photoBands.map((b) => {
    // Foto shot 1: kolom konten pertama di kanan label (x > 15% lebar).
    const off = Math.round(W * 0.15);
    const cols = runs(colFlags(a, off, W, b[0], b[1]), Math.round(W * 0.08), 1);
    const c = cols[0] || [Math.round(W * 0.01), Math.round(W * 0.18)];
    const x0 = c[0] + off + 2, x1 = c[1] + off - 2;
    // Tinggi foto sebenarnya: pindai hanya di dalam kolom foto, cari pita konten pertama.
    const v = runs(rowFlagsFrac(a, x0 + 4, x1 - 4, b[0], Math.min(H - 1, b[0] + Math.round(pitch * 0.95))), Math.round(H * 0.04), 3);
    const p = v[0] ? [v[0][0] + b[0], v[0][1] + b[0]] : [b[0], b[1]];
    return { photoY0: p[0], photoY1: p[1], shot1: { x0, x1 } };
  });
  // Semua foto di satu storyboard tingginya seragam. Kalau caption ikut terbaca
  // sebagai foto, tingginya jadi lebih besar, jadi pakai persentil bawah.
  const hts = rows.map(r => r.photoY1 - r.photoY0).sort((x, y) => x - y);
  const photoH = hts[0];
  rows.forEach(r => { if (r.photoY1 - r.photoY0 > photoH * 1.04) r.photoY1 = r.photoY0 + photoH; });
  // Rapikan bawah foto: buang pita caption terang yang masih ikut.
  rows.forEach(r => {
    const lightRow = y => {
      let k = 0, n = 0;
      for (let x = r.shot1.x0 + 4; x < r.shot1.x1 - 4; x += 2) { const [m, sat] = a.px(x, y); if (m > 200 && sat < 60) k++; n++; }
      return k / n > 0.3;
    };
    let guard = 0;
    while (r.photoY1 - r.photoY0 > photoH * 0.6 && lightRow(r.photoY1) && guard++ < photoH) r.photoY1--;
  });
  // Batas baris: dari atas foto sampai sebelum foto baris berikutnya.
  const tails = [];
  rows.forEach((r, i) => {
    r.y0 = Math.max(0, r.photoY0 - 2);
    if (i + 1 < rows.length) { r.y1 = rows[i + 1].photoY0 - 12; tails.push(r.y1 - r.photoY1); }
  });
  const tail = tails.length ? tails.sort((x, y) => x - y)[Math.floor(tails.length / 2)] : Math.round(H * 0.04);
  const last = rows[rows.length - 1];
  // Baris terakhir: berhenti sebelum footer (baris yang sebagian besar berwarna gelap/merah).
  let stop = Math.min(H - 1, last.photoY1 + tail);
  const scan0 = last.photoY1 + Math.round(tail * 0.4);
  const below = rowFlagsFrac(a, Math.round(W * 0.02), Math.round(W * 0.98), scan0, stop, 0.5);
  const hit = below.indexOf(true);
  if (hit >= 0) stop = scan0 + hit - 4;
  last.y1 = stop;
  return { W, H, rows };
}

/**
 * Potong storyboard. outDir harus sudah ada.
 * Menghasilkan Scene_{n}.png (baris) dan Scene_{n}_foto1.png (shot 1).
 */
async function cropStoryboard(file, outDir, sceneCount = 6) {
  const { W, rows } = await detect(file, sceneCount);
  const rowScale = Math.max(1, 2048 / W);
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const n = i + 1;
    const rowFile = `${outDir}/Scene_${n}.png`;
    await sharp(file).extract({ left: 0, top: r.y0, width: W, height: r.y1 - r.y0 + 1 })
      .resize({ width: Math.round(W * rowScale), kernel: 'lanczos3' }).png().toFile(rowFile);
    const sw = r.shot1.x1 - r.shot1.x0 + 1, sh = r.photoY1 - r.photoY0 - 3;
    const photoFile = `${outDir}/Scene_${n}_foto1.png`;
    await sharp(file).extract({ left: r.shot1.x0, top: r.photoY0 + 2, width: sw, height: sh })
      .resize({ width: Math.max(640, sw * 4), kernel: 'lanczos3' }).png().toFile(photoFile);
    results.push({ n, rowFile, photoFile, box: r });
  }
  return results;
}

module.exports = { detect, cropStoryboard };
