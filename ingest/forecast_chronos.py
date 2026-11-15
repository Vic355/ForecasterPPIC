"""Chronos forecasts for the PPIC Forecast Desk, run on your own computer.

Reads the history the app exports ("Unduh histori ringkas" -> Histori_Serang_*.ppic.gz, or the
Histori_Serang_*.xlsx), forecasts order in per SKU for M+1..M+3 with a Chronos foundation model, and
re-forecasts the last closings one month ahead (backtest) so the app can score Chronos against its other
models. Drop the CSV it writes onto the Forecast Desk page: it becomes the "Chronos" model in the ensemble.

    pip install -r ingest/requirements-chronos.txt
    python ingest/forecast_chronos.py Histori_Serang_7079_2025-12_2026-10.ppic.gz

Options:
    --model amazon/chronos-2          default; uses Forecast HQ as a covariate (past + future)
    --model amazon/chronos-bolt-base  smaller/faster, order in only (also -small, -tiny)
    --model naive                     no download; last-3-months average, to test the flow
    --backtest 6                      closings to re-forecast (0 = none)
    --device cpu|cuda|mps             default: cuda if available, else mps, else cpu
    --no-covariates                   Chronos-2 without the Forecast HQ covariate
    --out forecast_chronos.csv

The first run downloads the model from huggingface.co (Chronos-2 is about 0.5 GB). After that it runs offline.
"""
import argparse
import gzip
import json
import math
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

QUANTILES = [0.1, 0.5, 0.9]
COLUMNS = ["sku_key", "nomat", "article_code", "forecast_month", "kind", "origin_month", "p10", "p50", "p90", "model"]


# ---------- reading the history ----------
def load_history(path: Path) -> dict:
    """Return {sheet: DataFrame} from a .ppic.gz (columnar JSON, gzip) or a Histori_Serang .xlsx."""
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b" or path.suffix in (".ppic", ".json"):
        text = gzip.decompress(raw).decode("utf-8") if raw[:2] == b"\x1f\x8b" else raw.decode("utf-8")
        o = json.loads(text)
        if o.get("format") != "ppic-histori":
            sys.exit(f"{path.name}: not a PPIC history file")
        return {k: pd.DataFrame(v["r"], columns=v["c"]) for k, v in o["sheets"].items()}
    xl = pd.ExcelFile(path)
    return {s: xl.parse(s) for s in xl.sheet_names}


