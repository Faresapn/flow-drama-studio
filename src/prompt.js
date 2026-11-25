// Menyusun prompt video per scene dan menerapkan tangga perbaikan
// (aturan dari pengalaman serial Suami Kurir, Anak yang Dibuang, Suami Pelit).
const fs = require('fs');
const path = require('path');

const RULES_FILE = path.join(__dirname, '..', 'config', 'fix-rules.json');
const loadRules = () => JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));

const BASE_AVOID = 'text on screen, captions, subtitles, storyboard layout, split screen, cartoon, anime, distorted faces, deformed hands, extra fingers, faces changing between shots, changing outfits, extra people, brand logos, watermark, blurry, morphing, flickering, English speech';

function charLines(series, keys) {
  const chars = (series && series.characters) || [];
  const pick = keys && keys.length ? chars.filter(c => keys.includes(c.key)) : chars;
  return pick.map(c => `- ${c.role}: ${c.look}`).join('\n');
}

function shotLines(scene, { withDialogue = true, dropRisky = false, rules } = {}) {
  const per = 10 / scene.shots.length;
  const fmt = t => `00:${String(Math.round(t)).padStart(2, '0')}`;
  const dropped = [];
  const lines = scene.shots.map((s, i) => {
    let line = `[${fmt(i * per)}–${fmt((i + 1) * per)}] Shot ${i + 1}: ${s.action || 'follow the storyboard photo'}`;
    let d = (s.dialogue || '').trim();
    if (d && dropRisky && rules && isRisky(d, rules)) { dropped.push({ shot: i + 1, line: d }); d = ''; }
    if (d && !withDialogue) { dropped.push({ shot: i + 1, line: d }); d = ''; }
    line += d ? `: "${d}"` : '. No dialogue.';
    return line;
  });
  return { text: lines.join('\n'), dropped };
}

function isRisky(text, rules) {
  const t = text.toLowerCase();
  return rules.riskyDialogueWords.some(w => t.includes(w.toLowerCase()));
}

function soften(text, rules) {
  let out = text;
  for (const [from, to] of rules.replacements) {
    out = out.replace(new RegExp(`(?<![\\w])${from}(?![\\w])`, 'gi'), m => (/^[A-Z][a-z]/.test(m) && to ? to[0].toUpperCase() + to.slice(1) : to));
  }
  return out;
}

function cleanAvoid(avoid, rules) {
  return avoid.split(',').map(s => s.trim()).filter(s => s && !rules.avoidBlacklist.some(b => s.toLowerCase() === b)).join(', ');
}

/**
 * Bangun prompt untuk satu scene pada level perbaikan tertentu.
 * @returns {{prompt, frame:'row'|'single', needsVO:[], level, levelName}}
 */
