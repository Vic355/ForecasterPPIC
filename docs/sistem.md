# PPIC Decision Support System: system overview

This page explains how the whole system fits together: what each part does, how data moves from the monthly closing
report to a production plan, which models produce the forecast and the buffer, and where data is stored. Details of
each screen are in the [README](../README.md); the history of changes is in [CHANGELOG.md](../CHANGELOG.md). The UI is
in Indonesian, so screen names and terms are kept in Indonesian here.

Plant: The Univenus Serang (plant 7079). Unit: cartons (CT), tonnes where noted.

## 1. Parts of the system

| Part | File | Runs | What it does |
| --- | --- | --- | --- |
| **Forecast Desk** (PPIC Decision Support System) | `public/index.html` | browser | The main app: reads the Excel files, checks SKUs, forecasts, suggests buffers, builds the production plan. One self-contained HTML file. |
| **Perencanaan Produksi** | `public/produksi/index.html` | browser | Daily plan per machine and SKU (run bars), actuals pasted from the production report, what-if scenarios. Its own page at `/produksi/`, opened from step 6 or the search bar. |
| **MRP Bahan Baku** | `public/mrp/index.html` | browser | Raw material requirements (PP M+1..M+3 × BOM), stock vs buffer, order dates and quantities. Its own page at `/mrp/`, opened from Saran buffer or the search bar. |
| **Worker** | `src/index.js`, `wrangler.jsonc` | Cloudflare | Serves `./public` as static files, plus `/api/ask` (Workers AI) for the Asisten's free-form questions. |
| **Chronos script** | `ingest/forecast_chronos.py` | user's computer | Runs the Chronos foundation model on the exported history and writes `forecast_chronos.csv`, which is dropped back into the app. |
| **Batch loader** | `ingest/ingest_closing.py` | user's computer | Optional. The same closing extraction into an append-only SQLite store. |
| **Reference data** | `data/sku_class_hq.csv`, `data/stock_level_2026-10-21.csv` | built in | HQ SKU class (A/B/C/NPD), DOI target and stock levels from the 21 Oct 2026 Stock Level Check. |

Nothing is uploaded to a server. Files are read in the browser, and the app's state lives in the browser
(`localStorage`) and in the history file the user downloads. Machine data is never stored in this repository.

## 2. Monthly flow

