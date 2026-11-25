# Changelog

Changes to the PPIC Decision Support System (Forecast Desk), newest first. Built from the git history and pull requests
of this repository. Dates are when the change reached `main`. How the parts fit together: [docs/sistem.md](docs/sistem.md).

## 2026-11-25

- **Rencana produksi, less clutter.** The SKU panel in Mode Manual is a compact list (one row per SKU: status dot, name,
  Nomat, PP, shortfall; click for details), so dozens of SKUs fit without scrolling. **Sembunyikan ringkasan** hides the
  summary cards and alert ribbon above the grid while arranging (on by default in Mode Manual). The demo now loads sample
  machines, including Pop Up, and removes them again when the demo is left.
- **Excel-style columns, version history, Jenis SKU warnings.** Every wide table (Forecast, Saran buffer, Material master,
  Cek data SKU, Pratinjau, Master mesin, and the Produksi and MRP pages) gets **Kolom ▾** above it and a right-click menu on
  its column headers: 🔒 *Kunci sampai kolom ini* freezes the columns up to that one while the table scrolls sideways (like
  Freeze Panes), and each column can be hidden. Choices are kept per table in this browser (`ppic_tabel`); *Kembalikan
  bawaan* resets. One shared script, `public/tabel.js`, re-applies them after every re-render; the Rencana produksi and
  Produksi day grids keep their own frozen columns. Material master's own Kolom menu now uses it (Status, Nomat and SKU locked
  by default, same columns hidden as before). **Riwayat versi** at `/riwayat/` (Pengaturan → Bantuan, search *versi*, 🕘 in
  Produksi and MRP) lists the changes in Indonesian. **Material master** warns when a Jenis other than Reguler misses its
  detail: SKU baru without *Histori dari Nomat*, Musiman without (or with an unreadable) *Musim aktif*, Diganti without
  *Nomat pengganti*. Shown as a red banner, a *Jenis belum lengkap* count and filter, the row and Detail jenis cell, and an
  alert; choosing a Jenis moves the cursor to the field it needs.
- **Material master and Cek data SKU are one step: Material & status.** The flow has 4 numbered steps. One **Status** column
  (Aktif, Perlu cek, Diskontinu, Diganti) with the rule reason; clicking it opens the same status menu as the Forecast sheet,
  and a choice there also clears an older hand-set Aktif/Nonaktif so the status has one source. The rules are a fold-out
  *Aturan status otomatis* above the table; status counts and filters (*Status: …*, *Kena aturan / tidak aktif / diubah*)
  replace Aktif/Nonaktif; *Koreksi angka* moved under the Forecast sheet. Links, alerts and saved pages that pointed at Cek
  data SKU open Material & status with the matching filter.
- **Status rules know the Jenis SKU.** New rule *Data tidak cocok dengan Jenis SKU* (Perlu cek): seasonal SKU with order in
  outside its Musim aktif, SKU baru with its own order in for 6+ months (maybe Reguler), Histori dari Nomat not in the data.
  What is normal for the Jenis no longer trips the other rules: stock without Forecast HQ or zero order in outside the season,
  zero order in before a new SKU sells, order in far from HQ in a new SKU's first months; the Status column says why in green
  (*✓ … wajar*) and the filter *Tidak biasa tapi wajar karena Jenis SKU* lists them. The rules fold-out remembers open/closed.

- **Manual production planning, machine output and Balance Production.** Rencana produksi in *Manual* mode no longer makes
  suggestions: the grid shows only the machines (or *Tidak ada data mesin* when there is no machine list, instead of sample
  machines), *Jalankan jadwal otomatis* is hidden, and the left panel lists the SKUs to schedule (PP, area mesin, stock cover,
  net weight, output per machine) instead of Alerts / Tanya. Drag a card onto a machine row: the bar starts on the first free
  working day from the drop point and lasts sisa PP ÷ output per day. **Output per machine** (cartons/day) = kapasitas per hari
  ÷ net weight per carton × variasi output %, read from the Machine Master (`meta.capDayT`, `meta.outPct`) and editable by
  double-clicking the machine's capacity cell. Perencanaan Produksi gets a **Monitoring** step (Harian / Bulanan) with
  **Balance produksi = rencana produksi − GR gudang**, per day and month to date, per SKU, machine or machine type.
