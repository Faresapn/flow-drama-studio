// Auto-prompt: Claude Code CLI (`claude -p`) membaca gambar storyboard lalu mengisi
// tokoh serial (kalau masih kosong) dan isi tiap scene (setting, 5 shot, dialog, audio).
// Memakai login Claude Code di Mac ini, tanpa API key.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

function askClaude(promptText, cwd, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const p = spawn(CLAUDE_BIN, ['-p', promptText, '--allowedTools', 'Read', '--output-format', 'json'], { cwd, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('Claude CLI tidak menjawab dalam 5 menit')); }, timeoutMs);
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', e => { clearTimeout(timer); reject(new Error(`Claude CLI tidak bisa dijalankan (${e.message}). Pastikan perintah "claude" terpasang dan sudah login.`)); });
    p.on('close', code => {
      clearTimeout(timer);
      let res;
      try { res = JSON.parse(out); } catch { return reject(new Error(`Jawaban Claude CLI tidak terbaca (kode ${code}): ${(err || out).slice(-300)}`)); }
      if (res.is_error) return reject(new Error(`Claude CLI error: ${String(res.result || res.subtype).slice(0, 300)}`));
      resolve(String(res.result || ''));
    });
  });
}

function extractJson(text) {
  const t = text.replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Claude tidak mengembalikan JSON');
  return JSON.parse(t.slice(a, b + 1));
}

function buildInstruction(storyboardAbs, series, sceneCount) {
  const chars = (series.characters || []).map(c => `${c.key} | ${c.role} | ${c.look}`).join('\n');
  return `You write shot plans for a short vertical AI drama made in Google Flow (Indonesian family drama, photorealistic).

Read the storyboard image at: ${storyboardAbs}
It has ${sceneCount} scene rows. Each row: a red "SCENE n" label box (with time and scene title) on the left, then 5 numbered photos with short captions, read left to right.

Series title: ${series.title || '(none)'}
${chars ? `Existing characters (key | role | look). Reuse these keys; add new ones only for people not covered:\n${chars}` : 'No characters defined yet: create them from the people in the storyboard.'}

Rules:
- Characters: key = 1-2 uppercase letters; role = English role WITHOUT personal names (e.g. "The wife", "The little daughter"); look = English, concrete and stable: ethnicity, age, hair/hijab colour, outfit (e.g. "Indonesian woman, 30, pink hijab, floral home dress"). Names must never appear in role or look.
- For every scene, write exactly 5 shots matching photos 1-5 in order.
- shot.action: English, one short sentence describing what is visible in that photo (who, action, framing). Use roles, never names.
- shot.dialogue: natural spoken Indonesian (casual, everyday), max 8 words, fits 2 seconds. Use "" when nobody should speak. Usually 2-4 shots per scene have dialogue. Names may appear inside dialogue.
- setting: English, one sentence: place, time of day, lighting. If a shop/building sign with readable words is shown, quote it in UPPERCASE.
- characters: keys of the people who appear in that scene.
- audio: English, short: ambience + music mood (e.g. "morning kitchen ambience, soft sad piano").
- title: the scene title from the red label (keep original language).
- avoid: extra things to avoid for this scene (English, comma separated) or "".

Reply with ONLY this JSON, no commentary:
{"episodeTitle":"...","characters":[{"key":"W","role":"The wife","look":"..."}],"scenes":[{"n":1,"title":"...","setting":"...","characters":["W"],"shots":[{"action":"...","dialogue":"..."}],"audio":"...","avoid":""}]}
"characters" must list ALL characters (existing + new).`;
}

/** Isi serial + episode dari storyboard. Mengubah objek series & ep langsung. */
async function autoFill(series, ep, storyboardAbs, log = () => {}) {
  if (!fs.existsSync(storyboardAbs)) throw new Error('File storyboard tidak ada');
  log('Claude membaca storyboard dan menulis isi scene…');
  const text = await askClaude(buildInstruction(storyboardAbs, series, ep.scenes.length), path.dirname(storyboardAbs));
  const j = extractJson(text);
  if (!Array.isArray(j.scenes) || !j.scenes.length) throw new Error('Claude tidak menghasilkan scene');

  // Tokoh: pertahankan yang sudah ada, tambah yang baru.
  const have = new Map((series.characters || []).map(c => [c.key, c]));
  for (const c of j.characters || []) {
    if (!c || !c.key || !c.role) continue;
    if (!have.has(c.key)) have.set(c.key, { key: String(c.key).trim(), role: String(c.role).trim(), look: String(c.look || '').trim() });
  }
  series.characters = [...have.values()];

  for (const s of j.scenes) {
    const sc = ep.scenes.find(x => x.n === Number(s.n));
    if (!sc) continue;
    if (s.title) sc.title = String(s.title);
    sc.setting = String(s.setting || '');
    sc.characters = (s.characters || []).filter(k => have.has(k));
    const shots = (s.shots || []).slice(0, 5).map(x => ({ action: String(x.action || ''), dialogue: String(x.dialogue || '') }));
    while (shots.length < 5) shots.push({ action: '', dialogue: '' });
    sc.shots = shots;
    sc.audio = String(s.audio || '');
    sc.avoid = String(s.avoid || '');
    sc.customPrompt = '';
  }
  if (j.episodeTitle && /^Episode \d+$/.test(ep.title || '')) ep.title = String(j.episodeTitle).slice(0, 80);
  log(`Isi ${j.scenes.length} scene selesai ditulis Claude.`);
  return j;
}

module.exports = { autoFill, askClaude, extractJson };
