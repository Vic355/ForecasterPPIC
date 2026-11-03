# ForecasterPPIC

PPIC Forecast Desk for The Univenus Serang (plan 7079): extract the monthly closing report into tables that feed the ML forecast.

## Input tab (web)

`public/index.html` is the **Input Data & Model** tab, served by a Cloudflare Worker (`wrangler.jsonc`). Everything runs in the browser; files are not uploaded anywhere.

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
| article_code | Article Code | SKU key |
| nomat | NOMAT | SAP material number |
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
| weekly W1–W5 | weekly table right of the main one: OI, GI, OS, GAP OS vs SOH (Total columns skipped) | order timing |
| uom | sheet name: CT = carton, MT = metric ton (MT sheets are not loaded) | unit |

Month names on the week headers (JUL/APR on an AUG report) are ignored.

## Batch loader (Python)

`ingest/ingest_closing.py` does the same extraction and appends each closing to an append-only SQLite store
with a snapshot date (never overwriting), and also reads old (red/strikethrough) codes.

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