- **Input data first, Ringkasan becomes Dashboard, Master mesin.** The app opens on **Input data**, now grouped into
  *Penjualan & forecast*, *Stok & kelas SKU* and *Master data* (filter chips with filled/total counts). **Dashboard** (next
  to Input, unnumbered) shows the key-number cards, order in vs Forecast HQ / Forecast AI per month with hover and a
  table view, the largest brand · category groups for M+1, stock vs buffer, plan tonnes vs machine capacity, SKU status
  and the open alerts. The numbered steps are now 1 Material master … 5 Rencana produksi. **Master mesin** adds kapasitas
  kg/hari, berat bersih kg/karton and variasi output %, with output karton/hari = kg/hari ÷ kg/karton × variasi %; machine
  real names are stored only encrypted (AES-GCM, passphrase key never stored) behind random code names, with an optional
  copy in Workers KV (`/api/mesin`) and dummy demo machines.
- **Demo is easy to find.** Input data shows a large *Baru pertama kali? Coba dulu dengan data contoh* banner with
  **▶ Coba data contoh (demo)** while no data is loaded; during the demo a slim *Mode demo aktif* strip offers *Lihat
  Dashboard* and *Keluar dari demo*.

- **Material master: Jenis SKU.** Each Nomat gets a *Jenis SKU* (Reguler, SKU baru (NPD), Musiman, Musiman + histori,
  Diganti), chosen or taken from its data; *Detail jenis* shows only that type's inputs (Histori dari + %, Musim aktif,
  Nomat pengganti). Filter by Jenis in Material master, filter and group by Jenis on the Forecast sheet; saved in
  `atribut_sku` (`jenis_sku`). *Kolom ▾* hides columns; Brand, Kategori, Famili closing and BOM are hidden by default. Free columns are added from the last column (*+ Kolom baru*, Enter) like Excel, with ⋯ for pasting or uploading
  several columns; pasting a column from Excel into a cell fills it down (Histori dari, %, Musim aktif, free columns).
- **Brand and Kategori from the closing sheet.** The closing parser never read the closing's *Brand* / *Category* columns
  (only Forecast HQ and the material master were used), and the combined history dropped them. Both are now read, kept in
  the history file (sheet `bulanan`) and in `ingest_closing.py` (existing SQLite stores get the two columns added). Priority:
  material master > Forecast HQ > closing.
- **New Nomat (NPD) from an old Nomat.** Material master column *Histori dari Nomat* (+ %): a new Nomat, usually a packaging
  change, borrows the old Nomat's order in × % for the months before its own first order in, so Holt, HQ terkoreksi, the
  Regressor and Chronos all have a history. The old Nomat stays active. Moving the history fully (old Nomat stops) is still
  *Nomat pengganti* on the old row. Also in *+ Tambah SKU*.
- **Seasonal Nomat.** Column *Musim aktif* (`Feb-Apr`, `11-1`, `Jan,Mar`, `2027-02..2027-04`). Outside the season: Forecast AI,
  buffer and PP are 0, those closing months are left out of the models' training and backtest, and the SKU shows as
  nonaktif (musiman) in Material master. Back in season it forecasts from earlier in-season months.
- **Free columns per Nomat.** *+ Kolom bebas* (empty column, or paste Nomat + columns from Excel) and *Unggah atribut SKU*
  (Excel / CSV with Nomat and any columns). Used as a filter and as *Kelompok* on the Forecast sheet (view only; the models
  keep Brand · Kategori). Saved in the browser and in the history file, sheet `atribut_sku`.

## 2026-11-24

- **Lighter on small laptops and large histories.** Header and step bar can be compact or hidden (*Pengaturan → Bagian atas*;
  Otomatis = compact on short windows; ⌃ hides them, Ctrl K still searches). The regressor trains in a Web Worker and about
  1.5–2× faster with identical results, so loading a 1,200-SKU two-year history no longer freezes the page for ~15 s (longest
  block now under 1 s) and edits no longer retrain on the main thread. Loading overlay, error banner instead of a dead page,
  downloads wait for the regressor, and the Rencana produksi grid is only drawn while its page is open.

## 2026-11-17

- **Saran buffer over three months, smaller cards.** The Saran buffer table now runs M+1 → M+3 like the Forecast table:
  after M+1 (Rencana produksi, Stok akhir, Status) each later month has Stok awal, Forecast, Buffer, PP and Stok akhir, where
  stok akhir = stok awal + PP − forecast becomes next month's stok awal and may be negative (no longer cut at 0). Bahan baku
  per month (Karton, Plastik, Jumbo roll × M+1..M+3, Deskripsi BOM) moved to the very end. The projection panel below keeps
  only the monthly totals and *Buka MRP bahan baku ↗*. Page cards (Forecast Desk and MRP) are compact: one line of title,
  value with the graphic beside it, one line of note.

