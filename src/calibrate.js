// Alat kalibrasi: buka Google Flow di browser otomasi, login sekali,
// lalu cetak daftar tombol/kolom yang terlihat supaya selector di config/flow.json bisa disesuaikan.
// Jalankan: npm run calibrate
const readline = require('readline');
const runner = require('./runner');

(async () => {
  console.log('Membuka Google Flow… Login dengan akun Google kamu kalau diminta (cukup sekali).');
  const page = await runner.openFlow();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(r => rl.question(q, r));
  for (;;) {
    const a = await ask('\nBuka layar Flow yang mau dipetakan (mis. form Frames to Video), lalu tekan Enter. Ketik "q" untuk keluar: ');
    if (a.trim().toLowerCase() === 'q') break;
    const items = await page.evaluate(() => {
      const out = [];
      const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      document.querySelectorAll('button, [role="button"], [role="option"], textarea, [contenteditable="true"], input').forEach(el => {
        if (!vis(el) && el.type !== 'file') return;
        out.push({
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          text: (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 50),
          aria: el.getAttribute('aria-label') || '',
          placeholder: el.getAttribute('placeholder') || '',
        });
      });
      return out;
    });
    console.table(items);
    console.log('Salin teks/aria-label tombol yang benar ke config/flow.json (bagian "steps"). Contoh selector:');
    console.log(`  button:has-text('Teks Tombol')   atau   button[aria-label='Label']   atau   textarea`);
  }
  rl.close();
  await runner.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
