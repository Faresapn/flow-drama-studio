# Saran Fitur & Rencana Update

Daftar fitur yang belum ada. Centang (`[x]`) kalau sudah dikerjakan.

Urutan kerja yang disarankan: **#13 → #1 → #2**, lalu sisanya sesuai kebutuhan.

Sudah dikerjakan: #3 notifikasi (macOS + Telegram), #5 antrean banyak episode, plus **1 drama = 1 akun Google** (lihat README).

---

## Paling berdampak

- [ ] **1. VO otomatis untuk dialog yang dibuang**
  Di tangga perbaikan tingkat 3 dan 4, dialog cuma dicatat "untuk VO", tapi belum ada yang membuat suaranya. Sambungkan ke ElevenLabs atau Fish Audio, lalu tempel audionya ke klip saat digabung. Tanpa ini, scene yang turun tangga jadi bisu.
  File terkait: `src/prompt.js`, `src/merge.js`

- [ ] **2. Subtitle otomatis**
  Dialog per shot sudah ada di data. Ubah jadi file `.srt` atau tempel langsung ke video saat digabung (burn-in). Penting untuk Shorts karena banyak yang menonton tanpa suara.
  File terkait: `src/merge.js`

- [x] **3. Notifikasi saat episode selesai atau macet**
  Antrean bisa berjalan berjam-jam. Kirim notifikasi macOS, Telegram, atau WhatsApp saat status "Perlu dicek", kredit habis, atau episode jadi.
  File terkait: `src/pipeline.js`

- [ ] **4. Aturan perbaikan yang belajar sendiri**
  Tiap kali Flow menolak, catat kata pemicunya, lalu minta Claude mengusulkan kata pengganti untuk `config/fix-rules.json`. Sekarang file itu masih diisi manual.
  File terkait: `src/runner.js`, `config/fix-rules.json`

## Menghemat waktu

- [x] **5. Antrean banyak episode sekaligus**
  Unggah beberapa storyboard, biarkan jalan semalaman, dan pindah akun Google otomatis kalau kredit habis. Pindah akun sudah bisa, tapi masih manual.
  File terkait: `src/pipeline.js`, `src/runner.js`

- [ ] **6. Ulang satu scene dari dashboard**
  Tombol "ulang scene n" dengan prompt yang sudah diedit, untuk hasil video yang jelek tapi tidak error. Tidak perlu mengulang satu episode.
  File terkait: `public/index.html`, `src/server.js`

- [ ] **7. Preview sebelum digabung**
  Putar semua klip berurutan di dashboard, atur potongan awal/akhir (`trimStart` / `trimEnd` sudah ada di kode), baru digabung.
  File terkait: `public/index.html`

- [ ] **8. Thumbnail dan judul otomatis**
  Claude membuat judul, deskripsi, dan hashtag, plus memilih frame terbaik untuk thumbnail.
  File terkait: `src/autoprompt.js`

- [ ] **9. Upload langsung ke YouTube Shorts atau TikTok**
  Setelah episode jadi, unggah otomatis.

## Biar lebih kuat

- [ ] **10. Peringatan kalau tampilan Flow berubah**
  Kalau tombol tidak ketemu, kirim notifikasi dan screenshot halaman Flow, supaya langsung tahu harus kalibrasi ulang. Sekarang antreannya cuma macet.
  File terkait: `src/runner.js`

- [ ] **11. Statistik gagal per scene**
  Catat berapa kali ditolak, sampai tingkat berapa, dan kredit yang terpakai per episode, supaya kelihatan pola konten yang sering ditolak.
  File terkait: `src/runner.js`, `src/store.js`

- [ ] **12. Pilihan model atau gaya Claude di dashboard**
  Misalnya gaya dialog (lebih dramatis atau santai), tanpa harus edit `buildInstruction` di kode.
  File terkait: `src/autoprompt.js`, `public/index.html`

## Keamanan

- [ ] **13. Dashboard hanya bisa dibuka dari Mac sendiri**
  Sekarang `app.listen(PORT)` di `src/server.js` terbuka ke semua perangkat di WiFi yang sama. Siapa pun di jaringan itu bisa membuka dashboard dan menjalankan Flow memakai akun Google kamu. Perbaikannya satu baris:
  ```js
  app.listen(PORT, '127.0.0.1', () => { ... });
  ```

## Lain-lain

- [ ] **14. Gambar contoh untuk test**
  `npm test` butuh `test/sample-storyboard.png`, yang tidak ikut di repo. Tambahkan gambar storyboard contoh (boleh dummy) dan kecualikan dari `.gitignore`, supaya test bisa jalan setelah clone.