## 2026-11-16

- **MRP Bahan Baku (`/mrp/`).** New page for raw material orders (karton, plastik, jumbo roll). Requirement = PP M+1–M+3 from
  the Saran buffer projection × BOM per carton; for raw materials the **buffer is the reorder point**: when stock + PO reaches
  it, an order is released (buffer + N days, MOQ / multiple) and arrives after the lead time. Steps Kebutuhan, Stok & PO, MRP
  (projected stock vs buffer per material, weekly table), Rencana pesan (*Sudah dipesan* → open PO); summary cards with
  preview graphics, assistant bar, Excel export / import. Opened from **Buka MRP bahan baku ↗** in Saran buffer or the search
  bar; sample BOM for SKUs without one.

- **Cards back on the pages.** The summary cards of Forecast, Saran buffer and Rencana produksi are shown again above each
  page as real cards (coloured edge by warning light, large value) with a small preview graphic (trend line, monthly bars or
  the top SKUs of the list). *Sugesti Utama AI* moved into the side panel (Alerts tab on the Forecast page), still hidden at
  start. The Tanya input box can be made taller (drag its corner); the Perencanaan Produksi assistant panel resizes in width
  and height.

- **Planner requests, round 3.** Side panel (Alerts / Tanya) on the left by default and resizable by dragging its edge (width
  remembered); the Perencanaan Produksi assistant panel also opens on the left and can be resized. **Saran buffer**: projection
  per month M+1–M+3 (stok akhir M+1 = stok awal + PP − forecast → stok awal M+2 with its own buffer and PP) with PP and raw
  material per month; bahan baku split into Karton (pcs), Plastik (ton), Jumbo roll (ton) and Deskripsi BOM, BOM per SKU in
  Material master, all hideable. **Cek data SKU**: *Diganti* explained ("digantikan oleh SKU baru", status legend, clearer
  rule text). **Alerts**: value in a large coloured badge with verdict and thresholds. **Forecast**: *Fokus AI* renamed
  *Sugesti Utama AI*, hidden at start. **Material master**: *+ Tambah SKU* for an SKU missing from the files or a new SKU (NPD),
  which flows into Forecast, buffer and plan. **Rencana produksi**: *▶ Jalankan jadwal otomatis* replaces *Kembalikan jadwal
  otomatis*; *Cara menjadwal* Otomatis / Manual; *✎ Susun manual* start; SKUs not scheduled or not mapped shown red with
  *Tempatkan di mesin…*. All warning-light thresholds and colours in one `LAMPU` block in `public/index.html`.

- **Perencanaan Produksi (#11).** `/produksi/` is rebuilt as its own page with four steps (Data masuk, Rencana,
  Aktual, Skenario): Excel-like grid with draggable / resizable run bars, action cards, paste-and-check actuals,
  rush-order and machine-stop scenarios, assistant bar above the grid. Forecast Desk drops step 7 (Monitoring harian);
  step 6 sends the schedule (with stock cover, forecast per day, ABC-XYZ class) and opens the page; the search bar
  lists it under *Produksi*.

## 2026-11-15

