// Notifikasi: pop-up macOS (selalu, kecuali NOTIFY_MAC=0) dan Telegram (kalau
// TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID diisi). Gagal kirim tidak menghentikan proses.
const { execFile } = require('child_process');

const asText = s => String(s || '').replace(/\s+/g, ' ').trim();
// String AppleScript: cukup escape backslash dan tanda kutip.
const appleStr = s => '"' + asText(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function notify(title, body, photo = null) {
  if (process.platform === 'darwin' && process.env.NOTIFY_MAC !== '0') {
    const script = `display notification ${appleStr(body)} with title ${appleStr(title)} sound name "Glass"`;
    execFile('osascript', ['-e', script], () => {});
  }
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat && photo && typeof fetch === 'function') {
    try {
      const fd = new FormData();
      fd.append('chat_id', chat);
      fd.append('caption', `${asText(title)}\n${asText(body)}`.slice(0, 1000));
      fd.append('photo', new Blob([require('fs').readFileSync(photo)]), 'screenshot.png');
      fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd }).catch(() => {});
      return;
    } catch { /* jatuh ke pesan teks biasa */ }
  }
  if (token && chat && typeof fetch === 'function') {
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `${asText(title)}\n${asText(body)}` }),
    }).catch(() => {});
  }
}

module.exports = { notify };
