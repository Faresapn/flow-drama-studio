// Membuat storyboard contoh buatan (tanpa foto asli) untuk uji crop:
// latar krem, header merah, 6 baris scene (label merah + 5 foto berwarna + caption), footer gelap.
const sharp = require('sharp');

async function makeSample(file) {
  const W = 1600, H = 2400, rowH = 340, top = 160, photoW = 250, photoH = 250;
  const parts = [`<rect width="${W}" height="${H}" fill="#F5F0E1"/>`, `<rect x="0" y="0" width="${W}" height="110" fill="#B3261E"/>`];
  const colors = ['#5B7A99', '#8E6C5A', '#6F8F6A', '#9A5C74', '#4F6D7A'];
  for (let r = 0; r < 6; r++) {
    const y = top + r * rowH;
    parts.push(`<rect x="30" y="${y}" width="220" height="120" fill="#C62828"/>`);
    for (let k = 0; k < 5; k++) {
      const x = 290 + k * (photoW + 12);
      parts.push(`<rect x="${x}" y="${y}" width="${photoW}" height="${photoH}" fill="${colors[(r + k) % 5]}"/>`);
      parts.push(`<rect x="${x + 20}" y="${y + photoH + 14}" width="${photoW - 40}" height="10" fill="#6B6B6B"/>`);
    }
  }
  parts.push(`<rect x="0" y="${H - 170}" width="${W}" height="170" fill="#2B2B2B"/>`);
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`)).png().toFile(file);
  return file;
}

module.exports = { makeSample };
if (require.main === module) makeSample(process.argv[2] || 'sample-storyboard.png').then(f => console.log('dibuat:', f));
