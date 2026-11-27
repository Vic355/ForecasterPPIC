# ForecasterPPIC

PPIC Decision Support System for The Univenus Serang (plan 7079). PPIC Forecast Desk is its monthly view: extract the monthly closing report into tables that feed the ML forecast.

**Documentation:** [docs/sistem.md](docs/sistem.md) explains how the parts fit together (flow, models, buffer, storage);
[CHANGELOG.md](CHANGELOG.md) lists the changes over time. The sections below describe each screen in detail.

## Where things are (folder tree)

Everything the browser runs is in `public/`. Each screen is one HTML file with its own CSS and JavaScript inside it; there
is no build step. The screens of the monthly flow all live in `public/index.html`, as `<div class="tabpage">` blocks drawn
by one `render…` function each (search the file for the names below).

```
ForecasterPPIC/
├── public/                      what the browser loads (served by the Cloudflare Worker)
│   ├── index.html               Forecast Desk: the monthly flow, all in one file
│   │     header + step tabs       d10Render, d10Ico (step icons), D10_SN (step names)
│   │     side panel               d10Panel: Alerts / Tanya, and the Planner on Rencana produksi (ppSkuPanel, ppBalCard)
│   │     Input data               #tabInput (+ #mmPanel, #secMesin inside it)
│   │     Material master          #mmPanel, renderMat; OI / Forecast history dialog: mmHist; status filter: MMSF
│   │     Forecast                 #tabForecast, renderForecastScreen; models: forecastModel, runML; run bar: FCRUN
│   │     Saran buffer             #tabBuffer, renderBuffer; monthly totals strip: renderBfHz
│   │     Rencana produksi         #tabPlan, renderPlan; calendar grid: renderPlanGrid; Tampilan Excel: ppXlDraw;
│   │                              schedule model (bars, daily targets, skipped days): schedModel
│   │     Dashboard                d10Brief (header button ▦ Dashboard)
│   ├── tabel.js                 Kolom ▾ menu shared by all wide tables: lock (freeze) and hide columns
│   ├── produksi/index.html      Perencanaan Produksi: daily plan, actual (GR gudang), Monitoring = Balance produksi
│   ├── mrp/index.html           MRP Bahan Baku: raw material orders from Saran buffer
│   └── riwayat/index.html       Riwayat versi: what changed, in Indonesian
├── src/index.js                 Cloudflare Worker: serves public/ and /api/ask (assistant)
├── ingest/                      Python: batch loader for closing files, Chronos forecast
├── docs/sistem.md               how the parts fit together
├── CHANGELOG.md                 changes over time
└── wrangler.jsonc               Worker config
```

## Web app

