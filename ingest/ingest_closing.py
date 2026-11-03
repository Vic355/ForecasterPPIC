#!/usr/bin/env python3
"""
Ingest one mill's "Stock & Production Control" SKU sheet from the monthly
closing report ("Daily Report Prod & Sales All Mills Closing <MMMYY>") into
an append-only SQLite store, one snapshot per closing.

First mill: The Univenus Serang, plan 7079.

Usage
-----
  # 1. Look at what the script detects before loading anything
  python ingest_closing.py inspect  REPORT.xlsx --plant 7079

  # 2. Load the closing (appends; never overwrites an earlier load)
  python ingest_closing.py load     REPORT.xlsx --plant 7079 --closing 2026-08 --db ppic.sqlite

  # 3. Export the latest load of every closing to CSV for the model
  python ingest_closing.py export   --db ppic.sqlite --out exports/

Options
  --sheet NAME       use this sheet instead of auto-detecting it
  --mapping FILE     JSON {"header text": "field_name"} to fix columns the
                     auto-mapping gets wrong (see FIELDS below for names)

Rules this script follows (from the Forecast Desk brief, section 3):
  * HQ forecast values are stored exactly as received, never corrected.
  * Cartons only. Kg rows are skipped (convert later with net weight).
  * Week headers in the report carry wrong month names (JUL / APR on an
    AUG report), so only the week number W1..W5 is used; dates come from
    --closing.
  * Old (red / strikethrough) material codes become an explicit status.
  * Each load is appended with a snapshot date and load id. Loading the
    same file twice is refused; loading a corrected file for the same
    closing creates a new load, and views pick the latest one.
"""
from __future__ import annotations

import argparse
import calendar
import csv
import datetime as dt
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit("openpyxl is required: pip install openpyxl")

# --------------------------------------------------------------------------
# Field definitions: canonical name -> list of header patterns (lower-case,
# whitespace collapsed). Checked in this order; the first match wins, so
# more specific patterns come first.
# --------------------------------------------------------------------------
FIELDS: list[tuple[str, list[str]]] = [
    ("article_code",          [r"article\s*code", r"kode\s*artikel", r"^article$"]),
    ("nomat",                 [r"\bnomat\b", r"\bno\.?\s*mat\b", r"sap\s*(no|number|material)"]),
    ("description",           [r"description", r"deskripsi", r"nama\s*barang"]),
    ("uom",                   [r"^uom$", r"\bunit\b", r"satuan"]),
    ("net_weight_kg",         [r"net+\s*weight", r"berat\s*bersih"]),
    ("buffer_suggestion",     [r"buffer"]),
    ("opening_stock",         [r"opening"]),
    ("free_stock",            [r"free\s*stock"]),
    ("sc_ready_stock",        [r"sc\s*ready", r"ready\s*stock"]),
    ("stock_on_hand",         [r"stock\s*on\s*hand", r"\bsoh\b"]),
    ("balance_prod",          [r"balance\s*prod"]),
    ("planning_prod",         [r"planning\s*prod", r"plan(ning)?\s*produ"]),
    ("actual_tp_to_wh",       [r"actual", r"tp\s*to\s*w/?h"]),
    ("forecast_hq_orig",      [r"forecast.*orig", r"\(orig"]),
    ("forecast_hq_rev",       [r"forecast.*rev", r"\(rev"]),
    ("inquiry_sdd",           [r"\binq", r"\bsdd\b"]),
    ("outstanding_delivery",  [r"outs"]),
    ("delivery_gi",           [r"\(gi\)|\bgi\b", r"deliver"]),
    ("sc_block",              [r"sc\s*block"]),
    ("waiting_prod",          [r"waiting"]),
    ("order_in",              [r"order\s*in"]),
    ("gap_vs_forecast",       [r"\bgap\b", r"less\s*/\s*over", r"over\s*/\s*less"]),
]
NUMERIC_FIELDS = [f for f, _ in FIELDS
                  if f not in ("article_code", "nomat", "description", "uom")]

# Weekly blocks: a run of W1..W5 (+ Total) headers, e.g. "W1 (1-05 JUL)", under a
# group label (OI, GI, OS, GAP OS vs SOH) one or more rows above. The weekly table
# sits to the right of the main table, after an empty column, and its header row
# may be above the "Article Code" row. Month names in these headers are ignored.
WEEK_HEAD = re.compile(r"^(?:w|wk|week|minggu|mg)\s*\.?\s*([1-5])\b")
WEEKLY_MEASURES = [  # group-label pattern -> measure name (order matters)
    (r"gap", "gap_os_vs_soh"),
    (r"outs|\bos\b", "outstanding"),
    (r"\(gi\)|\bgi\b|deliver", "delivery_gi"),
    (r"order\s*in|\boi\b", "order_in"),
]


