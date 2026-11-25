// Menggabungkan klip scene jadi satu episode (cara yang sama dengan penggabungan manual
// selama ini): buang frame kolase storyboard di awal tiap klip, samakan ke 1080x1920 24fps,
// fade audio pendek di sambungan, loudnorm -14 LUFS, H.264 CRF 18.
const { spawn } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(err.slice(-800)))));
  });
}

async function duration(file) {
  const o = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return parseFloat(o);
}

// Deteksi frame kolase di awal klip: frame yang punya pita krem lebar (latar storyboard).
async function collageLead(file) {
  const W = 90, H = 160, N = 12;
  const raw = await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', String(N), '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const chunks = [];
    p.stdout.on('data', d => chunks.push(d));
    p.on('close', c => (c === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('ffmpeg gagal membaca frame'))));
  });
  const fsz = W * H * 3;
  let lastCollage = -1;
  for (let f = 0; f < raw.length / fsz; f++) {
    let cream = 0;
    for (let i = 0; i < W * H; i++) {
      const o = f * fsz + i * 3, r = raw[o], g = raw[o + 1], b = raw[o + 2];
      const m = (r + g + b) / 3, s = Math.max(r, g, b) - Math.min(r, g, b);
      if (m > 225 && s < 45 && r >= b) cream++;
      if (r > 150 && g < 70 && b < 70) cream += 0.5; // label merah storyboard
    }
    if (cream / (W * H) > 0.12) lastCollage = f;
  }
  // Frame pertama sering transisi; selalu buang minimal 1 frame (0,042 detik).
  return Math.max(1, lastCollage + 1) / 24;
}

/**
 * clips: [{file, trimStart?, trimEnd?, vo?: [{file, at}]}] urut. out: file mp4 tujuan.
 * opts.overlays(segs) -> [{file, start, end, height}] gambar teks (subtitle) yang ditempel.
 */
async function mergeEpisode(clips, out, opts = {}) {
  const fc = [], inputs = [];
  const segs = [];
  // Lewat 1: ukur durasi dan potongan tiap klip.
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const dur = await duration(c.file);
    const t0 = c.trimStart != null ? c.trimStart : await collageLead(c.file);
    const t1 = c.trimEnd != null ? Math.min(c.trimEnd, dur) : dur;
    if (t1 - t0 < 0.3) throw new Error(`Scene ${i + 1}: potongan terlalu pendek (${t0.toFixed(2)}–${t1.toFixed(2)} detik)`);
    segs.push({ scene: i + 1, trimStart: +t0.toFixed(3), length: +(t1 - t0).toFixed(2), t0, t1 });
  }
  clips.forEach(c => inputs.push('-i', c.file));
  let next = clips.length;
  for (let i = 0; i < clips.length; i++) {
    const { t0, t1 } = segs[i], d = t1 - t0;
    fc.push(`[${i}:v]trim=${t0.toFixed(3)}:${t1.toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,fps=24,format=yuv420p[v${i}]`);
    const vo = (clips[i].vo || []).filter(v => v.at - t0 < d - 0.3);
    const base = `[${i}:a]atrim=${t0.toFixed(3)}:${t1.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo`;
    if (!vo.length) {
      fc.push(`${base},afade=t=in:d=0.02,afade=t=out:st=${(d - 0.03).toFixed(3)}:d=0.03[a${i}]`);
    } else {
      // VO ditaruh sesuai waktu shot, suara klip diturunkan sedikit supaya VO jelas.
      fc.push(`${base},volume=0.7[ab${i}]`);
      const labels = [`[ab${i}]`];
      vo.forEach((v, k) => {
        inputs.push('-i', v.file);
        const ms = Math.max(0, Math.round((v.at - t0) * 1000));
        fc.push(`[${next}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[vo${i}_${k}]`);
        labels.push(`[vo${i}_${k}]`); next++;
      });
      fc.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first,atrim=0:${d.toFixed(3)},afade=t=in:d=0.02,afade=t=out:st=${(d - 0.03).toFixed(3)}:d=0.03[a${i}]`);
    }
  }
  fc.push(clips.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${clips.length}:v=1:a=1[vc][ac]`);
  fc.push('[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[ao]');
  // Subtitle tempel: overlay gambar teks bergantian sesuai waktunya.
  const overlays = opts.overlays ? await opts.overlays(segs.map(({ scene, trimStart, length }) => ({ scene, trimStart, length }))) : [];
  let vLabel = '[vc]';
  overlays.forEach((o, k) => {
    inputs.push('-i', o.file);
    const y = Math.max(0, 1920 - 430 - o.height);
    fc.push(`${vLabel}[${next}:v]overlay=0:${y}:enable='between(t,${o.start.toFixed(3)},${o.end.toFixed(3)})'[ov${k}]`);
    vLabel = `[ov${k}]`; next++;
  });
  await run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', fc.join(';'),
    '-map', vLabel, '-map', '[ao]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
  return { out, segs: segs.map(({ scene, trimStart, length }) => ({ scene, trimStart, length })), total: +(await duration(out)).toFixed(2) };
}

/** Ambil satu frame (jpg) pada detik tertentu. */
async function frameAt(file, t, out) {
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-q:v', '3', out]);
  return out;
}

module.exports = { mergeEpisode, collageLead, duration, frameAt };