Since Desain 10 (PR #8) the Forecast Desk is a guided flow. Each step opens only after the previous one is accepted
with **Terima dan lanjut ke …**; a red count shows open alerts. Accepting a page marks its red/amber alerts as checked.

| # | Step (UI name) | Input | Output |
| --- | --- | --- | --- |
| ⇩ | **Input data** (first screen) | Grouped: *Penjualan & forecast* (closing reports, Forecast HQ M+1..M+3, Chronos CSV, earlier history file), *Stok & kelas SKU* (Stock Level Check), *Master data* (material master, Master mesin) | One combined Serang history (`bulanan`, `mingguan`, `forecast_hq`, …) |
| ▦ | **Dashboard** (was Ringkasan) | | Key numbers, order in vs forecast per month, top groups M+1, stock vs buffer, plan vs machine capacity, SKU status, open alerts |
| 2 | **Material master** | Material master Excel (optional) | Active / inactive per Nomat, Nomat changes, successor SKUs |
| 3 | **Cek data SKU** | Status rules + manual overrides | Status per SKU: Aktif, Perlu cek, Diskontinu, Diganti |
| 4 | **Forecast** | Clean history | Forecast HQ vs order in, accuracy, Forecast AI (ensemble) M+1..M+3 |
| 5 | **Saran buffer** | Forecast basis, service level, lead time, strategy | Buffer per SKU, PP = forecast + buffer − stok bebas |
| 6 | **Rencana produksi** | PP, machines, SKU → machine type, calendar | Schedule per machine and day, Excel export |

Files can be dropped on any page; the kind is detected (history .xlsx / .ppic.gz, material master, Forecast HQ,
Stock Level Check, production data, Chronos CSV, otherwise closing).

```
Closing xlsx ─┐                                 ┌─> Forecast AI (Holt, HQ terkoreksi, Regressor, Chronos → Ensemble)
Forecast HQ  ─┼─> Input ─> Material master ─> Cek data SKU ─┤
Kelas SKU    ─┘                                 └─> Forecast HQ vs order in (accuracy, bias)
                                                         │
                     Chronos CSV (from forecast_chronos.py) ┘
                                                         ▼
                       Saran buffer (strategy picked by backtest, P50/P90, ABC-XYZ)
                                                         ▼
                       Rencana produksi (PP per SKU → machines → days)
                                                         ▼
                       Perencanaan Produksi /produksi/ (daily plan, actuals, scenarios)

  Saran buffer (PP M+1..M+3) × BOM ─> MRP Bahan Baku /mrp/ (stock + PO vs buffer → order dates and quantities)
```

## 3. Data keys and cleaning

- **SKU key = Nomat** (nomor material). Article Code is kept alongside, used for the HQ class lookup, and used as the
  key only when Nomat is missing ("Tanpa Nomat").
- **Groups** = Brand · Category (from Forecast HQ or the material master), falling back to Brand · Family; a switch
  goes back to Brand · Family.
- **Cek data SKU** rules (stock without HQ, red/struck-through codes, keywords, nearby similar SKU, brand mismatch,
  HQ vs order in far apart) give a status. Diskontinu and Diganti SKUs are left out of totals, accuracy and the ML;
  a replaced SKU's order in is added to its successor's history.
- **Corrections** typed in the Forecast table never overwrite the file values; they are kept in a correction log
  (`koreksi`) and applied on top.

## 4. Forecast models

All models forecast monthly **order in** per SKU for M+1..M+3. Forecast HQ is the comparison baseline (REV, or ORIG
when REV is empty, on the realised side; the Desain 10 Forecast page shows HQ original for future months).

| Model | Runs | Summary |
| --- | --- | --- |
| Holt | browser | Damped trend on order in (α 0.5, β 0.3, φ 0.8), floored at 0 |
| HQ terkoreksi | browser | Forecast HQ × the SKU's order-in ÷ HQ ratio over 3 closings, shrunk to the all-SKU ratio, clamped 0.3–3 |
| Regressor | browser | Gradient-boosted trees in plain JS (80 trees, depth 3, log1p target), one per horizon; features: lags, 3-month mean, Forecast HQ, HQ bias, category mean, month, history length, CV |
| Regressor kuantil | browser | Same trees with pinball loss τ = 0.9, for P90 |
| Chronos | user's computer | Chronos-2 with Forecast HQ as covariate (or Chronos-Bolt); P10/P50/P90 plus backtest months |
| **Ensemble** (Forecast AI) | browser | Weighted average, weight ∝ 1 / (WAPE + 0.05)², WAPE from each model's walk-forward one-month-ahead backtest, shrunk toward category and global WAPE |

The backtest is walk-forward: each closing month is predicted only from earlier months, weights included.

## 5. Buffer (Saran buffer)

- **Standar formula**: buffer = z × error spread × forecast × √(lead time ÷ 30) × strategy factor
  (z: 90% = 1.28, 95% = 1.64, 98% = 2.05).
- **Strategies**: Standar, Defensif, Ikuti tren, Batas atas (≤ 10 hari), Kuantil P90, Habiskan stok.
- **Kuantil P90**: buffer = max(0, P50 − basis) + (P90 − P50) × z ÷ 1.28 × √(lead time ÷ 30). P50/P90 source, first
  available: Chronos → Regressor kuantil → the SKU's order-in ÷ forecast ratios → its ABC-XYZ class's ratios → Standar.
  Default for non-NPD SKUs when quantiles exist.
- **Otomatis = backtest picker**: every strategy is replayed on the last 6 closings (walk-forward) and scored by
  (w × kurang + lebih) ÷ order in, w = 2 (shortfall costs double). Few months → pulled toward the ABC-XYZ class;
  new SKU → the class winner; < 3 closings → old rules.
- **ABC-XYZ** recomputed each closing from 6 closings of order in: ABC 80/15/5 by volume, XYZ by CV
  (< 0.5 / 0.5–1 / > 1), < 3 months = NPD. Disagreement with the HQ class is flagged.
- **PP** (production need) = forecast + buffer final − stok bebas; stok bebas = stock on hand − outstanding DN − SC block.
- Manual buffer edits need a reason and are kept.
- **Multi-month projection (M+1..M+3)**: stok akhir M+1 = stok awal + PP − forecast becomes stok awal M+2 (negative allowed, carried as is); M+2 gets its own
  buffer (same strategy, that month's forecast; P50/P90 from Chronos / Regressor kuantil for that month, else the M+1 range
  scaled) and PP = max(0, forecast + buffer − stok awal); the same for M+3. Manual buffer edits apply to M+1 only.
- **Raw materials**: need = PP × BOM per carton (karton pcs, plastik kg, jumbo roll kg), BOM typed per SKU in Material master
  (`state.bom`, sheet `material_master` columns `bom_*`). Empty until filled; the columns can be hidden.

## 6. Production plan and Perencanaan Produksi

- **Rencana produksi** plans one month (closing + 1). Two ways: *Otomatis* (the model places every SKU without manual bars,
  live) or *Manual* (only bars placed by hand; SKUs with PP but no bar are red under their area, SKUs without an area are red
  at the bottom). **▶ Jalankan jadwal otomatis** fills the unscheduled SKUs or rebuilds from scratch. Auto schedule: problem SKUs first, then fewest days of cover, then
  biggest PP; each SKU goes to the machine of its type with the earliest free stretch. Bars can be dragged, resized,
  split (A → B → A); daily targets can be typed. Built-in Indonesian holidays 2026–2027; Saturdays on, Sundays off.
  Export to Excel, or **Kirim ke Perencanaan Produksi**.
- **Perencanaan Produksi** (`/produksi/`) takes that plan (or a plan Excel; date columns up to a chosen day are actuals,
  no date columns = PP list). Steps: Data masuk, Rencana (grid with draggable bars and action cards), Aktual (paste the
  output column, check, lock the day), Skenario (rush order / machine stop, preview, apply). Saved in `ppic_prod`.

### Master mesin (machine master)

Input data → Master data → **Master mesin**. One row per machine: area, **kode mesin** (code name, e.g. `DTY-2`),
**nama asli** (real name, encrypted), kapasitas kg/hari, berat bersih kg/karton (reference), variasi output %, catatan.

- **Output karton/hari = kapasitas kg/hari ÷ berat bersih kg/karton × variasi output %.** In Rencana produksi the SKU's own
  net weight (from closing) replaces the reference weight. Kapasitas t/bulan = kg/hari × variasi output × 26 working days
  when kg/hari is filled, otherwise typed or read from the PP Excel as before.
- Shape (read by Rencana produksi): `state.machMaster = [[area, [[code, capTonPerMonth, remark, meta], …]], …]`,
  `meta = { capDayT, outPct, nwCtKg, enc: { iv, ct } }`. `machLabel(code)` gives `Real name (code)` when unlocked, else the
  code; `machOutCt(meta, nwKg)` gives cartons/day.
- **Names.** The code is the machine's id everywhere (schedule bars, maintenance days, calendar, capacity edits, files).
  The real name is encrypted in the browser with AES-GCM 256; the key is derived from a passphrase (PBKDF2-SHA256,
  250,000 rounds) that is never stored. Storage (`localStorage`, history file sheets `kapasitas_mesin.nama_terenkripsi`
  and `kunci_mesin`, the server copy) only holds ciphertext, a salt and a check value. Without the passphrase the
  names cannot be recovered; codes and capacities still work. **Samarkan** moves names that are still used as codes
  (e.g. from a PP Excel) into the encrypted field, gives random codes and renames every reference.
- Codes are random (three letters + digit). A keyboard shift such as `SRT01 → DTY-2` is a substitution cipher: one known
  pair reveals the rule, so it is only a label, never the protection.
- **Server copy (optional).** *Simpan ke server* / *Ambil dari server* store one JSON document in Workers KV through
  `/api/mesin` (binding `MESIN_DB`, see §9). The Worker never sees the passphrase and rejects documents where any machine
  lacks an encrypted name. The endpoint has no login of its own: put the site behind Cloudflare Access so only the team
  can read or overwrite it.
- **Isi data contoh (dummy)** fills 8 invented machines.

## 6b. MRP Bahan Baku

- **Input**: PP M+1..M+3 per SKU from the multi-month projection and the BOM per SKU (Material master), sent with
  **Buka MRP bahan baku ↗** (`ppic_mrp`). Month 1 follows the Perencanaan Produksi daily plan when one exists for it.
- **Buffer = reorder point for raw materials.** Buffer saran = requirement per day × (lead time + cadangan days), or a manual
  value. Daily simulation of stock + open PO + planned orders; when that position reaches the buffer an order is released for
  buffer + N days of requirement − position (MOQ / multiple), arriving after the lead time. Stock below zero before arrival
  is flagged *Stok habis*; stock + PO above buffer + N days is *Di atas maksimum*.
- Raw material per SKU and category chosen by keyword in the BOM description. Materials, stock, POs and settings are kept in
  `ppic_mrp_rm`; Excel export / import (sheets `bahan_baku`, `po_terbuka`, plus `rencana_pesan`, `mrp_mingguan`,
  `kebutuhan_sku` on export).

## 7. Asisten

A chat panel on every page. A rules engine answers commands (`pp target <SKU> = n`, `buffer <SKU> = n alasan …`,
`strategi <SKU> kuantil`, …) and questions (`ringkasan`, `kenapa <SKU>`, …). Every change is a proposal applied only
after **Terapkan**, and can be undone. Free-form questions go to Claude (when opened as a claude.ai artifact) or to
Workers AI through `/api/ask`, given only the facts the app computed.

Since PR #9 the Asisten is more prominent: 👁 Tunjukkan spotlight on alerts, a Sugesti Utama AI list (was Fokus AI; hidden at start) of
vital SKUs, an asymmetric buffer score setting (*Kurang dihitung* 2× / 3×), per-month backtest winners, P50/P90
sources and comparing two forecasts. Its answer rules are written up in [panduan-asisten.md](panduan-asisten.md).

## 7b. Warning lights (LAMPU)

Every red / amber / green threshold and colour is in one block, `var LAMPU = { … }`, at the top of the script in
`public/index.html` (lines 1037–1058). Forecast (selisih HQ, akurasi HQ, tren, HQ vs AI, SKU tanpa HQ), buffer (stok di
bawah buffer, skor buffer, tanpa produksi, stok akhir negatif in the projection) and plan (belum terjadwal, belum dipetakan,
target above machine speed). Alert cards show the value in a large coloured badge with the verdict and the thresholds.

## 8. Storage

| Where | What |
| --- | --- |
| Browser `localStorage` (`ppic_*` keys) | Corrections, SKU statuses, rules, buffer edits and strategies, Chronos rows, material master (with SKUs added by hand and BOM), plan (with *Otomatis/Manual* per month), UI settings (side panel width), Perencanaan Produksi plan and actuals (`ppic_prod`), MRP input (`ppic_mrp`) and raw materials / POs (`ppic_mrp_rm`) |
| History file `Histori_Serang_*.xlsx` or `.ppic.gz` | Everything above plus the extracted closings. Sheets: `bulanan`, `mingguan`, `forecast_hq`, `kelas_sku`, `log`, `status_sku`, `aturan`, `koreksi`, `saran_buffer`, `forecast_ml`, `forecast_chronos`, `material_master`, `rencana_produksi`, `jadwal_produksi`, `target_harian`, `kalender_produksi`, `sku_mesin`, `kapasitas_mesin`, `kunci_mesin` |
| `.ppic.gz` | Same content as the Excel, columnar JSON gzipped (~13 KB vs ~390 KB on the sample) |

Uploading the history file restores the whole state. The monthly routine is: open the app, drop the last history file
plus the new closing and Forecast HQ, (optionally) run Chronos and drop its CSV, walk the steps, download the history.

## 9. Deploy

`npx wrangler deploy` (or connect the repo in the Cloudflare dashboard to deploy on every push). Workers AI is bound as
`AI` in `wrangler.jsonc`; the model can be changed with the `AI_MODEL` variable. The page version in the header confirms
which build is live.

Optional machine master copy: `npx wrangler kv namespace create MESIN_DB`, then uncomment the `kv_namespaces` line in
`wrangler.jsonc` with the printed id. Without it `/api/mesin` answers 503 and the app keeps machines in the browser and
the history file.
