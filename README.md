# Flow Drama Studio

Dashboard lokal (jalan di Mac sendiri) untuk produksi drama AI pendek vertikal. Kamu cukup unggah **gambar storyboard**, lalu aplikasi ini:

1. memotong storyboard jadi gambar per scene,
2. menyuruh **Claude** membaca storyboard dan menulis isi tiap scene (tokoh, setting, 5 shot, dialog, audio),
3. membuka **Google Flow** di Chrome dan mengetik prompt-nya sendiri (gaya manusia, lewat Playwright),
4. memperbaiki prompt sendiri kalau Flow menolak,
5. mengunduh semua video scene, lalu menggabungkannya jadi **satu episode 1080×1920**.

Semua data tersimpan di komputer sendiri (`data/`). Tidak ada server luar selain Google Flow dan Claude.

---

## Daftar isi

- [Fitur yang sudah jadi](#fitur-yang-sudah-jadi)
- [Kebutuhan](#kebutuhan)
- [Cara install](#cara-install)
- [Menyambungkan Claude (LLM)](#menyambungkan-claude-llm)
- [Login Google Flow](#login-google-flow)
- [Kalibrasi tombol Flow](#kalibrasi-tombol-flow)
- [Cara pakai](#cara-pakai)
- [Tangga perbaikan otomatis](#tangga-perbaikan-otomatis)
- [Pengaturan](#pengaturan)
- [Struktur folder](#struktur-folder)
- [Antrean, akun, dan notifikasi](#antrean-akun-dan-notifikasi)
- [VO, subtitle, dan teks upload](#vo-subtitle-dan-teks-upload)
- [Uji](#uji)
- [Masalah umum](#masalah-umum)
- [Saran fitur & rencana update](SARAN.md)

---

## Fitur yang sudah jadi

| Fitur | Keterangan |
|---|---|
| **Serial & episode** | Buat serial (judul + sheet tokoh), tambah episode sebanyak apa pun. Tokoh dipakai ulang di semua episode. |
| **Crop storyboard otomatis** | Storyboard (6 baris scene, tiap baris 5 foto) dipotong jadi gambar per baris scene + foto tunggal. |
| **Auto-prompt pakai Claude** | Claude membaca gambar storyboard lalu mengisi tokoh (kalau belum ada), setting, 5 shot, dialog bahasa Indonesia, audio, dan hal yang dihindari per scene. |
| **Edit scene manual** | Semua isi scene bisa diubah di dashboard sebelum dikirim ke Flow. |
| **Tempel prompt sendiri** | Punya prompt jadi dari tempat lain? Tempel sekaligus untuk semua scene (format `## SCENE 1: Judul` per blok, atau blok yang diawali `Model:`). |
| **Generate otomatis di Google Flow** | Tiap episode dibuatkan project Flow sendiri. Tiap scene: sesi baru, lampirkan gambar referensi, ketik prompt seperti manusia (kecepatan acak, typo sesekali, jeda berpikir), klik generate, tunggu sampai video jadi. |
| **Persetujuan otomatis** | Menjawab pertanyaan agen Flow dan klik "Selalu setujui di project". |
| **Perbaikan prompt otomatis** | Kalau Flow menolak (kebijakan / audio gagal), prompt dihaluskan bertingkat lalu dicoba ulang. |
| **Deteksi kredit habis** | Antrean berhenti dengan pesan jelas kalau kredit Flow habis. |
| **Unduh otomatis** | Video diberi nama "Scene n – Episode" di Flow, lalu diunduh (720p) berdasarkan nama itu. |
| **Unggah video manual** | Kalau satu scene gagal terus, unggah videonya sendiri lalu klik **Lanjutkan**. |
| **Gabung episode** | ffmpeg: buang frame kolase di awal klip, samakan ke 1080×1920 24fps, fade audio di sambungan, loudnorm −14 LUFS, H.264. |
| **1 drama = 1 akun Google** | Tiap serial dipasangkan ke satu akun Google Flow. Antrean pindah akun sendiri saat giliran drama lain. Login tiap akun cukup sekali. |
| **Antrean banyak episode** | Pilih banyak storyboard sekaligus: tiap gambar jadi satu episode (urut nama file) dan diproses bergiliran. Antrean terlihat di menu samping, episode bisa dikeluarkan dari antrean. |
| **Notifikasi** | Pop-up macOS (dan Telegram kalau diatur) saat episode jadi, perlu dicek, berhenti karena error, atau kredit akun habis. |
| **VO otomatis** | Dialog yang dibuang dari prompt (tangga tingkat 3–4) dibuatkan suara lewat ElevenLabs, lalu ditempel ke klip saat digabung. Suara bisa diatur per tokoh. |
| **Subtitle** | File `.srt` selalu dibuat dari dialog. Opsional: subtitle ditempel langsung ke video (atur per serial). |
| **Judul, deskripsi, hashtag, prompt thumbnail** | Setelah episode jadi, Claude menulis teks upload plus prompt thumbnail siap tempel di ChatGPT (dan teks hook untuk thumbnail). Tinggal salin. |
| **Generate ulang satu scene** | Hasil jelek tapi tidak error? Klik **Generate ulang (versi baru)** di detail scene: video baru dibuat (nama di Flow diberi akhiran `v2`, `v3`, …), diunduh, lalu episode digabung ulang. |
| **Preview & potong** | Putar semua scene berurutan, atur potongan awal/akhir tiap scene, lalu gabung ulang. |
| **Usulan aturan perbaikan** | Claude membaca prompt yang pernah ditolak Flow dan mengusulkan kata pengganti baru. Kamu pilih mana yang dipakai, lalu otomatis masuk ke `config/fix-rules.json`. |
| **Jeda otomatis** | Kalau otomasi macet (tampilan Flow berubah) atau video tidak muncul, antrean langsung dijeda di scene itu, screenshot disimpan di `data/debug/`, dan notifikasi dikirim. Kamu bisa buat scene itu manual, lalu klik Lanjutkan: scene berikutnya langsung diproses. |
| **Statistik** | Jumlah generate (perkiraan kredit), berhasil, ditolak, audio gagal, tingkat tertinggi, dan pesan gagal terbanyak, per drama dan per episode. |
| **Gaya Claude per drama** | Pilih gaya dialog (dramatis, santai, lucu, tegang, sedih), model Claude (Opus/Sonnet/Haiku), dan catatan gaya bebas. |
| **Aman di jaringan** | Dashboard hanya bisa dibuka dari Mac sendiri (`127.0.0.1`). |
| **Log langsung** | Progres tiap langkah tampil di dashboard. |

---

## Kebutuhan

- **macOS** (dibuat dan diuji di Mac)
- **Node.js 18+**
- **ffmpeg**
- **Google Chrome**
- **Claude Code CLI** (perintah `claude`) yang sudah login. Lihat [Menyambungkan Claude](#menyambungkan-claude-llm).
- Akun Google yang punya akses **Google Flow** (dan kreditnya)

---

## Cara install

```bash
# 1. Pasang Node.js dan ffmpeg (kalau belum ada)
brew install node ffmpeg

# 2. Ambil kode
git clone https://github.com/Faresapn/flow-drama-studio.git
cd flow-drama-studio

# 3. Pasang dependensi
npm install

# 4. (Cadangan) browser Chromium untuk Playwright.
#    Defaultnya pakai Google Chrome yang sudah terpasang.
npx playwright install chromium

# 5. Jalankan
npm start
```

Buka **http://localhost:4777** di browser.

Mau ganti port? `PORT=5000 npm start`

> Folder `data/episodes/`, `browser-profile/`, dan semua gambar/video **tidak ikut di repo**. Folder itu dibuat otomatis saat aplikasi dipakai.

---

## Menyambungkan Claude (LLM)

Aplikasi ini **tidak memakai API key**. Ia memanggil **Claude Code CLI** (`claude -p ...`) yang terpasang di Mac, jadi memakai login Claude Code kamu sendiri (langganan Claude Pro/Max, atau akun Console).

### 1. Pasang Claude Code

Pilih salah satu:

```bash
# Installer resmi
curl -fsSL https://claude.ai/install.sh | bash

# atau lewat npm
npm install -g @anthropic-ai/claude-code
```

### 2. Login (sekali saja)

```bash
claude
```

Ikuti petunjuk login di terminal (buka browser, masuk ke akun Claude). Setelah berhasil, ketik `/exit`.

### 3. Cek sudah tersambung

```bash
claude -p "balas dengan kata OK saja"
```

Kalau muncul `OK`, berarti siap. Aplikasi akan memakai login ini otomatis.

### Kalau perintah `claude` tidak ditemukan aplikasi

Server Node kadang tidak membaca PATH yang sama dengan terminal. Arahkan langsung ke lokasinya:

```bash
which claude                      # contoh hasil: /Users/kamu/.local/bin/claude
CLAUDE_BIN=/Users/kamu/.local/bin/claude npm start
```

### Pakai API key, bukan langganan (opsional)

Kalau mau tagihan lewat API Anthropic (Console), jalankan dengan API key. Claude Code akan memakai key itu, bukan login langganan:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Jangan simpan key di kode atau commit ke git.

### Cara kerjanya

- File: `src/autoprompt.js`
- Perintah yang dijalankan: `claude -p "<instruksi>" --allowedTools Read --output-format json`
- Claude hanya diberi izin **Read** (membaca gambar storyboard), tidak bisa mengubah file atau menjalankan perintah lain.
- Batas waktu 5 menit per storyboard.
- Claude membalas JSON berisi tokoh + scene, lalu disimpan ke `data/db.json`.
- Instruksi ke Claude (aturan menulis shot, dialog, dsb.) ada di fungsi `buildInstruction` di file yang sama. Ubah di situ kalau mau gaya penulisan lain.

### Tanpa Claude

Auto-prompt hanya jalan kalau scene masih kosong. Kalau tidak mau pakai Claude, isi scene sendiri di dashboard, atau pakai fitur **tempel prompt**. Generate di Flow tetap jalan.

---

## Login Google Flow

Klik **Buka Google Flow (login)** di dashboard. Jendela Chrome khusus terbuka. Login ke akun Google kamu di situ.

Sesi login disimpan di `browser-profile/`, jadi berikutnya tidak perlu login lagi. **Jangan tutup jendela itu saat antrean berjalan.**

> `browser-profile/` berisi sesi login Google. Jangan dibagikan dan jangan di-commit (sudah ada di `.gitignore`).

**Banyak akun:** tambah akun dari dashboard. Tiap akun punya profil Chrome sendiri. Video episode tersimpan di akun tempat ia dibuat, jadi untuk mengunduh, pindah dulu ke akun itu.

---

## Kalibrasi tombol Flow

Tampilan Google Flow bisa berubah, jadi selector di `config/flow.json` mungkin perlu disesuaikan. Jalankan:

```bash
npm run calibrate
```

Chrome terbuka ke Flow. Masuk ke project, lalu tekan Enter di terminal. Script mencetak daftar tombol, input, dan kolom teks yang terlihat (teks, aria-label, placeholder). Cocokkan dengan langkah di `config/flow.json` → `steps`:

| Langkah | Yang dicari |
|---|---|
| `waitFor` | kolom prompt (textbox) |
| `click` histori / sesi baru | tombol membuka sesi agen baru |
| `upload` | tombol tambah bahan + "Upload media" + "Tambahkan ke perintah" |
| `type` | kolom prompt |
| `click` | tombol mulai pembuatan / panah |

Langkah bertanda `"optional": true` dilewati kalau elemennya tidak ada. Teks gagal Flow ada di `result.failTexts` dan `result.audioFailTexts`; tambahkan kalau muncul pesan baru. Cukup ubah file JSON ini, tidak perlu ubah kode.

---

## Cara pakai

1. **Serial baru** → isi judul, pilih **sheet tokoh** (gambar semua tokoh) dan gambar storyboard episode pertama. Sheet tokoh boleh dikosongkan.
2. Setelah storyboard diunggah, semuanya jalan sendiri:
   - project Google Flow baru dibuat untuk episode ini ("Serial – Episode"),
   - storyboard dipotong jadi 6 baris scene,
   - Claude membaca storyboard lalu menulis isi tiap scene,
   - tiap scene: sesi agen baru di Flow → 2 gambar referensi dilampirkan (baris scene + sheet tokoh) → prompt diketik → tunggu video selesai,
   - video diberi nama "Scene n – Episode" di Flow,
   - setelah semua scene jadi, video diunduh (klik kanan → Download → 720p),
   - semua scene digabung jadi satu episode 1080×1920.
3. Klik **Unduh episode** di banner atas episode.

**Episode berikutnya:** klik **tokoh** pada serial, pilih storyboard baru, Simpan. Atau buka episode baru (**+ eps**) lalu unggah storyboard.

**Kalau ada scene yang gagal terus** (tangga perbaikan habis), banner berubah jadi "Perlu dicek". Perbaiki scene itu atau unggah videonya sendiri, lalu klik **Lanjutkan**.

**Format storyboard yang diharapkan:** 6 baris scene. Tiap baris: kotak label merah "SCENE n" (waktu + judul scene) di kiri, lalu 5 foto bernomor dengan keterangan singkat, dibaca kiri ke kanan.

---

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

Gagal audio ("Pembuatan audio gagal") langsung lompat ke tingkat 3. Daftar kata dan gantinya ada di `config/fix-rules.json`, bisa ditambah sendiri.

---

## Pengaturan

### `config/flow.json`

| Kunci | Fungsi |
|---|---|
| `human.typingMode` | `"type"` mengetik huruf per huruf (paling manusiawi, ±1 menit per prompt). `"mixed"` mengetik 180 huruf pertama lalu sisanya per kalimat (lebih cepat). |
| `human.*` | Kecepatan ketik, peluang typo, jeda berpikir, gerak mouse. |
| `maxAttemptsPerScene` | Batas percobaan per scene (default 5). |
| `pauseBetweenScenesSec` | Jeda acak antar scene, misalnya `[20, 45]` detik. |
| `executablePath` | Isi kalau Chrome tidak ditemukan otomatis, misalnya `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. |
| `result.timeoutSec` | Batas tunggu satu video (default 1200 detik). |
| `result.creditTexts` | Teks yang menandakan kredit Flow habis. |

### Variabel lingkungan

| Variabel | Fungsi |
|---|---|
| `PORT` | Port dashboard (default `4777`). |
| `CLAUDE_BIN` | Lokasi perintah `claude` kalau tidak ada di PATH. |
| `ANTHROPIC_API_KEY` | Opsional. Pakai API key, bukan login langganan Claude Code. |
| `NOTIFY_MAC` | Isi `0` untuk mematikan pop-up notifikasi macOS. |
| `TELEGRAM_BOT_TOKEN` | Opsional. Token bot Telegram untuk notifikasi ke HP. |
| `TELEGRAM_CHAT_ID` | Opsional. Chat ID tujuan notifikasi Telegram. |
| `ELEVENLABS_API_KEY` | Opsional. Kunci API ElevenLabs untuk VO. Tanpa ini, VO dilewati. |
| `ELEVENLABS_VOICE_ID` | Opsional. Voice ID default kalau serial tidak mengatur suara. |
| `ELEVENLABS_MODEL` | Opsional. Model TTS (default `eleven_multilingual_v2`). |
| `HOST` | Alamat server (default `127.0.0.1`, hanya Mac ini). `0.0.0.0` membuka ke jaringan, tidak disarankan. |

---

## Antrean, akun, dan notifikasi

### 1 drama = 1 akun Google

Supaya tidak bingung video ada di akun mana, tiap serial dipasangkan ke **satu akun Google**:

1. Tambah akun di bagian bawah menu samping (**Tambah**), lalu login Google di jendela Chrome yang terbuka. Cukup sekali per akun.
2. Saat membuat serial (atau di **Pengaturan serial**), pilih **Akun Google untuk drama ini**.
3. Semua episode drama itu dibuat dan diunduh di akun tersebut. Kalau giliran antrean pindah ke drama dengan akun lain, aplikasi pindah akun sendiri (video yang sudah jadi di akun lama diunduh dulu).

Nama akun tiap serial terlihat di menu samping. Serial lama yang belum punya akun otomatis memakai akun episode terakhirnya.

### Antrean banyak episode

- Di dialog serial, pilih **banyak storyboard sekaligus**. Tiap gambar jadi satu episode, diurutkan berdasarkan nama file (`eps1.png`, `eps2.png`, …).
- Episode diproses bergiliran (satu browser). Daftar antrean terlihat di menu samping.
- Episode yang menunggu bisa dikeluarkan lewat tombol **Keluarkan dari antrean**.
- **Hentikan** menghentikan scene yang sedang jalan setelah langkah ini selesai, dan mengosongkan antrean.
- Kalau kredit satu akun habis, episode lain **di akun yang sama** dilewati (ditandai "Perlu dicek"), sedangkan drama di akun lain tetap jalan. Setelah kredit diisi, klik **Lanjutkan** di episode itu.

### Notifikasi

Notifikasi dikirim saat episode jadi, perlu dicek, berhenti karena error, atau kredit akun habis.

- **macOS:** pop-up otomatis. Kalau tidak muncul, izinkan notifikasi untuk Terminal (atau aplikasi tempat `npm start` dijalankan) di System Settings → Notifications. Matikan dengan `NOTIFY_MAC=0`.
- **Telegram (opsional, notifikasi ke HP):**
  1. Chat [@BotFather](https://t.me/BotFather) di Telegram, kirim `/newbot`, simpan token-nya.
  2. Kirim pesan apa saja ke bot baru itu.
  3. Buka `https://api.telegram.org/bot<TOKEN>/getUpdates`, cari angka `"chat":{"id":...}`.
  4. Jalankan:
     ```bash
     TELEGRAM_BOT_TOKEN=123:abc TELEGRAM_CHAT_ID=987654 npm start
     ```

---

## VO, subtitle, dan teks upload

Pengaturan ada di dialog serial (klik ⋯ di samping nama serial).

### VO (ElevenLabs)

Di tangga perbaikan tingkat 3–4, dialog dibuang dari prompt supaya Flow mau membuat video. Dialog itu dibuatkan suara dan ditempel ke klip saat episode digabung.

1. Buat API key di [elevenlabs.io](https://elevenlabs.io) (Profile → API Keys).
2. Jalankan:
   ```bash
   ELEVENLABS_API_KEY=sk_... npm start
   ```
3. Di dialog serial → **Suara VO**: isi **Voice ID default**, dan (opsional) suara per tokoh, satu per baris: `W = <voice_id>`. Voice ID ada di halaman Voices ElevenLabs.
4. Pembicara tiap shot diisi Claude otomatis. Bisa diubah di detail scene (kolom **Pembicara**).

VO disimpan di `data/episodes/<id>/vo/` dan dipakai ulang kalau teksnya sama (tidak bayar dua kali).

### Subtitle

- File `.srt` selalu dibuat di samping video episode (tombol **Subtitle .srt**). Bisa diunggah ke YouTube.
- Centang **Tempel subtitle di video** di dialog serial → **Hasil video** untuk menempel teks langsung ke video.

### Judul, deskripsi, hashtag, dan prompt thumbnail

Setelah episode digabung, Claude menulis judul, deskripsi, hashtag, dan **prompt thumbnail untuk ChatGPT** (Claude membaca sheet tokoh dan storyboard supaya wajah dan baju tokoh sesuai), plus teks hook pendek untuk ditempel di thumbnail. Hasilnya ada di bagian **Judul & prompt thumbnail untuk upload** di halaman episode, lengkap dengan tombol salin. Matikan di dialog serial → **Hasil video** kalau tidak perlu.

---

## Kalau otomasi macet (jeda otomatis)

Antrean otomatis **dijeda** di scene yang bermasalah kalau:
- tombol di Flow tidak ketemu (biasanya tampilan Flow berubah), atau
- video tidak muncul sampai batas waktu (`result.timeoutSec`).

Kamu dapat notifikasi, dan menu samping menampilkan **Antrean dijeda**. Episode lain di antrean ditahan dulu.

Buka **Detail** scene itu → **Buat scene ini manual**, lalu pilih salah satu:

1. **Sudah dibuat di Flow**: buat videonya sendiri di Flow (prompt bisa disalin dari Detail), ganti nama videonya di Flow persis seperti nama yang ditampilkan (mis. `Scene 3 – Episode 1`), lalu klik tombol ini. App mengunduhnya sendiri.
2. **Lewati, unggah sendiri**: unggah videonya lewat tombol **Unggah video manual**.

Lalu klik **Lanjutkan** di halaman episode. Scene berikutnya langsung diproses, lalu episode lain yang tadi ditahan.

Kalau tampilan Flow memang berubah, jalankan `npm run calibrate` dan perbarui `config/flow.json` supaya scene berikutnya tidak macet lagi.

### Preview & potong

Di halaman episode → **Preview & potong sebelum digabung**: putar semua scene berurutan, isi detik awal/akhir yang mau dipakai, lalu **Simpan potongan & gabung ulang**.

---

## Struktur folder

```
flow-drama-studio/
├── src/
│   ├── server.js       # server Express + API dashboard
│   ├── pipeline.js     # alur otomatis: crop → Claude → Flow → unduh → gabung
│   ├── autoprompt.js   # sambungan ke Claude Code CLI
│   ├── prompt.js       # susun prompt per scene + tangga perbaikan
│   ├── runner.js       # otomasi Google Flow (Playwright)
│   ├── human.js        # gerak mouse & ketikan seperti manusia
│   ├── crop.js         # potong storyboard (sharp)
│   ├── merge.js        # gabung video (ffmpeg)
│   ├── notify.js       # notifikasi macOS + Telegram
│   ├── vo.js           # VO ElevenLabs
│   ├── subs.js         # subtitle .srt + teks tempel
│   ├── calibrate.js    # bantu cari selector Flow
│   └── store.js        # simpan data ke data/db.json
├── public/index.html   # dashboard
├── config/
│   ├── flow.json       # selector Flow + pengaturan
│   └── fix-rules.json  # kata berisiko dan gantinya
├── data/               # db.json, storyboard, frame, klip, episode jadi
├── browser-profile/    # sesi login Chrome (tidak di-commit)
└── test/
```

Data tersimpan di `data/`. Back up folder itu (dan `browser-profile/` kalau mau sesi login ikut) saat pindah komputer.

---

## Uji

```bash
npm test             # tangga prompt + crop storyboard + subtitle
npm run test:runner  # Playwright melawan halaman Flow palsu (gagal kebijakan → gagal audio → berhasil)
```

> `npm test` memakai `test/sample-storyboard.png` kalau ada. Kalau tidak ada (gambar tidak ikut di repo), storyboard buatan dibuat otomatis oleh `test/make-sample.js`.

---

## Masalah umum

| Masalah | Solusi |
|---|---|
| `Claude CLI tidak bisa dijalankan` | Perintah `claude` belum terpasang atau tidak ada di PATH. Pasang Claude Code, lalu jalankan dengan `CLAUDE_BIN=$(which claude) npm start`. |
| `Claude CLI error: ...` / belum login | Jalankan `claude` di terminal dan login ulang. Cek dengan `claude -p "OK"`. |
| `Claude CLI tidak menjawab dalam 5 menit` | Koneksi lambat atau kuota Claude habis. Coba lagi, atau isi scene manual. |
| Chrome tidak terbuka | Isi `executablePath` di `config/flow.json`, atau jalankan `npx playwright install chromium`. |
| Tombol Flow tidak ketemu / macet di satu langkah | Tampilan Flow berubah. Jalankan `npm run calibrate` dan perbarui selector di `config/flow.json`. |
| "Kredit Flow habis" | Isi kredit atau pindah ke akun Google lain dari dashboard, lalu klik **Lanjutkan**. |
| Video ada di akun lain | Pindah ke akun tempat episode itu dibuat, baru unduh. |
| Gagal gabung video | Pastikan `ffmpeg` terpasang (`ffmpeg -version`). |
| VO tidak muncul | Cek `ELEVENLABS_API_KEY` dan Voice ID di dialog serial. Pesan gagal ada di Aktivitas. |
| Dashboard tidak bisa dibuka dari HP/laptop lain | Disengaja demi keamanan. Kalau benar-benar perlu, jalankan dengan `HOST=0.0.0.0` di jaringan yang kamu percaya. |
