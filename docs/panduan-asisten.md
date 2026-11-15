# Panduan asisten (aturan jawaban)

Asisten di Forecast Desk menjawab dengan aturan tetap di browser, tanpa model bahasa. Model bahasa (Claude lewat claude.ai,
atau Workers AI di situs Cloudflare) hanya dipakai untuk pertanyaan bebas yang tidak tertangkap aturan, dan diberi fakta
dari aturan yang sama: ringkasan SKU yang sedang dibahas, backtest buffernya, dan isi panduan ini.

## SKU yang sedang dibahas

Klik sel **Sinyal**, tombol **Pelajari histori**, atau tulis `kenapa forecast <Nomat>`. SKU itu menjadi konteks percakapan,
jadi pertanyaan lanjutan tidak perlu menyebut Nomat lagi.

| Pertanyaan (kata kunci) | Jawaban |
| --- | --- |
| histori, riwayat, ringkas, "kenapa forecast …" | 1) Tabel 6 closing terakhir: order in, Forecast HQ, Forecast AI uji mundur (hijau ≤ 10% meleset, merah ≥ 30%), akurasi HQ vs AI, berapa bulan AI lebih dekat, bias HQ, tren order in. 2) Forecast AI M+1 per model: nilai, bobot, akurasi uji mundur, dan alasannya (Holt = level + arah order in; HQ terkoreksi = HQ × rasio bias; Regressor = pola semua SKU + fitur terpenting; Chronos = rentang P10–P90). 3) Dibanding HQ: mana yang lebih dekat ke order in terakhir. Sugesti. |
| beda, dibanding, vs, lebih tinggi/rendah | Selisih HQ vs AI M+1, bias HQ 6 closing, tren order in, hitungan HQ terkoreksi. ≥ 20% → layak ditandai tinjau; 10–20% → pantau minggu 1. |
| model, bobot, paling akurat | Akurasi uji mundur tiap model, HQ dan ensemble untuk SKU itu (tanpa SKU: semua SKU). |
| tren, naik, turun | Order in 6 bulan terakhir, rata-rata 3 bulan vs 3 bulan sebelumnya. |
| buffer, strategi, menang, backtest | Strategi sekarang dan alasannya, tabel backtest per bulan (✓ tertutup, 🏆 biaya terkecil), "Defensif menang 5 dari 6 bulan", skor tiap strategi, dan tombol **Terapkan** bila strategi lain jelas lebih sering menang. |
| harus, sebaiknya, langkah | Langkah untuk SKU itu: pelajari histori, konfirmasi ke HQ, tandai tinjau, ganti strategi, produksi awal bulan. |
| tandai, tinjau | Usul menandai SKU untuk ditinjau di Saran buffer (setelah Terapkan). |

## Tanpa SKU

| Pertanyaan | Jawaban |
| --- | --- |
| rekomendasi buffer | Utas rekomendasi: SKU yang ditandai dari Forecast, SKU yang strategi lainnya lebih sering menang (dengan Terapkan), stok di bawah buffer. Diposting sendiri saat Saran buffer dibuka bila ada rekomendasi. |
| arti strategi \<nama\> | Arti, cocok untuk, risiko, dan angka backtest semua SKU. |
| apa itu / arti \<istilah\> | Definisi dari daftar: sinyal, sugesti, SKU vital, tandai tinjau, skor buffer, backtest, P50/P90, ensemble, Holt, HQ terkoreksi, Regressor, Chronos, fokus/sorot. |
| sku vital | Daftar SKU vital dengan alasan dan sarannya. |

## Aturan angka

- **SKU vital**: diurutkan menurut bagian dari total |Forecast HQ − order in| 3 closing terakhir; diambil sampai 60% dari total
  (maks. 8, masing-masing ≥ 5%), ditambah SKU ≥ 2% volume M+1 yang HQ dan AI-nya beda ≥ 20% atau tanpa HQ.
  Saran **pelajari histori** bila CV order in > 0,7, Nomat pernah berubah, kelas HQ beda dengan volume, atau order in < 3 bulan;
  selain itu **tandai tinjau**.
- **Skor buffer** = 1 − (w × kurang + lebih) ÷ order in, w = 2 (bawaan) atau 3 (pengaturan "Kurang dihitung"). Ditampilkan
  bersama **Tertutup** (% SKU-bulan forecast + buffer ≥ order in) dan **Lebih** (karton). Skor simetris selalu memilih buffer
  mendekati nol, jadi tidak dipakai.
- **Menang**: di tiap bulan backtest, strategi dengan biaya w × kurang + lebih terkecil.
- **Rekomendasi ganti strategi**: ≥ 3 bulan backtest, strategi lain menang ≥ separuh bulan dan lebih sering dari strategi
  sekarang, skornya ≥ 3 poin lebih baik, dan strategi SKU itu tidak dipilih manual.

## Sorot dan suara

Tombol **👁 Tunjukkan** di alert menggulir ke sel yang dimaksud, meredupkan sisanya, dan mata asisten terbang ke sel itu.
Saat sebuah halaman dibuka pertama kali setelah data dimuat, asisten menunjukkan alert teratas sendiri. Teks asisten muncul
seperti diketik. Keduanya bisa dimatikan di ⚙ Pengaturan → Asisten.

## Menyelesaikan peringatan

- Asisten hanya mengatakan langkah berikutnya dengan alasan singkat: "Tolong tandai X untuk ditinjau di buffer, karena …",
  "Cek historinya dulu, karena …", atau "Tolong cek angkanya; bila benar, klik Sudah dicek".
- ✓ Sudah dicek menandai alert (kunci: halaman + judul + bulan terakhir) dan menyimpannya di browser. Batalkan mengembalikannya.
- Terima dan lanjut = semua peringatan merah/kuning di halaman itu dianggap sudah dicek.

## Pertanyaan P50/P90

- Ensemble memberi satu angka, jadi P50/P90 diambil dari sumber lain: Chronos (P10/P50/P90 dari CSV), Regressor kuantil
  (pohon yang sama dengan Regressor, P90 dilatih dengan pinball loss τ = 0,9), atau error historis forecast dasar
  (sebaran order in ÷ forecast 6 bulan, dikali forecast; bila kurang, dari kelasnya).
- Bandingkan dengan: buffer dan rencana produksi dihitung ulang memakai forecast kedua dan ditampilkan berdampingan.
