// Subtitle dari dialog per shot: file .srt di samping video, dan (opsional) gambar
// teks PNG untuk ditempel ke video (ffmpeg Homebrew tidak punya filter subtitles/drawtext).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const srtTime = t => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/**
 * Hitung waktu subtitle di episode jadi.
 * scenes: scene urut; segs: hasil merge [{trimStart, length}].
 * Mengembalikan [{start, end, text}].
 */
function cues(scenes, segs) {
  const out = [];
  let offset = 0;
  scenes.forEach((sc, i) => {
    const seg = segs[i]; if (!seg) return;
    const per = 10 / Math.max(1, sc.shots.length);
    sc.shots.forEach((s, k) => {
      const text = String(s.dialogue || '').trim();
      if (!text) return;
      const a = Math.max(0, k * per - seg.trimStart), b = Math.min(seg.length, (k + 1) * per - seg.trimStart - 0.1);
      if (b - a < 0.4) return;
      out.push({ start: offset + a, end: offset + b, text });
    });
    offset += seg.length;
  });
  return out;
}

function toSrt(list) {
  return list.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

const escXml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function wrap(text, max = 24) {
  const words = text.split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Gambar PNG transparan 1080 lebar berisi teks putih bergaris hitam. */
async function renderPng(text, file, fontSize = 64) {
  const lines = wrap(text);
  const lh = Math.round(fontSize * 1.25), H = lh * lines.length + 40;
  const tspans = lines.map((l, i) => `<tspan x="540" y="${30 + fontSize + i * lh}">${escXml(l)}</tspan>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${H}">
    <text text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-weight="800" font-size="${fontSize}"
      fill="#ffffff" stroke="#000000" stroke-width="${Math.round(fontSize / 8)}" paint-order="stroke" stroke-linejoin="round">${tspans}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return { file, height: H };
}

/** Siapkan PNG untuk tiap cue. Mengembalikan [{file, start, end, height}]. */
async function renderAll(list, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const r = await renderPng(list[i].text, path.join(dir, `sub_${i + 1}.png`));
    out.push({ ...list[i], ...r });
  }
  return out;
}

module.exports = { cues, toSrt, renderAll, srtTime };