function build(series, episode, scene, level = 0) {
  const rules = loadRules();
  const L = Math.min(level, rules.ladder.length - 1);
  const levelName = rules.ladder[L].name;
  const n = scene.n;
  const hasSign = /\b[A-Z]{3,}(?: [A-Z]{3,})+\b/.test(scene.setting || '');

  // Prompt custom dari pengguna dipakai apa adanya pada level 0, lalu ikut dihaluskan.
  if (scene.customPrompt && scene.customPrompt.trim()) {
    let p = scene.customPrompt.trim();
    if (series && series.characterSheet && !/character sheet/i.test(p)) p += '\n\nThe second reference image is the CHARACTER SHEET: keep every character\'s face and outfit identical to it. Never show the sheet itself. Generate with generate_video_with_references (both images as references).';
    if (L >= 1) p = soften(p, rules);
    return { prompt: p, frame: L >= 2 ? 'single' : 'row', needsVO: [], level: L, levelName };
  }

  const hasSheet = !!(series && series.characterSheet);
  const head = hasSheet
    ? 'Model: Google Omni Flow 1.2. Generate with generate_video_with_references. Aspect ratio: 9:16 vertical. Duration: 10 seconds. Use BOTH attached images as reference images (not as a literal first frame): image 1 is the storyboard of this scene (shot plan), image 2 is the CHARACTER SHEET. Copy every character\'s face, age, hair or hijab and outfit exactly from the character sheet, in every shot. Never show the character sheet or its name labels in the video.'
    : 'Model: Google Omni Flow 1.2. Aspect ratio: 9:16 vertical. Duration: 10 seconds. Use the start frame provided.';
  const speechBubble = scene.shots.some(s => /bubble|gelembung/i.test(s.action || '')) || n === episode.scenes.length;
  const noText = hasSign ? 'Never write any names or words on screen except the shop or building sign.' : 'Never write any names or words on screen.';

  const storyboardBlock = `STORYBOARD INSTRUCTION: ${hasSheet ? 'Image 1' : 'The start frame'} is a storyboard strip with a red "SCENE ${n}" label box on the left and 5 numbered photos with captions, read from left to right. Treat it only as the shot plan. Immediately cut to shot 1 as a single full-frame 9:16 image. Recreate each of the 5 photos in order as one 2-second shot, copying its framing, camera angle, people, faces, outfits and lighting. No extra wide shots and no extra people.${speechBubble ? ' Do not show any speech bubble; speak that line as dialogue instead.' : ''} Never show the storyboard layout, label box, captions, numbers, borders or split screens ${hasSheet ? 'at any time' : 'after the first frame'}. ${noText}`;

  const withDialogue = L < 4;
  const dropRisky = L >= 3;
  const { text: shots, dropped } = shotLines(scene, { withDialogue, dropRisky, rules });

  const setting = `SETTING: ${scene.setting || 'see the storyboard photos'} Hard cuts every 2 seconds.`;
  const chars = `CHARACTERS (identical in every shot):\n${charLines(series, scene.characters)}`;
  const audio = withDialogue
    ? `AUDIO: ${scene.audio || 'natural ambience, soft emotional music'}. Natural Indonesian voices, lip-synced.`
    : `AUDIO: ${(scene.audio || 'natural ambience').replace(/\.?\s*[A-Z][a-z-]+(?: [a-z-]+)*: [^.]*voice[^.]*\.?/g, '')}. Soft emotional music. No speech.`;

  let prompt;
  if (L >= 2) {
    // Foto tunggal: tanpa instruksi storyboard, ringkas.
    const st = (scene.setting || '').trim();
    prompt = [head, `${st.charAt(0).toUpperCase() + st.slice(1)} Cinematic photorealistic Indonesian family drama. The same people from the ${hasSheet ? 'character sheet' : 'start frame'}, same faces and outfits in every shot. Hard cuts every 2 seconds. ${noText}`,
      chars, `SHOTS:\n${shots}`, audio, rules.shortAvoid].join('\n\n');
  } else {
    const extraAvoid = (scene.avoid || '').trim();
    let avoid = `Avoid: ${extraAvoid ? extraAvoid + ', ' : ''}${BASE_AVOID}.`;
    prompt = [head, storyboardBlock, setting, chars, `SHOTS (follow the photos 1–5):\n${shots}`, audio, avoid].join('\n\n');
  }

  if (L >= 1) {
    // Haluskan isi prompt, tapi bersihkan daftar Avoid terpisah (jangan dihaluskan).
    const m = prompt.match(/\n\nAvoid: ([^\n]*)$/);
    const body = m ? prompt.slice(0, m.index) : prompt;
    const avoid = m ? '\n\nAvoid: ' + cleanAvoid(m[1].replace(/\.$/, ''), rules) + '.' : '';
    prompt = soften(body, rules) + avoid;
  }

  return { prompt, frame: L >= 2 ? 'single' : 'row', needsVO: dropped, level: L, levelName };
}

/** Level berikutnya setelah sebuah kegagalan. */
function nextLevel(current, failKind) {
  const rules = loadRules();
  const max = rules.ladder.length - 1;
  if (failKind === 'audio') return Math.min(max, Math.max(current + 1, rules.audioFailJumpTo));
  return Math.min(max, current + 1);
}

module.exports = { build, nextLevel, loadRules, soften, isRisky };