`public/index.html` is a guided monthly flow (Desain 10, PR #8). The app opens on **Input data**; the numbered steps open
after **Terima dan lanjut** on the previous one:

- **Input data** (first screen, a group rather than a step): inputs in three groups, *Penjualan & forecast* (closings,
  Forecast HQ, Chronos CSV), *Stok & kelas SKU* (Stock Level Check) and *Master data* (material master, **Master mesin**).
  See *Input tab* below.
- **Dashboard** (was Ringkasan; a header button ▦ Dashboard, not a step): key numbers, order in vs Forecast HQ / Forecast AI per month (hover for values, table
  view), the biggest brand · category groups for M+1, stock vs buffer, plan vs machine capacity, SKU status, open alerts.

1. **Material master** (with the status rules that were *Cek data SKU*): status per SKU, Jenis SKU, Nomat changes,
   order in and HQ history.
2. **Forecast**: Forecast HQ vs order in, HQ accuracy, bias, and **Forecast AI** (ensemble of four models) for M+1..M+3.
   Clicking a card opens a chart of that measure with the SKUs behind it.
3. **Saran buffer**: buffer per SKU and PP.
4. **Rencana produksi**: schedule per machine and day. The flow ends here; the daily plan is the separate
   **Perencanaan Produksi** page (`/produksi/`, see below). Raw material orders are planned on the **MRP Bahan Baku**
   page (`/mrp/`), opened from Saran buffer.

SKUs are keyed by **Nomat** (nomor material). Article Code is kept alongside, used to look up the HQ class, and used as the
key only when a row has no Nomat (flagged "Tanpa Nomat"). Closing and forecast are joined by Nomat, then by Article Code.

## Cek Data SKU (status rules)

Closing sheets are not standardised, so every SKU gets a status before anything is counted:
**Aktif**, **Perlu cek**, **Diskontinu** or **Diganti** (replaced by another SKU). Diskontinu and Diganti are left out
of totals, accuracy and the ML; a replaced SKU's order in is added to its successor's history for the ML.

| Rule | Gives |
| --- | --- |
| Stock > 0, no Forecast HQ (REV/ORIG in the latest closing, none in M+1) | Diskontinu if order in was 0 for N months, else Perlu cek |
| Code / Nomat / name red (font or fill) or struck through in the .xlsx | Diskontinu (read from styles.xml; .xls not supported) |
| Keyword in the name (editable list: disc, old, stop, tidak produksi, …) | Perlu cek |
| Flagged SKU within N rows of an active SKU with a similar name or near-identical article code | Diganti → that SKU |
| Brand at the start of the name matches another family, not its own | Perlu cek (only when families are brands) |
| HQ and order in more than N× apart, or HQ with zero orders for N months | Perlu cek |

Rules can be switched off and their numbers changed; any SKU can be set by hand. Settings and manual statuses are stored
in the browser and in the history workbook (sheets `status_sku` and `aturan`), and are restored when it is uploaded again.
**Groups = brand + family.** When a closing family holds several brands (Paseo, Jolly, Nice, …), each brand gets its own group, e.g. *Paseo · Facial Soft Pack* and *Jolly · Facial Soft Pack*, and groups of the same brand sit together. The brand comes from the Forecast HQ *Brand* column, or from the first word of the SKU name when that word is a known brand. When the family is already the brand, nothing changes. This applies to Forecast, Saran Buffer (an old per-family strategy still applies to its brand groups), Cek Data SKU and the Rencana Produksi family filter.

The Forecast table can show all SKUs per family and the excluded ones (greyed). The realised side uses **Forecast HQ REV**
(ORIG only when REV is empty); the accuracy card and chart also show ORIG.

## Editing in the Forecast table

Free stock, Order in, Forecast HQ REV (closing months) and Forecast HQ M+1..M+3 cells can be edited like Excel: double-click
or just type, Enter/Tab to move on, arrows to move, Esc to cancel, Delete to empty, Ctrl+Z to undo (Ctrl+Y to redo). Edited cells are marked
yellow with the file value in the tooltip. The file's values are never overwritten: corrections are kept separately
(browser + sheet `koreksi` in the history workbook, listed with a revert button under Cek Data SKU) and applied on top for
totals, accuracy and the ML. The status chip under each SKU name opens a menu to set Aktif / Perlu cek / Diskontinu /
Diganti oleh … without leaving the table.

## Forecast ML (v2: four models + ensemble)

Full write-up with a diagram: the "Forecast Desk: model architecture" doc in the project. In short, per SKU (Nomat):

| Model | Runs | What it is |
| --- | --- | --- |
| Holt | browser | level + damped trend on monthly order in (alpha 0.5, beta 0.3, damping 0.8), floored at 0 |
| HQ terkoreksi | browser | Forecast HQ × the SKU's order-in ÷ HQ ratio over its last 3 closings, shrunk to the all-SKU ratio, clamped 0.3–3 |
| Regressor | browser | gradient-boosted trees (80 trees, depth 3, histogram splits, log1p target), one model for all SKUs, one per horizon. Features: order in t-1..t-3, 3-month mean, Forecast HQ for the target month, HQ bias ratio, corrected HQ, category mean, calendar month, months of history. Needs ≥12 SKU-month rows. |
| Chronos | your computer | `ingest/forecast_chronos.py` (Chronos-2 with Forecast HQ as covariate by default, or Chronos-Bolt). Its CSV is dropped onto the page and saved in the history file (sheet `forecast_chronos`). |

**Ensemble** = weighted average; weight ∝ 1 / (WAPE + 0.05)², WAPE from that model's one-month-ahead backtest for the
SKU, pulled toward the category's and all SKUs' WAPE when the SKU has few months, then toward equal weights. Models with no
output for a SKU are left out. The backtest is walk-forward: every closing month is predicted only from earlier months,
weights included. The Kinerja ML card and its chart compare HQ, each model and the ensemble; hovering a Forecast ML cell
shows each model's number and weight. Saran Buffer can use the ensemble, the regressor or Chronos as its basis.
The downloaded history gets a `forecast_ml` sheet with every model, its weight and the Chronos P10/P90.

### Running Chronos (once a month, after closing)

    pip install -r ingest/requirements-chronos.txt     # once; CPU-only PyTorch: see the file
    python ingest/forecast_chronos.py Histori_Serang_7079_....ppic.gz      # writes forecast_chronos.csv

Then drop `forecast_chronos.csv` onto the page. `--model amazon/chronos-bolt-base` is lighter; `--model naive` tests the flow
without downloading a model.

## Input tab (web)

The **Input Data & Model** tab is served by a Cloudflare Worker (`wrangler.jsonc`). Everything runs in the browser; files are not uploaded anywhere.

Three inputs:

1. **Histori closing** (required): one "Daily Report Prod & Sales Closing" file per month, several at once. The month is read from the file name (e.g. `AUG26`) and can be edited. A previously downloaded `Histori_Serang_*.xlsx` can be added to continue it.
2. **Forecast HQ M+1 – M+3** (required): one "Summary Forecast <Mon YYYY>" file per month (e.g. `11. Sales Forecast Nov26 adj - TUB`). Taken per SKU: Qty (ctn), W1–W4 and the per-zone split in cartons (ton columns skipped). The version (original / adj) comes from the file name; one row set is kept per month and version.
3. **Kelas SKU** (optional): built in from the Stock Level Check of 21 Oct 2026; upload a newer Stock Level Check only to replace it.

**Unduh Histori_Serang.xlsx** writes one workbook with sheets `bulanan` (one row per SKU per closing month), `mingguan` (W1–W5),
`forecast_hq`, `kelas_sku` and `log`. Re-uploading a month replaces that month and is noted in `log`.

## Usability (Nov 2026)

- **Undo / redo everywhere**: ↶ Urungkan / ↷ Ulangi in the header, or Ctrl+Z and Ctrl+Y (Ctrl+Shift+Z). Covers every manual
  change: corrections, SKU statuses, rules, buffer edits and strategies, machines, capacities, the production schedule,
  material master and grouping. Uploading files is not undone. Inside a text box Ctrl+Z stays the browser's own text undo.
- **Card lists that lead somewhere**: every Forecast card chart now lists all SKUs behind it (searchable), not only the top 8.
  Clicking a row closes the chart and opens that SKU's cell in the Forecast table (family opened, "Semua SKU" or excluded rows
  switched on when needed, the cell highlighted). *SKU tanpa Forecast HQ* also shows which forecast months are empty.
- **Drop files anywhere**: drag files onto any tab; the kind is detected (history .xlsx / .ppic.gz, material master, Forecast HQ,
  Stock Level Check, production data, otherwise closing). The slots in the Input tab still take their own kind.