def code(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip().upper()
    return s or None


def add_months(m: str, k: int) -> str:
    y, mo = int(m[:4]), int(m[5:7]) - 1 + k
    y += mo // 12
    return f"{y:04d}-{mo % 12 + 1:02d}"


def build_series(sheets: dict):
    """Order in per SKU per closing month (missing after the SKU's first month = 0), HQ per month,
    and Forecast HQ for the months after the latest closing (adj preferred over orig)."""
    b = sheets.get("bulanan")
    if b is None or b.empty:
        sys.exit("The history has no 'bulanan' rows (closing data).")
    b = b.copy()
    b["nomat"] = b["nomat"].map(code)
    b["article_code"] = b["article_code"].map(code)
    b["key"] = b["nomat"].fillna(b["article_code"])
    b = b[b["key"].notna()]
    months = sorted(b["closing_month"].astype(str).str[:7].unique())
    b["m"] = b["closing_month"].astype(str).str[:7]
    hq = b["forecast_hq_rev"].where(pd.to_numeric(b["forecast_hq_rev"], errors="coerce").notna(), b["forecast_hq_orig"])
    b["hq"] = pd.to_numeric(hq, errors="coerce")
    b["oi"] = pd.to_numeric(b["order_in"], errors="coerce")
    oi = b.pivot_table(index="key", columns="m", values="oi", aggfunc="sum").reindex(columns=months)
    hqp = b.pivot_table(index="key", columns="m", values="hq", aggfunc="sum").reindex(columns=months)
    ids = b.groupby("key")[["nomat", "article_code"]].first()

    fut = {}
    f = sheets.get("forecast_hq")
    if f is not None and not f.empty:
        f = f.copy()
        f["key"] = f["nomat"].map(code).fillna(f["article_code"].map(code))
        f["m"] = f["forecast_month"].astype(str).str[:7]
        f["q"] = pd.to_numeric(f["forecast_qty_ctn"], errors="coerce")
        f["rank"] = (f["version"].astype(str) == "adj").astype(int)
        f = f.sort_values("rank").groupby(["key", "m"]).last()
        fut = f["q"].to_dict()  # {(key, month): qty}
    return months, oi, hqp, ids, fut


def context_of(row: pd.Series, upto: int):
    """Order-in values of the first `upto` months, from the SKU's first month on (later gaps = 0)."""
    v = row.iloc[:upto].to_numpy(dtype=float)
    seen = np.where(~np.isnan(v))[0]
    if not len(seen):
        return None, 0
    start = seen[0]
    return np.nan_to_num(v[start:], nan=0.0), start


# ---------- models ----------
class Naive:
    name = "naive (rata-rata 3 bulan)"

    def forecast(self, tasks, horizon):
        out = []
        for t in tasks:
            mu = float(np.mean(t["y"][-3:]))
            out.append(np.array([[mu * 0.7, mu, mu * 1.3]] * horizon))
        return out


class Chronos:
    def __init__(self, model_id, device, covariates):
        try:
            import torch
            from chronos import BaseChronosPipeline
        except ImportError:
            sys.exit("Chronos is not installed. Run: pip install -r ingest/requirements-chronos.txt")
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu"
        self.torch = torch
        print(f"Loading {model_id} on {device} …", file=sys.stderr)
        self.pipe = BaseChronosPipeline.from_pretrained(model_id, device_map=device, torch_dtype=torch.float32)
        self.is2 = type(self.pipe).__name__ == "Chronos2Pipeline"
        self.covariates = covariates and self.is2
        self.name = model_id + (" + Forecast HQ" if self.covariates else "")

    def forecast(self, tasks, horizon):
        """tasks: [{y: past order in, hq_past: same length, hq_future: horizon}] -> [array(horizon, 3)]"""
        if self.is2:
            return self._chronos2(tasks, horizon)
        q, _ = self.pipe.predict_quantiles([self.torch.tensor(t["y"], dtype=self.torch.float32) for t in tasks],
                                           prediction_length=horizon, quantile_levels=QUANTILES)
        return [np.asarray(q[i], dtype=float).reshape(-1, horizon, len(QUANTILES))[0] for i in range(len(tasks))]

    def _chronos2(self, tasks, horizon):
        rows, frows = [], []
        for i, t in enumerate(tasks):
            ts = pd.period_range(end=pd.Period("2000-01", "M") + len(t["y"]) - 1, periods=len(t["y"]), freq="M").to_timestamp()
            for j, y in enumerate(t["y"]):
                r = {"item_id": i, "timestamp": ts[j], "target": float(y)}
                if self.covariates:
                    r["hq"] = t["hq_past"][j]
                rows.append(r)
            if self.covariates:
                fts = pd.period_range(start=pd.Period(ts[-1], "M") + 1, periods=horizon, freq="M").to_timestamp()
                for j in range(horizon):
                    frows.append({"item_id": i, "timestamp": fts[j], "hq": t["hq_future"][j]})
        df = pd.DataFrame(rows)
        fdf = pd.DataFrame(frows) if self.covariates else None
        short = max(len(t["y"]) for t in tasks) < 12
        pred = self.pipe.predict_df(df, future_df=fdf, prediction_length=horizon, quantile_levels=QUANTILES,
                                    id_column="item_id", timestamp_column="timestamp", target="target",
                                    cross_learning=short, batch_size=100, freq="MS")
        qcols = {}
        for c in pred.columns:
            try:
                qcols[round(float(c), 3)] = c
            except (TypeError, ValueError):
                pass
        out = []
        for i in range(len(tasks)):
            p = pred[pred["item_id"] == i].sort_values("timestamp")
            out.append(np.stack([p[qcols[q]].to_numpy(dtype=float) for q in QUANTILES], axis=1))
        return out


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("history", type=Path)
    ap.add_argument("--model", default="amazon/chronos-2")
    ap.add_argument("--backtest", type=int, default=6)
    ap.add_argument("--device", default=None)
    ap.add_argument("--no-covariates", action="store_true")
    ap.add_argument("--out", type=Path, default=Path("forecast_chronos.csv"))
    a = ap.parse_args()

    months, oi, hqp, ids, fut = build_series(load_history(a.history))
    K = len(months)
    model = Naive() if a.model == "naive" else Chronos(a.model, a.device, not a.no_covariates)
    nz = lambda v: None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)
    out = []

    def run(upto, horizon, target_months, kind, hq_future):
        tasks, keys = [], []
        for key, row in oi.iterrows():
            y, start = context_of(row, upto)
            if y is None:
                continue
            hp = hqp.loc[key].iloc[start:upto].to_numpy(dtype=float)
            tasks.append({"y": y, "hq_past": [nz(v) for v in hp], "hq_future": [nz(hq_future(key, m)) for m in target_months]})
            keys.append(key)
        if not tasks:
            return
        res = model.forecast(tasks, horizon)
        origin = months[upto - 1]
        for key, r in zip(keys, res):
            for h, m in enumerate(target_months):
                p10, p50, p90 = (max(0.0, float(x)) for x in r[h])
                out.append({"sku_key": key, "nomat": ids.loc[key, "nomat"], "article_code": ids.loc[key, "article_code"],
                            "forecast_month": m, "kind": kind, "origin_month": origin,
                            "p10": round(p10, 1), "p50": round(p50, 1), "p90": round(p90, 1), "model": model.name})

    # forecast M+1..M+3 after the latest closing
    future = [add_months(months[-1], k) for k in (1, 2, 3)]
    print(f"{len(oi)} SKU, closings {months[0]} … {months[-1]}; forecasting {', '.join(future)}", file=sys.stderr)
    run(K, 3, future, "forecast", lambda key, m: fut.get((key, m)))
    # backtest: each of the last N closings predicted from the months before it (HQ = what that closing reported)
    for b in range(max(1, K - a.backtest), K):
        run(b, 1, [months[b]], "backtest", lambda key, m: hqp.loc[key, m] if m in hqp.columns else None)
        print(f"  backtest {months[b]} done", file=sys.stderr)

    pd.DataFrame(out, columns=COLUMNS).to_csv(a.out, index=False)
    print(f"Wrote {len(out)} rows to {a.out}. Drop it onto the Forecast Desk page.", file=sys.stderr)


if __name__ == "__main__":
    main()
