# ForecasterPPIC

PPIC Forecast Desk for The Univenus Serang (plan 7079): extract the monthly closing report into tables that feed the ML forecast.

## Input tab (web)

`public/index.html` is the **Input Data & Model** tab, served by a Cloudflare Worker (`wrangler.jsonc`). Open it and drop in the
"Daily Report Prod & Sales All Mills Closing" Excel file. Everything runs in the browser; the file is not uploaded anywhere.

It shows:

1. **Data yang diambil**: which report column feeds each field, and which headers are ignored.
2. **Pemeriksaan file**: missing HQ forecast, gap check (opening + actual − ORIG), W1–W5 vs monthly order in, #REF! values, kg rows, duplicate codes.
3. **Pratinjau**: the extracted SKU rows, copyable and downloadable as monthly and weekly CSV.

The page opens with a simulated sample so it can be tried without a file.

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
| weekly W1–W5 | under Order In, GI, Outstanding | order timing |

Month names on the week headers (JUL/APR on an AUG report) are ignored.

## Batch loader (Python)

`ingest/ingest_closing.py` does the same extraction and appends each closing to an append-only SQLite store
with a snapshot date (never overwriting), and also reads old (red/strikethrough) codes.

```
python ingest/ingest_closing.py inspect REPORT.xlsx --plant 7079
python ingest/ingest_closing.py load    REPORT.xlsx --plant 7079 --closing 2026-08 --db ppic.sqlite
python ingest/ingest_closing.py export  --db ppic.sqlite --out exports/
```
