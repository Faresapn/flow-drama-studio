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
 * clips: [{file, trimStart?, trimEnd?}] urut. out: file mp4 tujuan.
 */
async function mergeEpisode(clips, out) {
  const fc = [], inputs = [];
  const segs = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    inputs.push('-i', c.file);
    const dur = await duration(c.file);
    const t0 = c.trimStart != null ? c.trimStart : await collageLead(c.file);
    const t1 = c.trimEnd != null ? c.trimEnd : dur;
    const d = t1 - t0;
    fc.push(`[${i}:v]trim=${t0.toFixed(3)}:${t1.toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,fps=24,format=yuv420p[v${i}]`);
    fc.push(`[${i}:a]atrim=${t0.toFixed(3)}:${t1.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=0.02,afade=t=out:st=${(d - 0.03).toFixed(3)}:d=0.03[a${i}]`);
    segs.push({ scene: i + 1, trimStart: +t0.toFixed(3), length: +d.toFixed(2) });
  }
  fc.push(clips.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${clips.length}:v=1:a=1[vc][ac]`);
  fc.push('[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[ao]');
  await run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', fc.join(';'),
    '-map', '[vc]', '-map', '[ao]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
  return { out, segs, total: +(await duration(out)).toFixed(2) };
}

module.exports = { mergeEpisode, collageLead, duration };
