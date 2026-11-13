# ForecasterPPIC

PPIC Decision Support System for The Univenus Serang (plan 7079). PPIC Forecast Desk is its monthly view: extract the monthly closing report into tables that feed the ML forecast.

## Web app

`public/index.html` has two working tabs (Saran Buffer is not built yet):

- **Forecast** (opens first): families with the top-10 SKUs inside, free stock at the latest closing, the last three closings
  (Order in, Forecast HQ = REV or else ORIG, Selisih = HQ − Order in), then M+1..M+3 (Forecast HQ from the Summary Forecast files,
  adj preferred over original; **Forecast ML stays empty** until a model is trained). Cards: Order in vs HQ, HQ accuracy
  (1 − WAPE per SKU vs the 70% target), 3-month bias trend, Forecast M+1, SKUs without HQ, ML status.
  Clicking a card (all but ML) opens a chart of that measure over all closing months, with the SKUs behind it listed and the
  biggest contributors highlighted.
- **Input Data & Model**: the upload and extraction check below.

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
or just type, Enter/Tab to move on, arrows to move, Esc to cancel, Delete to empty, Ctrl+Z to undo. Edited cells are marked
yellow with the file value in the tooltip. The file's values are never overwritten: corrections are kept separately
(browser + sheet `koreksi` in the history workbook, listed with a revert button under Cek Data SKU) and applied on top for
totals, accuracy and the ML. The status chip under each SKU name opens a menu to set Aktif / Perlu cek / Diskontinu /
Diganti oleh … without leaving the table.

## Forecast ML (prototype v1)

Per SKU (Nomat), in the browser, recomputed from whatever history is loaded:

    Forecast ML = w × Holt(order in) + (1 − w) × Forecast HQ × r

- **Holt**: level + damped trend on monthly order in (alpha 0.5, beta 0.3, damping 0.8), floored at 0.
- **r** (HQ bias correction): Σ order in ÷ Σ Forecast HQ over the SKU's last 3 closings, shrunk toward the all-SKU ratio
  (2 pseudo-months) and clamped to 0.3–3.
- **w** (Holt weight): from each part's past one-month-ahead errors (inverse-error weighting, lightly shrunk to 0.5); 0.5 with no history.
  No HQ → Holt only; no order-in history (new SKU) → corrected HQ only.
- **Backtest** (Kinerja ML card): every closing month after the first is re-predicted with only the months before it and the
  HQ forecast that the closing reports for that month; accuracy = 1 − WAPE, same as the HQ card.
- **Signal** compares Forecast HQ with Forecast ML: ▼ HQ above ML (≥20% strong, 5–20%), ≈ under 5%, ▲ HQ below ML.
- The downloaded history workbook gets a `forecast_ml` sheet (holt, corrected HQ, ratio, weight per SKU-month).

## Input tab (web)

The **Input Data & Model** tab is served by a Cloudflare Worker (`wrangler.jsonc`). Everything runs in the browser; files are not uploaded anywhere.

Three inputs:

1. **Histori closing** (required): one "Daily Report Prod & Sales Closing" file per month, several at once. The month is read from the file name (e.g. `AUG26`) and can be edited. A previously downloaded `Histori_Serang_*.xlsx` can be added to continue it.
2. **Forecast HQ M+1 – M+3** (required): one "Summary Forecast <Mon YYYY>" file per month (e.g. `11. Sales Forecast Nov26 adj - TUB`). Taken per SKU: Qty (ctn), W1–W4 and the per-zone split in cartons (ton columns skipped). The version (original / adj) comes from the file name; one row set is kept per month and version.
3. **Kelas SKU** (optional): built in from the Stock Level Check of 21 Oct 2026; upload a newer Stock Level Check only to replace it.

**Unduh Histori_Serang.xlsx** writes one workbook with sheets `bulanan` (one row per SKU per closing month), `mingguan` (W1–W5),
`forecast_hq`, `kelas_sku` and `log`. Re-uploading a month replaces that month and is noted in `log`.

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
- Strategi per famili atau SKU: Standar, Defensif, Ikuti tren, Batas atas (≤ 10 hari), Habiskan stok. Bila tidak dipilih, strategi dipilih otomatis dan alasannya tampil di tombol status.
- Kebutuhan bahan baku masih dummy: data BOM belum ada.
- Buffer final bisa diubah manual dengan alasan wajib. Perubahan dan strategi manual disimpan di browser dan di lembar `saran_buffer` file Histori_Serang, lalu dibaca kembali saat file itu diunggah.

Tab order: Forecast, Saran Buffer, Rencana Produksi, Cek Data SKU, Input Data & Model. The Saran Buffer cards (buffer final, rencana produksi, bahan baku dummy, stok di bawah buffer, tanpa produksi) each open a list of SKUs.

## Rencana Produksi (mockup)

The plan is made at the start of the month, so there is **one plan month: closing + 1** (the same month as Saran Buffer). PP = forecast + buffer final − stok bebas (from Saran Buffer). Stok bebas = stock on hand − outstanding DN − SC block.