- **Search**: Forecast and Saran Buffer have a search box (Nomat, name, article code, brand, category; old Nomat too).
- **Material master** (Input tab, optional Excel): columns found by header (Nomat / Material, Article Code, Description, Brand,
  Category, Family, Status, Nomat pengganti, Catatan). The table joins it with the SKUs in closing and Forecast HQ: status
  active / inactive (from the master; without one, active = Forecast HQ M+1..M+3 or order in in the last 3 closings), and flags
  for a changed Nomat (same article code, other Nomat in the master, in another closing month or in Forecast HQ), a different
  name, SKUs missing from the master and master rows not in the data. Status and Nomat pengganti can be changed in the table;
  *inactive* feeds the new rule **Nonaktif di material master** (→ Diskontinu, or Diganti when a successor is given).
  "Unduh material master" exports the table as Excel, which can be edited and uploaded again. Stored in the browser and in
  sheet `material_master` of the history file.
- **Brand · Category grouping**: Brand and Category from the Forecast HQ file (both optional) or the material master replace the
  closing family as the group in Forecast, Saran Buffer and the plan filter. SKUs without a category keep Brand · Family.
  A switch next to the search box goes back to Brand · Family for everything.
- **Compact history (.ppic.gz)**: same content as Histori_Serang.xlsx (every sheet), stored as columns and gzip-compressed in the
  browser; the sample is ~13 KB against ~390 KB for the Excel. Upload or drop it like the Excel to continue.

## Small screens and large data (Nov 2026)

- **Top bar size**: *Pengaturan → Bagian atas* has Otomatis (default), Penuh, Ringkas and Sembunyi. Otomatis makes the header and
  step bar compact (about 80 px instead of 130 px) when the window is shorter than 820 px, which covers 1366×768 laptops and
  Windows scaling of 125–150 %. The ⌃ button in the header hides both and leaves a 26 px strip with the current step and
  *Tampilkan langkah & pencarian*; Ctrl K still opens the search. The choice is saved in the browser.
- **Regressor in the background**: training the regressor (gradient-boosted trees) was the step that froze the page, for
  5–15 s on a 600–1,200-SKU, two-year history and again after every order-in or HQ edit. It now runs in a Web Worker, and the
  training itself is about 1.5–2× faster (typed arrays, same trees and the same numbers to the last digit). Until it is done
  the ensemble uses the other models, or the previous regressor result for the same months after an edit; a small
  *Model Regressor dihitung di latar…* badge shows meanwhile and the page redraws itself when it finishes. Excel / .ppic.gz
  downloads wait for it. Browsers without Workers train inline as before.
- **Loading overlay and error banner**: loading files or the demo shows *Memuat dan menghitung data…*; page changes that take a
  while show *Membuka halaman…*. A script error no longer leaves a half-drawn page: a banner shows the message with
  *Muat ulang* and *Tutup*, and data stays in the browser. A history file that fails to unpack, or a file the browser cannot
  read, now shows *gagal dibaca* instead of leaving "Membaca 1 file…" forever.
- **Rencana produksi day grid** is drawn only while that page is open (it was the slowest part of every redraw).

## Deploy (Cloudflare Worker)

```
npx wrangler login
npx wrangler deploy        # -> https://ppic-forecast-desk.<your-subdomain>.workers.dev
```

Or connect this repo in the Cloudflare dashboard (Workers & Pages → Create → Import a repository) to deploy on every push.

The Worker (`src/index.js`) serves `./public` and `/api/ask` for the Asisten. `wrangler.jsonc` binds Workers AI as `AI`; no API key is needed.

## Fields taken (Serang SKU sheet, cartons)

| Field | Report header | Used for |
| --- | --- | --- |
| nomat | NOMAT / Nomor Material | **primary SKU key** |
| article_code | Article Code | HQ class lookup; key only when Nomat is missing |
| description | Description | name, edition/promo flags |
| family | category heading row | family rows |
| net_weight_kg | Nett Weight | cartons → tonnes |
| buffer_suggestion | Buffer Suggestion | current buffer |
| opening_stock, stock_on_hand, free_stock, sc_ready_stock | stock columns | stock, buffer |
| planning_prod, actual_tp_to_wh, balance_prod | production columns | plan vs actual |
| forecast_hq_orig, forecast_hq_rev | Sales Forecast (ORIG / REV) | Forecast HQ, stored as received |
| inquiry_sdd | INQ.Ord (SDD) | ML feature |
| order_in | Order In | ML target |
| delivery_gi, outstanding_delivery | Delivery (GI), Outs. Delivery | fulfilment |
| sc_block, waiting_prod | SC Block, Waiting Prod. | ML features |
| gap_vs_forecast | gap column | quality check |
| weekly W1–W5 | weekly table right of the main one: OI, GI, OS, GAP OS vs SOH | order timing |
| order_in_week_total | Total column of the OI block | check: W1–W5 = Total = Order In (not Inquiry) |
| uom | sheet name: CT = carton, MT = metric ton (MT sheets are not loaded) | unit |

If the weekly table has its own Nomat / Article Code column, its rows are joined by that key instead of by row position.
Month names on the week headers (JUL/APR on an AUG report) are ignored.

## Batch loader (Python)

`ingest/ingest_closing.py` does the same extraction and appends each closing to an append-only SQLite store
with a snapshot date (never overwriting), and also reads old (red/strikethrough) codes. Rows are keyed by `sku_id`
(Nomat, or Article Code when Nomat is missing). It does not yet read the Summary Forecast files or a weekly table with its own key column.

