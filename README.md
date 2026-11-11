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

Tab order: Forecast, Saran Buffer, Rencana Produksi (bulanan, belum ada isi, tahap berikutnya), Cek Data SKU, Input Data & Model.

## Rencana Produksi (mockup)

Tab **Rencana Produksi** is a mockup of the monthly production plan, modelled on the PPIC Excel:

- Bulan berjalan M1 = closing + 1 (PP mostly fixed), bulan rencana M2 = closing + 2.
- Stok bebas = stock on hand − outstanding DN − SC block (from the closing). Stok akhir M1 = stok bebas + PP M1 − forecast M1.
- Buffer M2 = the Saran Buffer final buffer, kept at the same cover (buffer ÷ forecast) and applied to forecast M2.
- PP M2 = forecast M2 + buffer M2 − stok akhir M1 (minimum 0). Every number shows cartons and tonnes (net weight).
- PP M1 is editable (type the fixed PP). Machine per SKU is guessed from the name until a Material → Mesin list exists; it can be changed per SKU.
- SKU table groups by machine type (product type, as in the Excel summary tab) or by brand family.
- Summary per machine type in tonnes for both months: forecast, buffer, PP final, capacity, balance (capacity − PP final). Machine types expand to machines with capacity (ton/month) and remarks from the Excel PP Okt–Nov 26; capacity cells are editable.
- Machine per SKU: manual choice > uploaded PP Excel (any sheet with Material + Mesin columns) > guess from the name. Excel values such as SOFTPACK BSR, K-Towel and LUNCHEON are mapped to machine types.
- Manual PP M1 and machines are saved in the browser and in the `rencana_produksi` sheet; capacities and the Material → Mesin list in `kapasitas_mesin`.
