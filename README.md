# Pegandekan Mail
Webmail multi pengguna untuk **pegandekan.web.id**. Kode di GitHub, aplikasi dan API di Cloudflare Workers, database D1. **Deploy sebagai Worker, bukan Pages.**

## Fitur dan status
- Login password PBKDF2, sesi cookie HttpOnly, proteksi origin, pembatasan percobaan login.
- Admin membuat akun, menonaktifkan akun dan mereset password; pengguna mengubah password sendiri.
- Kotak masuk masing-masing, pencarian per folder, bintang, terkirim, draf, sampah dan hapus permanen.
- Kirim, balas, teruskan dan lampiran **antarpengguna domain yang dibuat admin**.
- Handler penerimaan email luar melalui Cloudflare Email Routing; perlu konfigurasi DNS dan routing.
- Tampilan bahasa Indonesia responsif.
- **Pengiriman ke Gmail/Yahoo/domain luar belum diimplementasikan.** Tombol kirim menampilkan penolakan yang jelas. Tidak ada SMTP/IMAP, spam classifier, antivirus lampiran, pemulihan password otomatis, atau jaminan ketersediaan setara layanan email komersial. Isi HTML ditampilkan sebagai teks.

## Batas versi gratis
20 akun, 100 email per akun (termasuk draf/terkirim/sampah), maksimal 3 lampiran dengan total 64 KiB, email masuk mentah maksimal 128 KiB. Payload isi dan lampiran setelah dekode dibatasi 120.000 byte. Batas konservatif mengurangi kebutuhan penyimpanan D1; kuota request dan operasi D1 tetap berlaku. Sampah harus dihapus permanen untuk membebaskan ruang. Backup database rutin. Akun nonaktif menolak email masuk.

Workers Free dan D1 Free dipakai tanpa R2 atau layanan berbayar. Kuota gratis Cloudflare dapat berubah; ketika kuota habis aplikasi dapat berhenti melayani permintaan. Jangan mengaktifkan paket berbayar jika menginginkan biaya nol.

## Instalasi Cloudflare dari GitHub
### 1. Buat database
Cloudflare → **Storage & databases → D1 → Create database**.
- Nama: **pegandekan-mail**.
- Salin **Database ID** (UUID, bukan password).
- Di GitHub edit **wrangler.jsonc**: ganti **00000000-0000-0000-0000-000000000000** dengan Database ID.
- Di D1 buka **Console**, jalankan seluruh SQL dari [migrations/0001_mail.sql](migrations/0001_mail.sql) sekali sebelum aplikasi dipakai. Alternatif CLI: **npm run db:remote** setelah **wrangler login** dan mengisi ID yang benar. Jangan mengulang SQL secara manual jika tabel sudah ada.

### 2. Hubungkan repository ke Workers
Cloudflare → **Workers & Pages → Create application → Import a repository** (pilih Worker / Workers Builds).
- Repository: **applikasiku/pegandekan-mail**.
- Branch produksi: **main**.
- Root directory: **/**.
- Build command: **npm run build**.
- Deploy command: **npx wrangler deploy**.
- Tidak ada kolom build output directory untuk Worker. Jika tampilan meminta output directory Pages, kembali dan pilih Workers.
- Binding D1 **DB** sudah dideklarasikan di wrangler.jsonc. Pastikan ID database sudah diganti sebelum deploy.

### 3. Token setup dan admin pertama
Worker → **Settings → Variables and Secrets** → tambah tipe **Secret**:
- Nama: **SETUP_TOKEN**.
- Nilai: token acak pribadi minimal 32 karakter. Simpan di pengelola password. **Jangan simpan di GitHub atau kirim di chat.**
- Terapkan perubahan/redeploy.
Buka URL Worker, isi token setup, nama admin, email seperti **admin@pegandekan.web.id**, dan password minimal 12 karakter. Setelah admin dibuat, halaman berubah menjadi login; setup tidak bisa dipakai lagi. Boleh menghapus secret SETUP_TOKEN setelah berhasil. Tambahkan akun pengguna lewat **Kelola pengguna**.

### 4. Domain website
Worker → **Settings → Domains & Routes → Add → Custom domain**:
**mail.pegandekan.web.id**.
Gunakan Custom Domain milik Worker, bukan A record menuju IP sembarang. Domain utama pegandekan.web.id tidak perlu diarahkan ke website email ini.

### 5. Email dari luar domain
Pada domain **pegandekan.web.id**, buka **Email Routing / Compute → Email Service → Email Routing** sesuai tampilan dashboard.
1. Aktifkan Email Routing dan selesaikan verifikasi alamat tujuan bila diminta saat onboarding.
2. Tinjau MX/TXT yang disarankan Cloudflare. Jangan menimpa MX layanan email lain bila domain sudah dipakai untuk email.
3. Tambah rule untuk setiap alamat akun (misalnya admin@pegandekan.web.id), aksi **Send to a Worker**, Worker **pegandekan-mail**. Atau gunakan Catch-all → Worker jika tersedia; aplikasi hanya menerima akun aktif yang dibuat admin.
4. Kirim email uji kecil dari Gmail ke akun yang sudah dibuat. Buka kotak masuk website.
**Custom Domain website tidak otomatis mengaktifkan Email Routing.**

## Pengembangan
Node.js 22 atau lebih baru. Perintah:
- npm ci
- npm run check
- npm test
- npm run db:local
- npm run dev

Setup lokal memakai secret SETUP_TOKEN melalui mekanisme secret lokal Wrangler. File .dev.vars diabaikan git. Jangan gunakan kredensial produksi untuk pengujian.

## Pemakaian
Admin membuat akun, misalnya andi@pegandekan.web.id dan warga@pegandekan.web.id. Pengguna login, mengubah password awal, lalu mengirim pesan ke akun lain. Email luar diterima setelah Email Routing selesai; membalas ke alamat luar akan ditolak pada versi ini.

Untuk email keluar umum diperlukan integrasi penyedia yang mengizinkan email antarorang. Layanan API email transaksional tidak otomatis sesuai untuk webmail.

## Referensi resmi
- https://developers.cloudflare.com/email-service/
- https://developers.cloudflare.com/email-service/platform/pricing/
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/d1/platform/pricing/