```
python ingest/ingest_closing.py inspect REPORT.xlsx --plant 7079
python ingest/ingest_closing.py load    REPORT.xlsx --plant 7079 --closing 2026-08 --db ppic.sqlite
python ingest/ingest_closing.py export  --db ppic.sqlite --out exports/
```

## Built-in reference data

| File | What | Source |
| --- | --- | --- |
| `data/sku_class_hq.csv` | 356 SKUs: Pareto type, HQ class (A / B / C / NPD), DOI target days | Stock Level Check, 21 Oct 2026 |
| `data/stock_level_2026-10-21.csv` | Per SKU in cartons: avg sales L3M and stock target (all mills), Serang (TUB) SOH and sisa PP, all-mill SOH, OS, forecast, PO, status | same report |

HQ class is reference only: A = Pareto (DOI target 15 days), B and C = Non Pareto (30 days), NPD = new product (45 days).
The input tab shows each SKU's HQ class and DOI target and flags SKUs missing from the list.

## Saran Buffer

Tab **Saran Buffer** menghitung buffer per SKU untuk bulan forecast pertama setelah closing terakhir:

- Buffer = z × sebaran error × forecast × √(lead time ÷ 30) × faktor strategi. z: 90% = 1,28, 95% = 1,64, 98% = 2,05.
- Sebaran error per famili dari 6 closing terakhir (×1,4 di level SKU); 25% bila histori kurang dari 2 bulan.
- Rencana produksi = forecast + buffer final − stok bebas.
- Dasar forecast bisa Forecast HQ (bawaan, karena ML masih mode bayangan), Forecast ML atau rata-rata keduanya. Service level dan lead time (7/14/21 hari) bisa diganti di atas tabel.
- Strategi per famili atau SKU: Standar, Defensif, Ikuti tren, Batas atas (≤ 10 hari), Kuantil P90, Habiskan stok. Bila tidak dipilih, strategi dipilih otomatis dan alasannya tampil di tombol status.

### Asisten yang lebih menonjol

- **Sorot**: tombol 👁 Tunjukkan di tiap alert (panel kiri dan pita atas) menggulir ke sel penyebabnya, meredupkan sisanya, dan
  mata asisten terbang ke sel itu dengan penjelasan. Halaman yang pertama dibuka setelah data dimuat menunjukkan alert teratasnya
  sendiri. Pupil mata tetap diam. Matikan di ⚙ Pengaturan → Asisten → Sorot & redupkan.
- **Asisten berbicara**: teks pita alert, jawaban obrolan dan gelembung di bawah halaman muncul seperti diketik; asisten
  berkomentar saat data dimuat, saat pengaturan buffer, strategi, atau model Forecast AI diganti. Matikan di ⚙ Pengaturan.
- **Forecast · SKU vital**: panel *Sugesti Utama AI* (dulu *Fokus AI*; di panel samping, tab Alerts halaman Forecast; tersembunyi di awal, buka dengan *Tampilkan ▾*) berisi SKU yang paling menentukan akurasi forecast, dengan saran *tandai tinjau*
  atau *pelajari histori*. Tanda tinjau dibawa ke Saran buffer (⚑ di baris, famili terbuka sendiri, kartu *Ditandai untuk
  ditinjau*), disimpan di browser dan di lembar `saran_buffer` (kolom `tinjau`). Filter *Hanya SKU vital ⚑* di tabel.
- **Sinyal → Tanya**: klik sel Sinyal membuka tab Tanya dengan ringkasan histori forecast SKU itu dan alasan Forecast AI per
  model; pertanyaan lanjutan dijawab dengan aturan di [docs/panduan-asisten.md](docs/panduan-asisten.md).
- **Saran buffer**: panel *Arti strategi buffer* menjelaskan tiap strategi dengan kata biasa beserta angka backtestnya; skor
  buffer kini asimetris (kurang ×2 atau ×3, pengaturan *Kurang dihitung*); kolom Strategi menampilkan "🏆 Defensif menang 5 dari
  6 bulan"; kartu *Rekomendasi AI* dan utas rekomendasi di Tanya, dengan tombol Terapkan.
- **Menyelesaikan peringatan**: tiap alert punya ✓ *Sudah dicek* (juga di pita atas dan gelembung sorot); alert yang sudah dicek
  turun ke bawah dan abu-abu, bisa *Batalkan*. Alert SKU vital punya ⚑ *Tandai*. *Terima dan lanjut* = semua peringatan halaman
  itu diterima apa adanya. Asisten hanya menyebut langkah berikutnya: "Tolong tandai X untuk ditinjau di buffer, karena …".
- **Sumber P50/P90 dan Bandingkan**: P50/P90 tidak berasal dari Ensemble (Ensemble hanya satu angka). Pilihan *P50/P90 dari*:
  Otomatis, Chronos, Regressor kuantil, atau Error historis forecast dasar. *Bandingkan dengan* menghitung buffer dan rencana
  produksi kedua dari forecast lain (HQ, Ensemble AI, Chronos, Rata-rata) dalam kolom biru di tabel, plus kartu skor A vs B.

### Strategi otomatis (backtest), Kuantil P90 dan kelas ABC-XYZ

