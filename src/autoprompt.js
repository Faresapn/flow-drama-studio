// Auto-prompt: Claude Code CLI (`claude -p`) membaca gambar storyboard lalu mengisi
// tokoh serial (kalau masih kosong) dan isi tiap scene (setting, 5 shot, dialog, audio).
// Memakai login Claude Code di Mac ini, tanpa API key.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

// Model Claude: alias CLI (opus / sonnet / haiku) atau ID lengkap. Kosong = default Claude Code.
const MODELS = ['', 'opus', 'sonnet', 'haiku'];

function askClaude(promptText, cwd, timeoutMs = 300000, model = '') {
  return new Promise((resolve, reject) => {
    const args = ['-p', promptText, '--allowedTools', 'Read', '--output-format', 'json'];
    if (model) args.push('--model', model);
    const p = spawn(CLAUDE_BIN, args, { cwd, env: process.env });
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

// Gaya dialog yang bisa dipilih per serial.
const STYLES = {
  '': '',
  dramatis: 'Dialogue style: emotional and dramatic, sharp lines, clear conflict and tension.',
  santai: 'Dialogue style: relaxed, warm, everyday casual Indonesian, light and natural.',
  lucu: 'Dialogue style: funny and light, comic timing, gentle humour, no insults.',
  tegang: 'Dialogue style: tense and suspenseful, short lines, hints and secrets.',
  sedih: 'Dialogue style: sad and touching, soft lines that make viewers emotional.',
};

function styleLines(series) {
  const st = series.style || {};
  return [STYLES[st.dialog] || '', st.notes ? `Extra direction from the producer: ${String(st.notes).slice(0, 600)}` : ''].filter(Boolean).join('\n');
}

function buildInstruction(storyboardAbs, series, sceneCount) {
  const chars = (series.characters || []).map(c => `${c.key} | ${c.role} | ${c.look}`).join('\n');
  const style = styleLines(series);
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
- shot.speaker: key of the character who says the dialogue, or "" when there is no dialogue.
- setting: English, one sentence: place, time of day, lighting. If a shop/building sign with readable words is shown, quote it in UPPERCASE.
- characters: keys of the people who appear in that scene.
- audio: English, short: ambience + music mood (e.g. "morning kitchen ambience, soft sad piano").
- title: the scene title from the red label (keep original language).
- avoid: extra things to avoid for this scene (English, comma separated) or "".
${style ? style + '\n' : ''}
Reply with ONLY this JSON, no commentary:
{"episodeTitle":"...","characters":[{"key":"W","role":"The wife","look":"..."}],"scenes":[{"n":1,"title":"...","setting":"...","characters":["W"],"shots":[{"action":"...","dialogue":"...","speaker":"W"}],"audio":"...","avoid":""}]}
"characters" must list ALL characters (existing + new).`;
}

/** Isi serial + episode dari storyboard. Mengubah objek series & ep langsung. */
async function autoFill(series, ep, storyboardAbs, log = () => {}) {
  if (!fs.existsSync(storyboardAbs)) throw new Error('File storyboard tidak ada');
  log('Claude membaca storyboard dan menulis isi scene…');
  const text = await askClaude(buildInstruction(storyboardAbs, series, ep.scenes.length), path.dirname(storyboardAbs), 300000, (series.style || {}).model || '');
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
    const shots = (s.shots || []).slice(0, 5).map(x => ({ action: String(x.action || ''), dialogue: String(x.dialogue || ''), speaker: have.has(x.speaker) ? String(x.speaker) : '' }));
    while (shots.length < 5) shots.push({ action: '', dialogue: '', speaker: '' });
    sc.shots = shots;
    sc.audio = String(s.audio || '');
    sc.avoid = String(s.avoid || '');
    sc.customPrompt = '';
  }
  if (j.episodeTitle && /^Episode \d+$/.test(ep.title || '')) ep.title = String(j.episodeTitle).slice(0, 80);
  log(`Isi ${j.scenes.length} scene selesai ditulis Claude.`);
  return j;
}

/**
 * Judul, deskripsi, hashtag, dan pilihan thumbnail untuk episode jadi.
 * frames: path absolut kandidat thumbnail (jpg). Mengembalikan {title, description, hashtags, thumbnail}.
 */
async function episodeMeta(series, ep, frames, cwd) {
  const script = ep.scenes.map(sc => `Scene ${sc.n} (${sc.title}): ${sc.setting || ''}\n` +
    sc.shots.map((x, i) => `  ${i + 1}. ${x.action || ''}${x.dialogue ? ` — "${x.dialogue}"` : ''}`).join('\n')).join('\n');
  const instr = `You prepare a YouTube Shorts / TikTok upload for one episode of a short vertical Indonesian family drama.

Series: ${series.title}
Episode: ${ep.title}
Script:
${script}

Thumbnail candidates (read each image file):
${frames.map((f, i) => `${i}: ${f}`).join('\n')}

Write in natural Indonesian:
- title: catchy, max 70 characters, no clickbait lies, may use 1 emoji.
- description: 2-3 short sentences that tease the story without spoiling the ending, then a question to invite comments.
- hashtags: 5-8 relevant hashtags (with #), include #drama and #shorts.
- thumbnail: index of the most striking candidate (clear emotional face, not blurry, no storyboard collage, no text).

Reply with ONLY this JSON: {"title":"...","description":"...","hashtags":["#..."],"thumbnail":0}`;
  const j = extractJson(await askClaude(instr, cwd, 300000, (series.style || {}).model || ''));
  const idx = Number.isInteger(j.thumbnail) && j.thumbnail >= 0 && j.thumbnail < frames.length ? j.thumbnail : 0;
  return {
    title: String(j.title || '').slice(0, 100),
    description: String(j.description || '').slice(0, 2000),
    hashtags: (Array.isArray(j.hashtags) ? j.hashtags : []).map(String).filter(h => h.startsWith('#')).slice(0, 10),
    thumbnail: idx,
  };
}

/**
 * Usulan aturan perbaikan dari prompt yang pernah ditolak Flow.
 * failures: [{error, level, prompt}]. Mengembalikan {replacements:[[from,to]], riskyDialogueWords:[], notes}.
 */
async function suggestRules(failures, rules, cwd) {
  const list = failures.map((f, i) => `--- Failure ${i + 1} (level ${f.level}): ${f.error}\n${String(f.prompt).slice(0, 1800)}`).join('\n\n');
  const instr = `Google Flow (a video generator) rejected these prompts for a photorealistic Indonesian family drama, usually for content policy or audio generation reasons.

Current softening rules:
- replacements (English word/phrase -> safer wording): ${JSON.stringify(rules.replacements.slice(0, 120))}
- riskyDialogueWords (Indonesian dialogue that gets dropped at level 3): ${JSON.stringify(rules.riskyDialogueWords)}

Rejected prompts:
${list}

Find words or phrases in these prompts that most likely triggered the rejection and are NOT already covered by the current rules.
- replacements: pairs [from, to]. "from" is an exact lowercase English word or short phrase as it appears in prompts; "to" is a neutral wording that keeps the story meaning. Max 15.
- riskyDialogueWords: lowercase Indonesian words that make a dialogue line risky. Max 15.
- notes: one or two short sentences in Indonesian explaining the pattern you see.
Do not repeat existing rules. If nothing new is likely, return empty lists.

Reply with ONLY this JSON: {"replacements":[["from","to"]],"riskyDialogueWords":["..."],"notes":"..."}`;
  const j = extractJson(await askClaude(instr, cwd));
  const haveFrom = new Set(rules.replacements.map(r => String(r[0]).toLowerCase()));
  const haveRisky = new Set(rules.riskyDialogueWords.map(w => String(w).toLowerCase()));
  return {
    replacements: (j.replacements || []).filter(r => Array.isArray(r) && r[0] && typeof r[1] === 'string' && !haveFrom.has(String(r[0]).toLowerCase())).map(r => [String(r[0]).toLowerCase(), String(r[1])]).slice(0, 15),
    riskyDialogueWords: (j.riskyDialogueWords || []).map(w => String(w).toLowerCase().trim()).filter(w => w && !haveRisky.has(w)).slice(0, 15),
    notes: String(j.notes || ''),
  };
}

module.exports = { autoFill, askClaude, extractJson, episodeMeta, suggestRules, STYLES, MODELS };