def unit_from_sheet(name: str) -> str | None:
    """The unit is in the sheet name: CT = carton, MT = metric ton."""
    s = norm(name)
    if re.search(r"\bct\b|\bctn\b|carton|karton", s):
        return "CT"
    if re.search(r"\bmt\b|\bton\b", s):
        return "MT"
    return None

SNAPSHOT_COLUMNS = ["article_code", "nomat", "description", "family", "uom",
                    "net_weight_kg", "code_status"] + [
    f for f in NUMERIC_FIELDS if f != "net_weight_kg"]


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def norm(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def parse_number(value):
    """Return (number|None, problem|None). Handles Indonesian format
    (1.234.567,89), accounting dashes and Excel errors."""
    if value is None:
        return None, None
    if isinstance(value, bool):
        return None, "boolean"
    if isinstance(value, (int, float)):
        return float(value), None
    s = str(value).strip()
    if s == "":
        return None, None
    if s.startswith("#"):                       # #REF!, #N/A, #DIV/0!
        return None, s
    if s in {"-", "–", "—"}:
        return 0.0, None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace(" ", "").replace(" ", "")
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", s) or re.fullmatch(r"-?\d+,\d+", s):
        s = s.replace(".", "").replace(",", ".")    # Indonesian
    elif re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", s):
        s = s.replace(",", "")                      # English
    try:
        n = float(s)
    except ValueError:
        return None, f"not a number: {value!r}"
    return (-n if neg else n), None


def looks_like_code(value) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return bool(re.fullmatch(r"[0-9A-Z][0-9A-Z\-]{5,}", str(value).strip().upper()))


def clean_code(value) -> str:
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip().upper()


def is_old_code(cell) -> bool:
    """Red text or strikethrough marks an old material code in the report."""
    f = cell.font
    if f is None:
        return False
    if f.strike:
        return True
    c = f.color
    if c is not None and c.type == "rgb" and isinstance(c.rgb, str):
        rgb = c.rgb[-6:].upper()
        r, g, b = int(rgb[0:2], 16), int(rgb[2:4], 16), int(rgb[4:6], 16)
        return r >= 0xB0 and g <= 0x50 and b <= 0x50
    return False


def closing_to_date(closing: str) -> dt.date:
    y, m = (int(x) for x in closing.split("-"))
    return dt.date(y, m, calendar.monthrange(y, m)[1])


# --------------------------------------------------------------------------
# Sheet detection and header parsing
# --------------------------------------------------------------------------
def find_sheet(wb, plant: str, wanted: str | None):
    if wanted:
        return wb[wanted]
    scored = []
    for ws in wb.worksheets:
        name = norm(ws.title)
        score = 0
        if plant in name:
            score += 3
        if "stock" in name and ("prod" in name or "control" in name):
            score += 1
        unit = unit_from_sheet(ws.title)
        score += 2 if unit == "CT" else (-4 if unit == "MT" else 0)
        # look at the top-left block for the plant code / mill name
        for row in ws.iter_rows(min_row=1, max_row=12, max_col=15, values_only=True):
            text = norm(" ".join(str(v) for v in row if v is not None))
            if plant in text:
                score += 2
            if "stock & production control" in text or "stock and production control" in text:
                score += 2
        if score:
            scored.append((score, ws.title))
    if not scored:
        raise SystemExit(f"No sheet mentions plant {plant}. Use --sheet. Sheets: "
                         + ", ".join(ws.title for ws in wb.worksheets))
    scored.sort(reverse=True)
    return wb[scored[0][1]]


def merged_value_grid(ws, rows: range, max_col: int):
    """Values for header rows with merged cells filled in across their span."""
    grid = {r: [ws.cell(r, c).value for c in range(1, max_col + 1)] for r in rows}
    for mr in ws.merged_cells.ranges:
        v = ws.cell(mr.min_row, mr.min_col).value
        for r in range(mr.min_row, mr.max_row + 1):
            if r in grid:
                for c in range(mr.min_col, min(mr.max_col, max_col) + 1):
                    grid[r][c - 1] = v
    return grid


def detect_layout(ws, mapping_override: dict | None = None):
    max_col = ws.max_column
    anchor = None
    for r in range(1, min(ws.max_row, 60) + 1):
        texts = [norm(ws.cell(r, c).value) for c in range(1, min(max_col, 40) + 1)]
        if any(re.search(r"article|kode\s*artikel", t) for t in texts):
            anchor = r
            break
    if anchor is None:
        raise SystemExit("Could not find the header row (no 'Article Code' in the first 60 rows).")

    # article-code column on the anchor row
    code_col = next(c for c in range(1, max_col + 1)
                    if re.search(r"article|kode\s*artikel", norm(ws.cell(anchor, c).value)))

    first_data = next((r for r in range(anchor + 1, anchor + 8)
                       if looks_like_code(ws.cell(r, code_col).value)), anchor + 1)
    # Header band: the anchor row plus following rows that carry several
    # labels (e.g. ORIG / REV, W1..W5). A row with a single label is a family
    # heading and ends the band.
    last_header = anchor
    for r in range(anchor + 1, first_data):
        filled = sum(1 for c in range(1, max_col + 1) if ws.cell(r, c).value not in (None, ""))
        if filled < 2:
            break
        last_header = r
    band = range(anchor, last_header + 1)
    grid = merged_value_grid(ws, band, max_col)

    # Weekly blocks (see WEEK_HEAD): scan from 3 rows above the anchor.
    lo = max(1, anchor - 3)
    wgrid = merged_value_grid(ws, range(lo, last_header + 1), max_col)
    txt = lambda r, c: norm(wgrid[r][c - 1]) if lo <= r <= last_header and 1 <= c <= max_col else ""
    weekly: dict[tuple[str, int], int] = {}
    weekly_cols: set[int] = set()
    groups = []
    for r in range(lo, last_header + 1):
        c = 1
        while c <= max_col:
            m1 = WEEK_HEAD.match(txt(r, c))
            if not m1 or m1.group(1) != "1":
                c += 1
                continue
            parent = ""
            for rp in range(r - 1, max(lo, r - 3) - 1, -1):
                parent = next((txt(rp, cp) for cp in range(c, min(c + 5, max_col) + 1) if txt(rp, cp)), "")
                if parent:
                    break
            g = {"row": r, "start": c, "label": parent, "cols": [], "total": None}
            cc = c
            while cc <= min(c + 6, max_col):
                h = txt(r, cc)
                mw = WEEK_HEAD.match(h)
                if mw and (cc == c or mw.group(1) != "1"):
                    g["cols"].append((cc, int(mw.group(1))))
                elif h.startswith("total"):
                    g["total"] = cc
                    break
                elif cc > c:
                    break
                cc += 1
            groups.append(g)
            weekly_cols.update(col for col, _ in g["cols"])
            if g["total"]:
                weekly_cols.add(g["total"])
            c = (g["total"] or g["cols"][-1][0]) + 1
    # A group with no label straight above it takes the labels of that row in order.
    if groups:
        lr = groups[0]["row"] - 1
        row_labels = []
        for cl in range(groups[0]["start"], max_col + 1):
            v = txt(lr, cl)
            if v and v not in row_labels:
                row_labels.append(v)
        for k, g in enumerate(groups):
            if not g["label"] and k < len(row_labels):
                g["label"] = row_labels[k]
    for g in groups:
        g["measure"] = next((name for pat, name in WEEKLY_MEASURES if re.search(pat, g["label"])), None)
        for col, wk in g["cols"]:
            if g["measure"]:
                weekly.setdefault((g["measure"], wk), col)

    headers = {}
    for c in range(1, max_col + 1):
        parts = []
        for r in band:
            t = norm(grid[r][c - 1])
            if t and t not in parts:
                parts.append(t)
        if parts:
            headers[c] = parts

    override = {norm(k): v for k, v in (mapping_override or {}).items()}
    columns: dict[str, int] = {}
    unmapped = {}
    for c, parts in headers.items():
        full = " | ".join(parts)
        leaf = parts[-1]
        if c in weekly_cols and not (full in override or leaf in override):
            continue
        if full in override or leaf in override:
            field = override.get(full) or override.get(leaf)
            m = re.fullmatch(r"(order_in|delivery_gi|outstanding|gap_os_vs_soh)_w([1-5])", field)
            if m:
                weekly[(m.group(1), int(m.group(2)))] = c
            elif field:
                columns.setdefault(field, c)
            continue
        for field, pats in FIELDS:
            if field in columns:
                continue
            if any(re.search(p, full) for p in pats):
                columns[field] = c
                break
        else:
            unmapped[c] = full
    columns.setdefault("article_code", code_col)
    for g in groups:
        if not g["measure"]:
            for col, wk in g["cols"]:
                unmapped[col] = f"{g['label'] or '(no label)'} | W{wk}"
    return {"unit": unit_from_sheet(ws.title), "weekly_groups": groups, "anchor": anchor, "first_data": last_header + 1, "headers": headers,
            "columns": columns, "weekly": weekly, "unmapped": unmapped}


# --------------------------------------------------------------------------
# Row extraction
# --------------------------------------------------------------------------
TOTAL_RE = re.compile(r"\b(total|sub\s*total|grand)\b")


def extract(ws, layout):
    cols, weekly = layout["columns"], layout["weekly"]
    code_c = cols["article_code"]
    desc_c = cols.get("description")
    uom_c = cols.get("uom")
    rows, weekly_rows, issues = [], [], []
    family = None
    seen = {}
    for r in range(layout["first_data"], ws.max_row + 1):
        code_cell = ws.cell(r, code_c)
        desc = ws.cell(r, desc_c).value if desc_c else None
        row_text = norm(" ".join(str(ws.cell(r, c).value) for c in range(1, min(code_c + 4, ws.max_column) + 1)
                                 if ws.cell(r, c).value is not None))
        if not looks_like_code(code_cell.value):
            if row_text and not TOTAL_RE.search(row_text):
                # A label-only row is treated as a family / category header.
                numbers = [ws.cell(r, c).value for c in cols.values() if c != code_c and c != desc_c]
                if not any(isinstance(v, (int, float)) and v for v in numbers):
                    family = (str(desc).strip() if desc else row_text).strip()
            continue
        if uom_c and norm(ws.cell(r, uom_c).value) in {"kg", "kgs", "kilogram"}:
            continue  # cartons only
        code = clean_code(code_cell.value)
        rec = {"article_code": code, "family": family, "source_row": r,
               "nomat": clean_code(ws.cell(r, cols["nomat"]).value)
                        if "nomat" in cols and ws.cell(r, cols["nomat"]).value is not None else None,
               "description": str(desc).strip() if desc is not None else None,
               "uom": (str(ws.cell(r, uom_c).value).strip().upper()
                       if uom_c and ws.cell(r, uom_c).value is not None else layout.get("unit")),
               "code_status": "old" if (is_old_code(code_cell)
                                        or (desc_c and is_old_code(ws.cell(r, desc_c)))) else "active"}
        for f in NUMERIC_FIELDS:
            if f in cols:
                val, prob = parse_number(ws.cell(r, cols[f]).value)
                rec[f] = val
                if prob:
                    issues.append((code, r, "bad_value", f"{f}: {prob}"))
        if code in seen:
            # Second row with the same code: usually the kg line. Keep the first.
            issues.append((code, r, "duplicate_code", f"also on row {seen[code]}; kept the first"))
            continue
        seen[code] = r
        rows.append(rec)
        for (measure, week), c in sorted(weekly.items()):
            val, prob = parse_number(ws.cell(r, c).value)
            if prob:
                issues.append((code, r, "bad_value", f"{measure} W{week}: {prob}"))
            weekly_rows.append({"article_code": code, "measure": measure, "week": week, "qty": val})
    return rows, weekly_rows, issues


def quality_checks(rows, weekly_rows):
    issues = []
    by_code_weeks = {}
    for w in weekly_rows:
        if w["measure"] == "order_in" and w["qty"] is not None:
            by_code_weeks[w["article_code"]] = by_code_weeks.get(w["article_code"], 0) + w["qty"]
    for r in rows:
        code = r["article_code"]
        oi = r.get("order_in") or 0
        orig, rev = r.get("forecast_hq_orig"), r.get("forecast_hq_rev")
        if oi > 0 and not orig and not rev:
            issues.append((code, r["source_row"], "no_hq_forecast", f"order in {oi:,.0f} with no HQ forecast"))
        gap = r.get("gap_vs_forecast")
        if gap is not None and orig is not None:
            calc = (r.get("opening_stock") or 0) + (r.get("actual_tp_to_wh") or 0) - orig
            if abs(calc - gap) > 1:
                issues.append((code, r["source_row"], "gap_check_failed",
                               f"opening + actual - ORIG = {calc:,.0f}, report gap = {gap:,.0f}"))
        if code in by_code_weeks and abs(by_code_weeks[code] - oi) > 1:
            issues.append((code, r["source_row"], "weekly_sum_mismatch",
                           f"W1-W5 order in = {by_code_weeks[code]:,.0f}, monthly = {oi:,.0f}"))
        if r["code_status"] == "old" and ((r.get("stock_on_hand") or 0) > 0):
            issues.append((code, r["source_row"], "old_code_with_stock", f"stock on hand {r['stock_on_hand']:,.0f}"))
    return issues


# --------------------------------------------------------------------------
# Storage (append-only)
# --------------------------------------------------------------------------
SCHEMA = f"""
CREATE TABLE IF NOT EXISTS load_log (
  load_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  plant          TEXT NOT NULL,
  closing_month  TEXT NOT NULL,          -- YYYY-MM
  snapshot_date  TEXT NOT NULL,          -- last day of the closing month
  source_file    TEXT NOT NULL,
  source_sheet   TEXT NOT NULL,
  file_sha256    TEXT NOT NULL,
  loaded_at      TEXT NOT NULL,
  sku_rows       INTEGER,
  issue_count    INTEGER,
  UNIQUE (plant, file_sha256, source_sheet)
);
CREATE TABLE IF NOT EXISTS sku_snapshot (
  load_id        INTEGER NOT NULL REFERENCES load_log(load_id),
  plant          TEXT NOT NULL,
  snapshot_date  TEXT NOT NULL,
  source_row     INTEGER,
  {", ".join(f"{c} {'REAL' if c in NUMERIC_FIELDS else 'TEXT'}" for c in SNAPSHOT_COLUMNS)},
  PRIMARY KEY (load_id, article_code)
);
CREATE TABLE IF NOT EXISTS sku_weekly (
  load_id        INTEGER NOT NULL REFERENCES load_log(load_id),
  plant          TEXT NOT NULL,
  snapshot_date  TEXT NOT NULL,
  article_code   TEXT NOT NULL,
  measure        TEXT NOT NULL,          -- order_in | delivery_gi | outstanding
  week           INTEGER NOT NULL,       -- 1..5 of the closing month
  qty            REAL,
  PRIMARY KEY (load_id, article_code, measure, week)
);
CREATE TABLE IF NOT EXISTS load_issue (
  load_id        INTEGER NOT NULL REFERENCES load_log(load_id),
  article_code   TEXT,
  source_row     INTEGER,
  check_name     TEXT,
  detail         TEXT
);
-- Latest load per plant and closing: what the model and the desk read.
CREATE VIEW IF NOT EXISTS latest_load AS
  SELECT plant, closing_month, MAX(load_id) AS load_id FROM load_log GROUP BY plant, closing_month;
CREATE VIEW IF NOT EXISTS v_sku_monthly AS
  SELECT s.* FROM sku_snapshot s JOIN latest_load l USING (load_id);
CREATE VIEW IF NOT EXISTS v_sku_weekly AS
  SELECT w.* FROM sku_weekly w JOIN latest_load l USING (load_id);
"""


def store(db_path, plant, closing, source, sheet, sha, rows, weekly_rows, issues):
    con = sqlite3.connect(db_path)
    con.executescript(SCHEMA)
    snap = closing_to_date(closing).isoformat()
    try:
        cur = con.execute(
            "INSERT INTO load_log (plant, closing_month, snapshot_date, source_file, source_sheet,"
            " file_sha256, loaded_at, sku_rows, issue_count) VALUES (?,?,?,?,?,?,?,?,?)",
            (plant, closing, snap, Path(source).name, sheet, sha,
             dt.datetime.now().isoformat(timespec="seconds"), len(rows), len(issues)))
    except sqlite3.IntegrityError:
        con.close()
        raise SystemExit("This file was already loaded for this plant and sheet. Nothing written.")
    load_id = cur.lastrowid
    cols = ["load_id", "plant", "snapshot_date", "source_row"] + SNAPSHOT_COLUMNS
    con.executemany(
        f"INSERT INTO sku_snapshot ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
        [[load_id, plant, snap, r["source_row"]] + [r.get(c) for c in SNAPSHOT_COLUMNS] for r in rows])
    con.executemany(
        "INSERT INTO sku_weekly VALUES (?,?,?,?,?,?,?)",
        [(load_id, plant, snap, w["article_code"], w["measure"], w["week"], w["qty"]) for w in weekly_rows])
    con.executemany("INSERT INTO load_issue VALUES (?,?,?,?,?)",
                    [(load_id, *i) for i in issues])
    con.commit()
    con.close()
    return load_id


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------
def open_sheet(args):
    wb = openpyxl.load_workbook(args.file, data_only=True)  # cached values, not formulas
    ws = find_sheet(wb, args.plant, args.sheet)
    override = json.loads(Path(args.mapping).read_text()) if args.mapping else None
    return ws, detect_layout(ws, override)


def cmd_inspect(args):
    ws, lay = open_sheet(args)
    print(f"Sheet: {ws.title!r}   unit {lay['unit'] or 'unknown'} (CT = carton, MT = metric ton)   "
          f"header row {lay['anchor']}, data from row {lay['first_data']}")
    print("\nMapped columns:")
    for f, _ in FIELDS:
        c = lay["columns"].get(f)
        print(f"  {f:22s} " + (f"col {openpyxl.utils.get_column_letter(c):>3}  "
                                f"{' | '.join(lay['headers'].get(c, []))}" if c else "-- NOT FOUND"))
    print("\nWeekly columns:")
    for (m, w), c in sorted(lay["weekly"].items()):
        label = next((g["label"] for g in lay["weekly_groups"] if any(col == c for col, _ in g["cols"])), "")
        print(f"  {m:14s} W{w}  col {openpyxl.utils.get_column_letter(c):>3}  {label}")
    if lay["unmapped"]:
        print("\nHeaders not mapped (ignored unless added with --mapping):")
        for c, h in lay["unmapped"].items():
            print(f"  col {openpyxl.utils.get_column_letter(c):>3}  {h}")
    rows, weekly, issues = extract(ws, lay)
    issues += quality_checks(rows, weekly)
    print(f"\n{len(rows)} SKU rows, {len(issues)} issues. First 5 rows:")
    for r in rows[:5]:
        print("  ", {k: r.get(k) for k in ("article_code", "description", "family",
                                            "forecast_hq_orig", "forecast_hq_rev", "order_in", "free_stock")})
    summarize_issues(issues)


def summarize_issues(issues):
    counts = {}
    for i in issues:
        counts[i[2]] = counts.get(i[2], 0) + 1
    for k, v in sorted(counts.items()):
        print(f"  {k:22s} {v}")


def cmd_load(args):
    ws, lay = open_sheet(args)
    missing = [f for f in ("article_code", "description", "forecast_hq_orig", "forecast_hq_rev", "order_in")
               if f not in lay["columns"]]
    if missing:
        raise SystemExit(f"Required columns not found: {missing}. Run 'inspect' and add --mapping.")
    if lay["unit"] == "MT":
        raise SystemExit(f"Sheet {ws.title!r} is in metric tons. Load the CT (carton) sheet; use --sheet to pick it.")
    rows, weekly, issues = extract(ws, lay)
    issues += quality_checks(rows, weekly)
    sha = hashlib.sha256(Path(args.file).read_bytes()).hexdigest()
    load_id = store(args.db, args.plant, args.closing, args.file, ws.title, sha, rows, weekly, issues)
    print(f"Loaded {len(rows)} SKUs and {len(weekly)} weekly values as load {load_id} "
          f"(plant {args.plant}, closing {args.closing}). Issues:")
    summarize_issues(issues)


def cmd_export(args):
    con = sqlite3.connect(args.db)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name in ("v_sku_monthly", "v_sku_weekly", "load_log", "load_issue"):
        cur = con.execute(f"SELECT * FROM {name}")
        with open(out / f"{name}.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow([d[0] for d in cur.description])
            w.writerows(cur)
        print(f"wrote {out / (name + '.csv')}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("inspect", "load"):
        s = sub.add_parser(name)
        s.add_argument("file")
        s.add_argument("--plant", default="7079")
        s.add_argument("--sheet")
        s.add_argument("--mapping")
        if name == "load":
            s.add_argument("--closing", required=True, help="closing month, YYYY-MM")
            s.add_argument("--db", default="ppic.sqlite")
    s = sub.add_parser("export")
    s.add_argument("--db", default="ppic.sqlite")
    s.add_argument("--out", default="exports")
    args = p.parse_args(argv)
    {"inspect": cmd_inspect, "load": cmd_load, "export": cmd_export}[args.cmd](args)


if __name__ == "__main__":
    main()