- **Backtest picker.** Setiap closing, kelima strategi (tanpa Habiskan stok) diputar ulang di 6 closing terakhir. Tiap bulan hanya memakai data sebelum bulan itu, lalu dibandingkan dengan order in aktual. Skor = (2 × kurang + lebih) ÷ order in, karena kekurangan lebih mahal daripada kelebihan. Skor SKU ditarik ke skor kelas ABC-XYZ-nya bila bulannya sedikit (k = 2). SKU tanpa histori memakai pemenang kelasnya. Bila histori kurang dari 3 closing, aturan lama yang dipakai (HQ di bawah order in → Defensif, perubahan order in ≥ 15% → Ikuti tren). Nama edisi/promo tetap Habiskan stok.
- **Skor buffer** (kartu di tab Saran Buffer) = 1 − (w × kurang + lebih) ÷ order in, w = 2 atau 3, dengan forecast + buffer dibandingkan order in. **Tertutup** = % SKU-bulan dengan forecast + buffer ≥ order in. Baris *Otomatis* dihitung walk-forward: pilihan tiap bulan hanya dari bulan sebelumnya, jadi tidak curang.
- **Kuantil P90.** Buffer = max(0, P50 − forecast dasar) + (P90 − P50) × z ÷ 1,28 × √(lead time ÷ 30). Sumber P50/P90 (yang pertama ada): Chronos (CSV) → regressor kuantil di browser (gradient boosting dengan pinball loss τ = 0,9) → rasio order in ÷ forecast SKU itu 6 bulan terakhir (minimal 4 bulan) → rasio yang sama dari seluruh kelas ABC-XYZ-nya → rumus Standar.
- **Kelas ABC-XYZ** dihitung ulang tiap closing dari order in 6 closing terakhir. ABC: A = SKU yang membentuk 80% pertama volume, B = 15% berikutnya, C = sisanya. XYZ: CV order in bulanan < 0,5 = X, 0,5–1 = Y, > 1 = Z. Kurang dari 3 bulan order in = NPD. Kelas HQ (Stock Level Check) tetap tampil sebagai referensi dan ditandai *beda* bila HQ A tetapi volume C, atau HQ bukan A tetapi volume A. CV juga menjadi fitur Regressor.
- Lembar `saran_buffer` di unduhan Histori menambah kolom `strategi_alasan`, `kelas_abc_xyz`, `cv_order_in`, `kelas_hq`, `p50`, `p90`, `sumber_p90`.
- **Bahan baku**: kolom Karton (pcs), Plastik (ton), Jumbo roll (ton) dan Deskripsi BOM = rencana produksi × BOM per karton. BOM diisi
  per SKU di Material master (masih kosong, jadi tampil –); tombol *Sembunyikan bahan baku* menyembunyikan semua kolom ini.
- **Proyeksi buffer per bulan (M+1–M+3)**: stok akhir M+1 = stok awal + PP − forecast, lalu menjadi stok awal M+2 yang dihitung
  buffer-nya sendiri (strategi yang sama, forecast bulan itu) dan PP = forecast + buffer − stok awal; begitu juga M+3. Tabel
  ringkas di atasnya memberi PP (karton, ton) dan kebutuhan bahan baku per bulan untuk pesanan bahan baku.
- Buffer final bisa diubah manual dengan alasan wajib. Perubahan dan strategi manual disimpan di browser dan di lembar `saran_buffer` file Histori_Serang, lalu dibaca kembali saat file itu diunggah.

Tab order: Forecast, Saran Buffer, Rencana Produksi, Cek Data SKU, Input Data & Model. The Saran Buffer cards (buffer final, rencana produksi, bahan baku dummy, stok di bawah buffer, akurasi buffer, kelas ABC-XYZ, tanpa produksi) each open a list.

## Rencana Produksi (mockup)

**Otomatis atau manual.** Halaman kosong menawarkan **▶ Jalankan jadwal otomatis** atau **✎ Susun manual**. *Cara menjadwal*
Otomatis = model menjadwalkan semua SKU yang belum diatur sendiri (ikut berubah bila PP berubah); Manual = hanya bar yang ditaruh
sendiri. SKU dengan PP tanpa bar tampil **merah** di bawah area mesinnya (*Belum terjadwal di …*, tombol *Tempatkan di mesin…*),
SKU tanpa area mesin merah di grup *Belum dipetakan ke area mesin*. **▶ Jalankan jadwal otomatis** (menggantikan *Kembalikan
jadwal otomatis*) mengisi yang belum terjadwal, atau menyusun ulang dari nol.

**Lampu peringatan.** Semua ambang dan warna lampu merah / kuning / hijau ada di satu blok `LAMPU` di `public/index.html`
(baris 1037–1058). Ubah angka di sana, simpan, muat ulang.

The plan is made at the start of the month, so there is **one plan month: closing + 1** (the same month as Saran Buffer). PP = forecast + buffer final − stok bebas (from Saran Buffer). Stok bebas = stock on hand − outstanding DN − SC block.

