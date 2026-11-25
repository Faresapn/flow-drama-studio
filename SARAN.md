# Saran Fitur & Rencana Update

Daftar fitur. Centang (`[x]`) kalau sudah dikerjakan.

---

## Sudah dikerjakan

- [x] **1. VO otomatis untuk dialog yang dibuang** — ElevenLabs, suara per tokoh, ditempel saat digabung. (`src/vo.js`)
- [x] **2. Subtitle otomatis** — `.srt` selalu dibuat, opsional ditempel ke video. (`src/subs.js`)
- [x] **3. Notifikasi** — macOS + Telegram. (`src/notify.js`)
- [x] **4. Aturan perbaikan belajar sendiri** — Claude mengusulkan kata baru dari prompt yang ditolak, kamu pilih yang dipakai.
- [x] **5. Antrean banyak episode** — plus 1 drama = 1 akun Google.
- [x] **6. Generate ulang satu scene** — versi baru (`v2`, `v3`…), diunduh, episode digabung ulang.
- [x] **7. Preview & potong sebelum digabung**
- [x] **8. Judul, deskripsi, hashtag, dan prompt thumbnail untuk ChatGPT**
- [x] **10. Jeda otomatis kalau Flow macet** — screenshot + notifikasi, scene bisa dibuat manual, lalu lanjut ke scene berikutnya.
- [x] **11. Statistik per drama dan per episode**
- [x] **12. Gaya dan model Claude per drama**
- [x] **13. Dashboard hanya bisa dibuka dari Mac sendiri**
- [x] **14. Storyboard contoh untuk test** — dibuat otomatis oleh `test/make-sample.js`.

## Belum dikerjakan

- [ ] **9. Upload langsung ke YouTube Shorts / TikTok**
  Ditunda karena butuh persiapan di luar kode:
  - **YouTube:** buat project di Google Cloud Console, aktifkan YouTube Data API v3, buat OAuth client (Desktop app), lalu login sekali. Kuota harian API terbatas (±6 upload/hari di kuota default).
  - **TikTok:** Content Posting API butuh aplikasi developer yang disetujui TikTok. Sebelum disetujui, video hanya bisa diunggah sebagai privat/draft.
  Kalau sudah siap minimal untuk YouTube, fitur ini bisa ditambahkan: unggah video + judul + deskripsi + hashtag + thumbnail + subtitle `.srt` yang sudah dibuat otomatis.

## Ide berikutnya

- [ ] **15. Pilih suara VO dari daftar** — ambil daftar suara ElevenLabs dan pilih di dashboard, tidak perlu salin Voice ID manual.
- [ ] **16. Jadwal antrean** — jalan otomatis di jam tertentu (mis. malam), berhenti pagi.
- [ ] **17. Ganti akun otomatis saat kredit habis** — kalau drama boleh pakai akun cadangan, pindah sendiri tanpa menunggu.
- [ ] **18. Gambar thumbnail & storyboard otomatis** — butuh API gambar (OpenAI Images atau Google Gemini/Nano Banana). Prompt thumbnail sudah dibuat Claude, tinggal dikirim ke API.
