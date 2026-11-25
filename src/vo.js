// VO (voice over) untuk dialog yang dibuang di tangga perbaikan tingkat 3-4.
// Memakai ElevenLabs Text-to-Speech. Butuh ELEVENLABS_API_KEY.
// Suara: per tokoh (series.voices[key]) -> suara default serial -> ELEVENLABS_VOICE_ID.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = 'https://api.elevenlabs.io/v1/text-to-speech';
const MODEL = () => process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

const enabled = () => !!process.env.ELEVENLABS_API_KEY;

function voiceFor(series, speaker) {
  const v = (series && series.voices) || {};
  return (speaker && v[speaker]) || (series && series.defaultVoice) || process.env.ELEVENLABS_VOICE_ID || '';
}

/** Buat (atau ambil dari cache) file mp3 untuk satu kalimat. */
async function speak(text, voiceId, outDir) {
  if (!enabled()) throw new Error('ELEVENLABS_API_KEY belum diisi');
  if (!voiceId) throw new Error('Voice ID ElevenLabs belum diatur (isi di pengaturan serial atau ELEVENLABS_VOICE_ID)');
  const key = crypto.createHash('md5').update(`${voiceId}|${MODEL()}|${text}`).digest('hex').slice(0, 12);
  const file = path.join(outDir, `vo_${key}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  const res = await fetch(`${API}/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL() }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * Siapkan VO satu scene. Mengembalikan [{file, at}] (detik dari awal klip asli).
 * Dialog diambil dari scene.needsVO (yang dibuang dari prompt), waktunya mengikuti nomor shot.
 */
async function sceneVO(series, scene, outDir, log = () => {}) {
  const lines = scene.needsVO || [];
  if (!lines.length) return [];
  if (!enabled()) { log(`Scene ${scene.n}: ${lines.length} dialog perlu VO, tapi ELEVENLABS_API_KEY belum diisi. Dilewati.`); return []; }
  const per = 10 / Math.max(1, scene.shots.length);
  const out = [];
  for (const v of lines) {
    const shot = scene.shots[v.shot - 1] || {};
    try {
      const file = await speak(v.line, voiceFor(series, shot.speaker), outDir);
      out.push({ file, at: (v.shot - 1) * per + 0.15 });
    } catch (e) { log(`Scene ${scene.n} shot ${v.shot}: VO gagal (${e.message})`); }
  }
  if (out.length) log(`Scene ${scene.n}: ${out.length} VO siap.`);
  return out;
}

module.exports = { sceneVO, speak, voiceFor, enabled };
