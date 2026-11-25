# Flow Drama Studio

Dashboard lokal untuk produksi drama AI pendek: crop storyboard per scene, susun prompt per scene, kirim otomatis ke Google Flow lewat Playwright (mengetik seperti manusia), perbaiki prompt sendiri kalau gagal, lalu gabungkan klip jadi satu episode.

## Pasang (sekali saja, di Mac mini)

Butuh Node.js 18+ dan ffmpeg.

```bash
brew install node ffmpeg        # kalau belum ada
cd flow-drama-studio
npm install
npx playwright install chromium # cadangan; defaultnya pakai Google Chrome yang terpasang
npm start
```

Buka http://localhost:4777.

## Login Google (sekali)

Klik **Buka Google Flow (login)** di dashboard. Jendela Chrome khusus akan terbuka. Login ke akun Google kamu di situ. Sesi login disimpan di folder `browser-profile/`, jadi berikutnya tidak perlu login lagi. Jangan tutup jendela itu saat antrean berjalan.

## Kalibrasi tombol Flow (wajib sekali)

Tampilan Google Flow bisa berubah, dan selector di `config/flow.json` masih tebakan. Jalankan:

```bash
npm run calibrate
```

Chrome terbuka ke Flow. Masuk ke project, buka mode Frames to Video, lalu tekan Enter di terminal. Script mencetak daftar tombol, input, dan kolom teks yang terlihat (teks, aria-label, placeholder). Cocokkan dengan langkah di `config/flow.json` → `steps`:

| Langkah | Yang dicari |
|---|---|
| `waitFor` | kolom prompt (textarea / contenteditable) |
| `click` Frames to Video | tombol mode start frame |
| `upload` | `input[type=file]` untuk start frame |
| `click` Crop and Save | tombol konfirmasi crop (opsional) |
| `type` | kolom prompt |
| `click` Generate | tombol kirim / panah |

Langkah bertanda `"optional": true` dilewati kalau elemennya tidak ada. Teks gagal Flow ada di `result.failTexts` dan `result.audioFailTexts`; tambahkan kalau muncul pesan baru.

## Alur kerja (otomatis)

1. **Serial baru** → isi judul, pilih **sheet tokoh** (gambar semua tokoh) dan gambar storyboard episode pertama. Tokoh boleh dikosongkan.
2. Setelah storyboard diunggah, semuanya jalan sendiri:
   - project Google Flow baru dibuat untuk episode ini ("Serial – Episode"), jadi video antar-episode tidak tercampur,
   - storyboard dipotong jadi 6 baris scene,
   - Claude (perintah `claude` CLI di Mac ini, pakai login Claude Code) membaca storyboard lalu menulis tokoh, setting, 5 shot, dialog, dan audio tiap scene,
   - tiap scene: sesi agen baru di Flow → 2 gambar referensi dilampirkan (baris scene + sheet tokoh, lewat "Tambahkan ke perintah") → prompt dengan `generate_video_with_references` diketik → "Selalu setujui di project" diklik sekali → tunggu sampai video selesai,
   - video yang jadi diberi nama "Scene n – Episode" di Flow,
   - setelah semua scene jadi, video diunduh berdasarkan nama itu (klik kanan → Download → 720p),
   - semua scene digabung jadi satu episode 1080×1920.
3. Klik **Unduh episode** di banner atas episode.

Episode berikutnya: klik **tokoh** pada serial, pilih storyboard baru, Simpan. Atau buka episode baru (**+ eps**) lalu unggah storyboard.

Kalau ada scene yang gagal terus (tangga perbaikan habis), banner berubah jadi "Perlu dicek". Perbaiki scene itu (atau unggah videonya sendiri), lalu klik **Lanjutkan**.

## Tangga perbaikan otomatis

Kalau Flow menolak, prompt naik satu tingkat lalu dicoba lagi:

| Tingkat | Perubahan |
|---|---|
| 0 | Prompt asli + start frame satu baris storyboard |
| 1 | Kata berisiko dihaluskan (uang → benda, marah → kesal, kamar tidur → ruangan, dst.) |
| 2 | Start frame foto tunggal + prompt pendek |
| 3 | Dialog berisiko (uang, cerai, pecat, selingkuh…) dibuang, dicatat untuk VO |
| 4 | Tanpa dialog sama sekali, dicatat untuk VO |
| 5 | Berhenti, minta dicek manual |

Gagal audio ("Pembuatan audio gagal") langsung lompat ke tingkat 3. Daftar kata dan gantinya ada di `config/fix-rules.json`, bisa ditambah sendiri dari pengalaman gagal berikutnya.

## Pengaturan berguna (`config/flow.json`)

- `human.typingMode`: `"type"` mengetik huruf per huruf (paling manusiawi, ±1 menit per prompt). `"mixed"` mengetik 180 huruf pertama lalu sisanya per kalimat (lebih cepat).
- `maxAttemptsPerScene`: batas percobaan per scene (default 5).
- `pauseBetweenScenesSec`: jeda antar scene.
- `executablePath`: isi kalau Chrome tidak ditemukan otomatis, misalnya `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

## Uji

```bash
npm test             # tangga prompt + crop storyboard contoh
npm run test:runner  # Playwright melawan halaman Flow palsu (gagal kebijakan → gagal audio → berhasil)
```

Data tersimpan di `data/` (db.json, frame, klip, episode jadi). Back up folder itu kalau mau pindah komputer.