- **Five cards**, each opens a list (click a row to jump to the SKU): PP total, SKU bermasalah (stok bebas < forecast), Belum terjadwal, Jadwal perlu dicek (past month end, clash, daily target above machine speed, targets ≠ PP), Mesin belum pasti (machine type guessed from the name).
- **One flat table** in the page (no inner scroll box; the plan tab uses the full window width): machine type › machine (bars) › SKU (daily targets). Columns: stok bebas, forecast, buffer, PP, production days, then one column per calendar day (plus overflow days of the next month when a bar runs past month end).
- **Auto schedule**: bermasalah first, then fewest days of cover, then biggest PP; each SKU goes to the machine of its type with the earliest free stretch; it continues on another machine when the month is full, and only then runs past month end. Machine speed = capacity ÷ working days of the month, or the SKU's own speed (template). Bar length = tonnes ÷ speed.
- **Calendar editing**: drag a bar to move it (another day or another machine row), drag its right edge to change its length, click it for a menu (machine, start, length, fit to speed, back to auto, take off the schedule). Arrow keys move a focused bar, Shift+arrows resize. Double-click an empty day on a machine to put an SKU there or mark maintenance; click a date header to mark a holiday for all machines; "Minggu libur" makes Sundays off.
- **PP target vs PP rencana.** Target = PP from Saran Buffer (forecast + buffer − stok bebas); it can be typed over in the plan (double-click). Rencana = the sum of the SKU's daily targets on the schedule, i.e. the planned output; machine rows show their planned output (cartons and tonnes), type and total rows show target vs rencana with the difference.
- **No mockup with real data.** The sample machines and the MOCKUP label only appear with the built-in sample data. With real data, every machine in the machine list is shown with its type. A machine without capacity gets an empty row and is never used by the automatic plan, though SKUs can still be placed on it by hand. An SKU whose machine type is only guessed from its name is not scheduled automatically; it waits under *Belum terjadwal* until a Kelompok SKU matches it or a type is picked in the table.
- **Frozen panes, like Excel.** The table scrolls sideways inside its own box, with the horizontal scrollbar pinned to the bottom of the screen. The SKU, Target, Rencana and Hari columns stay put when it scrolls left or right, and the date header row stays at the top while the page scrolls down. The page keeps one vertical scrollbar.
- **Target and rencana.** The target comes from Saran Buffer and can be typed over (it then stops following Saran Buffer; Delete returns it). The rencana is not typed: it is always the SKU's total in the jadwal (the sum of its daily targets on all its bars), and the cell shows ⚠ with the difference when it doesn't match the target (also listed under "Jadwal perlu dicek").
- **Split bars (A → B → A).** Click a bar, pick the day to split at and optionally an SKU to run in between and for how many days. The second part of the bar and every later bar on that machine move back by that many days. Double-clicking an empty day can also add an SKU as an extra part (its PP is spread over all its parts) instead of moving it. A part can be deleted from the bar menu.
- **Ekspor Excel.** Downloads `Rencana_Produksi_<plant>_<bulan>.xlsx`: the plan sheet (machine rows show which SKU runs each day, SKU rows show daily targets in cartons, a calendar row shows off days), a list of bars, PP per SKU with the ⚠ flag, and the month's calendar.
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

## Asisten (prototipe)

The **Asisten** button (bottom right, every tab) opens a chat panel.

- **Rules engine (always on, free, instant).** Commands: `pp target <SKU> = n` (or `= otomatis`), `pindah <SKU> ke <mesin> tgl n`, `target <SKU> tgl n = v` (or `= otomatis`), `libur tgl n`, `maintenance <mesin> tgl n`, `buffer <SKU> = n alasan …`, `strategi <SKU|famili X> <strategi>`, `mesin <SKU> = <jenis>`, `status <SKU> <aktif|cek|diskontinu|otomatis>`, `order in|forecast hq|stok <SKU> [bulan] = n`, `kapasitas <mesin> = n`, `undo`. Questions: `ringkasan`, `kenapa <SKU>`, `sku bermasalah`, `jadwal`, `stok di bawah buffer`, `stok berlebih`, `kapasitas`, `selisih terbesar`, `cari <nama>`, `apa itu buffer/pp/target/...`. SKU = Nomat, article code or part of the name.
- Every change is shown as a proposal and applied only after **Terapkan**; it goes through the same stores as manual edits (correction log, reasons) and `undo` reverts it.
- **Free-form questions, nothing to download.** The app picks the first engine available:
  1. **Claude through claude.ai** when the page is opened as a claude.ai artifact (runtime `sample` capability). It uses the viewer's own claude.ai plan limits, not API credits; the first question asks for permission.
  2. **Workers AI on the Cloudflare site** (`/api/ask` in `src/index.js`, model `@cf/meta/llama-3.1-8b-instruct`, override with the `AI_MODEL` variable). On the Workers Free plan the daily free allowance just runs out (no charge); on a Workers Paid plan usage beyond the allowance is billed. The endpoint only accepts calls from the app's own origin.
  3. Otherwise rules only.
  The engine gets the facts the app computed and is told to use nothing else; data changes it suggests come back as rule commands that still need Terapkan.