- **Five cards**, each opens a list (click a row to jump to the SKU): PP total, Stok habis sebelum produksi (free stock runs out before the SKU's first bar starts, or it has no bar), Belum terjadwal, Jadwal perlu dicek (past month end, clash, daily target above machine capacity, targets ≠ PP), Mesin belum pasti (machine type guessed from the name).
- **One flat table** in the page (no inner scroll box; the plan tab uses the full window width): machine type › machine (bars) › SKU (daily targets). Columns: stok bebas, forecast, buffer, PP, production days, then one column per calendar day (plus overflow days of the next month when a bar runs past month end).
- **Prioritas vs stok habis.** An SKU whose free stock is below this month's forecast is tagged *Prioritas*: it only means the auto schedule places it first. It turns red (bar, chip *Stok habis tgl N*, card) only when its stock runs out (day floor(cover) + 1) before its first production day.
- **Auto schedule**: prioritas first, then fewest days of cover, then biggest PP; each SKU goes to the machine of its type with the earliest free stretch; it continues on another machine when the month is full, and only then runs past month end. Machine speed = capacity ÷ working days of the month, or the SKU's own speed (template). Bar length = tonnes ÷ speed.
- **Calendar editing**: drag a bar to move it (another day or another machine row), drag its right edge to change its length, click it for a short card (🗑 Hapus bar at the top, then machine, start, length, fit to speed; SKU details and split/insert are folded away). The card never runs off the screen: it opens above the bar when there is no room below, scrolls inside itself, and follows the bar while the page scrolls. Delete on a focused bar removes it. While dragging to another machine the bar follows the pointer and the target row is outlined; the table keeps its layout. Arrow keys move a focused bar, Shift+arrows resize. Double-click an empty day on a machine to put an SKU there or mark maintenance; click a date header to mark a holiday for all machines; "Minggu libur" makes Sundays off.
- **The plan stays in its month; bars follow the target.** Nothing is scheduled past month end. Each bar is as long as the target needs at the machine's output; when the free stretch is too short the SKU gets another bar in the next free stretch (or on another machine of its area). What still does not fit in the month stays on the SKU's bars as daily targets above capacity (amber warning). Dropping an SKU (from the planner panel) or dragging a bar onto another SKU's bar inserts it there, A → B → A: that bar is cut and the rest of the machine moves later by the inserted length.
- **Above capacity is allowed.** An SKU counts as covered when its daily targets add up to its PP, even when that is above the machine output; the planner panel shows ✓⚠ with the cartons above output, and *Jadwal perlu dicek* lists it as an amber warning (overtime), never red. Dragging such an SKU onto a machine again adds a bar sized for the excess.
- **PP, Rencana, Sisa.** PP CT is the SKU's target for the month (Saran Buffer, or typed over); it no longer follows the bars. Every bar has its own **Rencana** (cartons it should produce on that machine). Rencana of an SKU = sum of its bars, Sisa = PP − Rencana. Dropping an SKU on a machine opens the bar's card with *Rencana di mesin ini* (default: the remaining Sisa); the bar length follows the machine's output (Rencana ÷ ct/day). The per-bar Rencana cell in the grid can be typed over (double-click, Enter or a digit). Resizing a bar sets its Rencana to what fits.
- **Shadow past month end.** When a bar's Rencana needs more days than the month has left, a hatched shadow shows the extra days after the month. It is display only: the cartons still count in this month.
- **Top of the page**: a small *Sisa* chip (cartons still unplanned, SKUs planned / SKUs with PP) and **Kirim ke Perencanaan Produksi ↗**. The summary cards and the Otomatis/Manual switch are gone; alerts still say what is missing or not scheduled. **⚡ Automate** schedules what is not yet placed (or rebuilds from scratch).
- **Tampilan Excel**: No, Mesin, SKU, PP and Rencana stay frozen while scrolling the days. PP and Rencana (per machine) can be changed by double-click; a new Rencana resizes that SKU's bars on the machine. × (on hover) removes the SKU from that machine. Typing a number in an empty day next to a bar adds that day and its cartons to the Rencana.
- **Reset…** opens three choices: reset this month from scratch (empty plan and remove this month's bars, daily targets, PP targets and manual holidays/maintenance), only empty the plan (manual changes stay and come back), or remove every manual change of all months (also SKU machine areas and capacity edits). All can be undone with ↶.
- **PP target vs PP rencana.** Target = PP from Saran Buffer (forecast + buffer − stok bebas); it can be typed over in the plan (double-click). Rencana = the sum of the SKU's daily targets on the schedule, i.e. the planned output; machine rows show their planned output (cartons and tonnes), type and total rows show target vs rencana with the difference.
- **No mockup with real data.** The sample machines and the MOCKUP label only appear with the built-in sample data. With real data, every machine in the machine list is shown with its type. A machine without capacity gets an empty row and is never used by the automatic plan, though SKUs can still be placed on it by hand. An SKU whose machine type is only guessed from its name is not scheduled automatically; it waits under *Belum terjadwal* until a Kelompok SKU matches it or a type is picked in the table.
- **Frozen panes, like Excel.** The table scrolls sideways inside its own box, with the horizontal scrollbar pinned to the bottom of the screen. The SKU, Target, Rencana and Hari columns stay put when it scrolls left or right, and the date header row stays at the top while the page scrolls down. The page keeps one vertical scrollbar.
- **Target and rencana.** The target comes from Saran Buffer and can be typed over (it then stops following Saran Buffer; Delete returns it). The rencana is not typed: it is always the SKU's total in the jadwal (the sum of its daily targets on all its bars), and the cell shows ⚠ with the difference when it doesn't match the target (also listed under "Jadwal perlu dicek").
- **Split bars (A → B → A).** Click a bar, pick the day to split at and optionally an SKU to run in between and for how many days. The second part of the bar and every later bar on that machine move back by that many days. Double-clicking an empty day can also add an SKU as an extra part (its PP is spread over all its parts) instead of moving it. A part can be deleted from the bar menu.
- **Ekspor Excel.** Downloads `Rencana_Produksi_<plant>_<bulan>.xlsx` in the planner's *TUB Planning* layout: **TUB** (per SKU: article code, material, net weight, category, machine, opening stock, Splan, PP, buffer, actual and balance in CT and MT, with the summary block on top), **Hasil** (actual production per day from Perencanaan Produksi), **Machine** (capacity, forecast, planning, gap and realisation per machine, subtotals per machine area, W1–W5 plan/actual), **JR**, **MT** (tons per machine), **SKU** (daily plan per machine × SKU, Sundays and holidays in red), **Capacity**, **BOM** and **Info**. Totals and links between sheets are live Excel formulas. Columns the app has no data for (packaging nomat and stock, JR type, man power) are left empty and listed on Info. Perencanaan Produksi exports the same layout plus a *Rencana + aktual* sheet that can be uploaded again. The workbook is written by `public/rencana-excel.js` without any library.
- **Daily targets** = PP target ÷ the SKU's production days. Double-click (or type into) a target to change it; the SKU's other days rebalance so the total stays at PP. Delete returns a day to automatic.
- Capacity is a reference (average production last month); double-click a machine's capacity cell to change it.
- With sample data and no machine list, a labelled demo machine list is used.

### Data the plan needs (Input → Data rencana produksi)

The Input tab has two editable tables (type in them, or paste a block copied from Excel):

- **Daftar mesin**: jenis mesin, mesin, kapasitas t/bulan, catatan.
- **Kelompok SKU → jenis mesin**: a word or phrase found in the SKU name (e.g. *Soft Pack*, *Travel Pack*) or a brand family name, and the machine type it runs on. The longest matching group wins; the table shows how many active SKUs each group catches and which SKUs are still unmatched. "Isi contoh kelompok" adds a starter list. Machine choice per SKU: manual > per-SKU `sku_mesin` row > kelompok > PP Excel Material/Mesin > guess from the name.

**Calendar**: Indonesian national holidays and cuti bersama for 2026–2027 (SKB 3 Menteri) are built in. Saturdays are working days, Sundays are off ("Minggu libur"), national holidays are off, cuti bersama are working days unless "Cuti bersama libur" is ticked. Click a date to turn a Sunday or holiday into a working day (lembur) or to mark an extra holiday. Saved in `kalender_produksi`.


"Unduh template" gives a workbook pre-filled with what the app already has; fill it and upload it again. The PP Excel (summary tab + Material/Mesin columns) is still accepted.

| Sheet | Columns | Needed |
| --- | --- | --- |
| `mesin` | jenis_mesin, mesin, kapasitas_ton_bulan, catatan | yes |
| `sku_mesin` | material (Nomat), jenis_mesin, mesin_khusus, kecepatan_ton_hari | jenis_mesin yes; a fixed machine and the SKU's real speed are optional |
| `kalender` | tanggal, mesin (blank = all; machine or machine type), jenis (libur/maintenance), catatan | optional |

Net weight per carton comes from the closing. Machine data is never stored in this repository: it stays in the browser and in the user's Histori file.

Histori sheets: `rencana_produksi` (one row per SKU with machine, dates and checks), `jadwal_produksi` (manual bars), `target_harian` (typed targets), `kalender_produksi` (file calendar + manual holidays/maintenance), `sku_mesin`, `kapasitas_mesin`. Loading a Histori file restores all of them.

## Perencanaan Produksi (`/produksi/`)

The daily plan is its own page, not a step of Forecast Desk (the flow ends at step 6, Rencana produksi). Open it from step 6 with **Kirim ke Perencanaan Produksi ↗** (sends this month's schedule, then opens the page), or type *produksi* in the search bar (Ctrl K). The page has a **Forecast Desk | Produksi** switch to go back.

Five steps:

1. **Data masuk**: the plan in use and where it came from. Replace it with an Excel file: one row per SKU per machine (Mesin, Material, Deskripsi, Kategori, Target/hari) and one column per date. Date columns up to "Kolom tanggal s/d ini = aktual" are read as actuals and locked. A file without date columns (only *Rencana (CT)*) is a PP list: the rows start empty and **Isi otomatis** schedules them. A `.prod.gz` backup from Ekspor opens here too.
2. **Rencana**: the grid (Excel-like, frozen columns Target / Aktual / Rencana ke depan / Selisih). Each production run is a **bar**: drag it to another day, or onto another machine of the same type; drag its right edge to change the number of days (total stays the same). Cells can be typed, pasted from Excel, or cleared. Cards above the grid always end in a button: target belum tertutup (Isi otomatis), SKU panas habis stok sebelum diproduksi (Majukan), mesin lewat kapasitas, rencana lebih dari target, lewat akhir bulan.
3. **Aktual**: paste the GR gudang (goods receipt by warehouse) / output column of the day's production report (one column in grid order, or Material + Output), check it against the plan, correct numbers, then save; the day is locked.
4. **Monitoring**: **Balance produksi = rencana produksi − GR gudang** (positive = less received than planned). *Harian*: one date, per machine × SKU, with the day's balance and the cumulative balance since the start of the month, plus a balance-per-day chart (click a bar to open that date). *Bulanan*: up to the last GR date, per SKU, machine or machine type: target, plan to date, GR, balance, remaining plan and projected month end vs target, with cumulative plan vs GR.
5. **Skenario**: "what if" for a rush order or a stopped machine. Options are computed on a copy, ranked by delay and stock-out risk, previewed with changed cells coloured, and applied only on request.

**Rencana produksi, Mode Manual (Forecast Desk step 6).** No suggestions: only machines on the grid (*Tidak ada data mesin* when there is no machine list), and the left panel becomes **SKU untuk dijadwalkan** (filter Perlu dijadwalkan / Cukup / Semua, search, sort by area mesin, stock cover or PP). Each SKU is one compact row (status dot, name, Nomat, PP, what is still short; hover for net weight, stock cover and schedule); clicking a row shows brand/family, category, stock, forecast, buffer, cover days, net weight and output per machine of its area. Drag a row onto a machine row: the bar starts on the first free working day from the drop point and lasts *remaining PP ÷ output per day*; a row that is already fully planned moves. **Sembunyikan ringkasan** hides the summary cards and the alert ribbon above the grid (on by default in Mode Manual). The demo loads sample machines (Master mesin *contoh*), which are removed again when the demo is left. Output per day (cartons) = **kapasitas per hari ÷ berat bersih per karton × variasi output %**. Kapasitas per hari and variasi output come from the Machine Master (`state.machMaster` entry `[alias, capTonPerMonth, remark, { capDayT, outPct }]`; older lists use t/month ÷ working days) and can be changed by double-clicking a machine's capacity cell. Machine names are shown through `machLabel()` when the Machine Master defines it, so aliases stay the stored key.

The assistant sits in a bar above the table; **Alerts** and **Tanya** open as a pop-up over the grid, and *Tunjukkan* dims the page and points at the row.

Data stays in the browser (`localStorage` key `ppic_prod`: `plan` with lines per SKU per machine, `actual` per line and date). Sending a new schedule from Forecast Desk replaces the plan but keeps actuals; if the plan was edited on this page, it asks first. Forecast Desk also sends stock cover (days), forecast per day and ABC-XYZ class per SKU, which the assistant uses to tell which SKUs are "panas", plus PP of SKUs it could not schedule. Without any plan the page shows the November 2026 sample (`contoh-rencana-2026-11.json`), clearly labelled. **Ekspor**: Excel (plan + actuals, plan only, actuals) or a `.prod.gz` backup.

## MRP Bahan Baku (`/mrp/`)

Raw material requirements planning for carton (pcs), plastic (ton) and jumbo roll (ton). Open it from **Saran buffer →
Proyeksi buffer per bulan → Buka MRP bahan baku ↗** (sends PP M+1..M+3 and the BOM per SKU, then opens the page), or type
*mrp* / *bahan baku* in the search bar (Ctrl K). The page has a **Forecast Desk | Produksi | MRP** switch.

**Rule for raw materials: the buffer is the reorder point.** The finished-goods buffer (Saran buffer) is driven by
forecast error; for raw materials the buffer is simply the last point at which an order must be placed:

- Kebutuhan (requirement) = PP per month × BOM per carton (karton pcs, plastik kg ÷ 1000, jumbo roll kg ÷ 1000). PP M+2 and
  M+3 come from the multi-month projection (stok akhir M+1 = stok awal + PP − forecast → stok awal M+2). Month 1 can follow
  the daily schedule of Perencanaan Produksi when it has a plan for that month; otherwise PP is spread over Monday–Saturday.
- Buffer saran = average requirement per day × (lead time + cadangan days). A manual buffer overrides it.
- Daily simulation from the stock date: position = stock + open POs + planned orders. **When the position falls to the
  buffer, an order is released that day**, for buffer + *pesan untuk* N days of requirement − position, rounded up to MOQ
  and multiple, and arrives after the lead time. Stock on hand below zero before the order arrives = *Stok habis* (expedite).
- Each raw material is picked from the SKU's BOM description by keyword (e.g. *5 ply*, *PE 40*, *virgin*); without a match
  the first material of the category is used.

Four steps: **Kebutuhan** (per material with the SKUs behind it), **Stok & PO** (material master: stock, lead time,
cadangan, buffer, MOQ, multiple, keywords; open POs with ETA; Excel import/template), **MRP** (one card per material with
projected stock vs buffer, the reasoning and a weekly table), **Rencana pesan** (order date, quantity, arrival; *Sudah
dipesan* moves an order to open POs). Summary cards with preview graphics on top; the assistant bar has Alerts and Tanya
(`ringkasan`, `pesan minggu ini`, `kenapa KODE`, `buffer KODE = n` / `auto`, free questions via `/api/ask`).
**Ekspor**: Excel with rencana_pesan, mrp_mingguan, kebutuhan_sku, bahan_baku, po_terbuka.

SKUs without a BOM use a sample BOM (karton 1 pcs, jumbo roll ≈ net weight × 1.04, plastik ≈ net weight × 3.5% per
carton), clearly marked and switchable off in ⚙. Without data from Forecast Desk the page uses the November 2026 sample
plan. Storage: `ppic_mrp` (sent by Forecast Desk), `ppic_mrp_rm` (materials, stock, POs, settings).

## Asisten (prototipe)

The **Asisten** button (bottom right, every tab) opens a chat panel.

- **Rules engine (always on, free, instant).** Commands: `pp target <SKU> = n` (or `= otomatis`), `pindah <SKU> ke <mesin> tgl n`, `target <SKU> tgl n = v` (or `= otomatis`), `libur tgl n`, `maintenance <mesin> tgl n`, `buffer <SKU> = n alasan …`, `strategi <SKU|famili X> <strategi>`, `mesin <SKU> = <jenis>`, `status <SKU> <aktif|cek|diskontinu|otomatis>`, `order in|forecast hq|stok <SKU> [bulan] = n`, `kapasitas <mesin> = n`, `undo`. Questions: `ringkasan`, `kenapa <SKU>`, `sku bermasalah`, `jadwal`, `stok di bawah buffer`, `stok berlebih`, `kapasitas`, `selisih terbesar`, `cari <nama>`, `apa itu buffer/pp/target/...`. SKU = Nomat, article code or part of the name.
- Every change is shown as a proposal and applied only after **Terapkan**; it goes through the same stores as manual edits (correction log, reasons) and `undo` reverts it.
- **Free-form questions, nothing to download.** The app picks the first engine available:
  1. **Claude through claude.ai** when the page is opened as a claude.ai artifact (runtime `sample` capability). It uses the viewer's own claude.ai plan limits, not API credits; the first question asks for permission.
  2. **Workers AI on the Cloudflare site** (`/api/ask` in `src/index.js`, model `@cf/meta/llama-3.1-8b-instruct`, override with the `AI_MODEL` variable). On the Workers Free plan the daily free allowance just runs out (no charge); on a Workers Paid plan usage beyond the allowance is billed. The endpoint only accepts calls from the app's own origin.
  3. Otherwise rules only.
  The engine gets the facts the app computed and is told to use nothing else; data changes it suggests come back as rule commands that still need Terapkan.