- **Asisten lebih menonjol (#9).** 👁 Tunjukkan spotlight on alerts with the assistant's eye and typed
  explanations; Fokus AI list of vital SKUs with *tandai tinjau* / *pelajari histori*; ⚑ review marks carried to
  Saran buffer and the export; Sinyal opens the Tanya tab with a history summary and why the ensemble chose its number;
  asymmetric **Skor buffer** 1 − (w × kurang + lebih) ÷ order in with a *Kurang dihitung* 2× / 3× setting; per-month
  backtest winners ("Defensif menang 5 dari 6 bulan"); *Arti strategi buffer* panel; recommendation thread in Saran
  buffer; P50/P90 sources and comparing two forecasts; `docs/panduan-asisten.md` with the answer rules.
- **Desain 10 layout (#8).** New shell with a command bar (Ctrl K), an 8-step flow (Ringkasan, Input data, Material
  master, Cek data SKU, Forecast, Saran buffer, Rencana produksi, Monitoring harian) with step locks: each step opens
  after **Terima dan lanjut** on the previous one. Per-page alerts panel, settings, help through the chatbot. Input: one
  drop zone and compact slot cards. Forecast: Forecast HQ original, Forecast AI with a per-model filter, Brand and
  Kategori columns, 👁 Sugesti per SKU. Buffer: P50/P90 columns, Kuantil P90 by default for non-NPD SKUs. Plan: empty
  until *Buat rencana otomatis*, grouped Area mesin › mesin › SKU. Monitoring embedded and fed from the plan.
- **Saran buffer: backtest picker, Kuantil P90, ABC-XYZ (#7).** *Otomatis* now replays every strategy on 6 closings
  (walk-forward) and picks the one with the lowest (2 × kurang + lebih) ÷ order in. New strategy Kuantil P90 with P50/P90
  from Chronos, a browser quantile regressor (pinball loss τ = 0.9), the SKU's or its class's ratios. ABC-XYZ class per
  closing, flagged when it disagrees with the HQ class. New cards *Akurasi buffer* and *Kelas ABC-XYZ*. On generated
  data: Otomatis 72% buffer accuracy vs 67% for Standar (78% with Chronos).
- **Usability + Forecast ML v2 (#6).** Undo/redo everywhere; card lists that jump to the SKU cell; drop files anywhere
  with type detection; search in Forecast and Saran buffer; material master slot and table with a *Nonaktif di
  material master* rule; Brand · Category grouping; compact history `.ppic.gz`. Forecast ML v2: browser gradient-boosted
  Regressor, `ingest/forecast_chronos.py` for Chronos-2 / Chronos-Bolt on the user's computer, and a backtest-weighted
  **Ensemble** of Holt, HQ terkoreksi, Regressor and Chronos.

## 2026-11-13

- Group SKUs by **brand + family** (Paseo, Jolly, Nice … shown apart within a closing family) in Forecast, Saran
  Buffer, Cek and the plan filter.

## 2026-11-12

- **Monitoring Produksi Harian** at `/produksi/`:
  - #1 page and link from the main app;
  - #2 plan vs actual from Excel uploads (header detection, day-number dates, matching actuals by machine + material),
    templates, kept in the browser;
  - #3 mockup with the Nov 2026 plan and seeded made-up actuals (`/produksi/?contoh`);
  - #4 monthly plan as input (daily schedule built from *Target/hari*), Gantt Grid bulanan with daily entry, Utang column;
  - #5 **Kirim ke Monitoring Harian** from Rencana Produksi; holiday calendar sent along; actuals kept.
- **Rencana Produksi**: one plan month with a flat day calendar, draggable bars and daily targets, clickable problem
  cards, plan data template; PP target (from Saran Buffer) vs PP rencana (sum of daily targets); editable machine list
  and SKU group → machine type tables (paste from Excel); built-in Indonesian holidays 2026–2027; Excel-style frozen
  panes; split bars (A → B → A); Excel export; no demo machines with real data.
- **Asisten** uses Claude (claude.ai) or Workers AI (`/api/ask`) instead of a downloaded model.

## 2026-11-11

- **Cek Data SKU**: rule-based SKU status (Aktif, Perlu cek, Diskontinu, Diganti) with manual overrides.
- Forecast table editable like Excel, with a correction log and a status menu.
- **Saran Buffer** tab: buffer formula, strategies, manual edits with a reason, `saran_buffer` sheet.
- Renamed to **PPIC Decision Support System**; tabs reordered; dummy raw material.
- First **Rencana Produksi**: PP per SKU and machine load, machine-type master with capacity loaded from the PP Excel
  (no machine data in the code), machine schedule board, machine › SKU table with timeline bars.
- **Asisten**: rule-based commands and analysis (first with an optional in-browser WebLLM model).

## 2026-11-03

- Input tab for closing report extraction (browser) and the Python loader `ingest/ingest_closing.py`; served by a
  Cloudflare Worker.
- Weekly OI/GI/OS/GAP table detection; unit from the sheet name.
- Built-in HQ SKU classes from the 21 Oct 2026 Stock Level Check.
- One combined Serang history from closings, HQ forecast and SKU class; Summary Forecast files read.
- SKUs keyed by Nomat; W1–W5 checked against order in; **Forecast** screen with cards and trend charts.
- First Forecast ML prototype: damped Holt on order in blended with bias-corrected Forecast HQ.
