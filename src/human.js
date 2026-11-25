// Perilaku "seperti manusia" untuk Playwright: gerak mouse melengkung,
// jeda acak, mengetik per huruf dengan ritme dan sesekali salah ketik.
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.round(rand(a, b));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick = ([a, b]) => rand(a, b);

const NEIGHBORS = 'qwertyuiopasdfghjklzxcvbnm';

class Human {
  constructor(page, cfg) {
    this.page = page;
    this.cfg = cfg;
    this.x = randInt(200, 700);
    this.y = randInt(150, 450);
  }

  async pause(range = this.cfg.actionPauseMs) { await sleep(pick(range)); }

  // Gerak mouse dengan kurva Bezier + sedikit getaran, bukan teleport.
  async moveTo(tx, ty) {
    const steps = randInt(...this.cfg.mouseSteps);
    const sx = this.x, sy = this.y;
    const cx = sx + (tx - sx) * rand(0.2, 0.8) + rand(-120, 120);
    const cy = sy + (ty - sy) * rand(0.2, 0.8) + rand(-90, 90);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
      const x = (1 - e) ** 2 * sx + 2 * (1 - e) * e * cx + e ** 2 * tx + rand(-0.8, 0.8);
      const y = (1 - e) ** 2 * sy + 2 * (1 - e) * e * cy + e ** 2 * ty + rand(-0.8, 0.8);
      await this.page.mouse.move(x, y);
      await sleep(rand(6, 18));
    }
    this.x = tx; this.y = ty;
  }

  async wander() {
    if (Math.random() > this.cfg.idleWanderChance) return;
    const vp = this.page.viewportSize() || { width: 1280, height: 800 };
    await this.moveTo(rand(vp.width * 0.2, vp.width * 0.8), rand(vp.height * 0.2, vp.height * 0.8));
    await sleep(rand(300, 900));
  }

  async scrollIntoView(locator) {
    try { await locator.scrollIntoViewIfNeeded({ timeout: 5000 }); } catch {}
  }

  // Klik elemen: arahkan mouse ke titik acak di dalam kotaknya, berhenti sebentar, lalu klik.
  async click(locator) {
    await this.scrollIntoView(locator);
    const box = await locator.boundingBox();
    if (!box) { await locator.click(); return; }
    const tx = box.x + box.width * rand(0.3, 0.7);
    const ty = box.y + box.height * rand(0.3, 0.7);
    await this.moveTo(tx, ty);
    await sleep(rand(120, 380));
    await this.page.mouse.down();
    await sleep(rand(40, 120));
    await this.page.mouse.up();
    await this.pause();
  }

  // Mengetik seperti orang: jeda per huruf, jeda lebih lama setelah tanda baca,
  // sesekali berhenti "berpikir", sesekali salah ketik lalu dihapus.
  async type(locator, text, { clear = true } = {}) {
    await this.click(locator);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    if (clear) {
      await this.page.keyboard.press(`${mod}+A`);
      await sleep(rand(120, 300));
      await this.page.keyboard.press('Backspace');
      await sleep(rand(250, 600));
    }
    const c = this.cfg;
    // Mode "mixed": bagian awal diketik huruf per huruf, sisanya ditempel per kalimat
    // (prompt panjang ±2.000 karakter kalau diketik semua bisa makan 3–4 menit).
    const typedPart = c.typingMode === 'mixed' ? text.slice(0, c.mixedTypeFirstChars) : text;
    const restPart = c.typingMode === 'mixed' ? text.slice(c.mixedTypeFirstChars) : '';

    for (const ch of typedPart) {
      if (ch === '\n') { await this.page.keyboard.press('Shift+Enter'); await sleep(pick(c.pauseAfterPunctuationMs)); continue; }
      if (/[a-z]/i.test(ch) && Math.random() < c.typoChance) {
        const wrong = NEIGHBORS[randInt(0, NEIGHBORS.length - 1)];
        await this.page.keyboard.type(wrong);
        await sleep(rand(150, 400));
        await this.page.keyboard.press('Backspace');
        await sleep(rand(80, 200));
      }
      await this.page.keyboard.type(ch);
      let d = pick(c.charDelayMs);
      if ('.,!?:;'.includes(ch)) d += pick(c.pauseAfterPunctuationMs);
      if (Math.random() < c.thinkingPauseChance) d += pick(c.thinkingPauseMs);
      await sleep(d);
    }
    if (restPart) {
      const chunks = restPart.split(/(?<=[.\n])/);
      for (const chunk of chunks) {
        if (!chunk) continue;
        const lines = chunk.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]) await this.page.keyboard.insertText(lines[i]);
          if (i < lines.length - 1) await this.page.keyboard.press('Shift+Enter');
        }
        await sleep(rand(250, 900));
      }
    }
    await this.pause();
  }
}

module.exports = { Human, sleep, rand, randInt };
