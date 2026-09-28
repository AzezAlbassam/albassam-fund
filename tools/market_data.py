#!/usr/bin/env python3
"""
Daily closes for every ticker the fund has ever called, plus the two
benchmarks (GLD for gold, ^GSPC for the S&P 500), saved as one JSON
file the site reads from its own domain. No CORS proxy, no API key.

Run by .github/workflows/market-data.yml twice a day on weekdays.
Usage: python3 tools/market_data.py <out.json>
"""
import json, os, sys, time, datetime as dt
import urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import monthly_report as R   # fetch_trades(): public Firestore read

BENCH = ["GLD", "^GSPC"]
UA = {"User-Agent": "Mozilla/5.0"}   # a full browser UA gets 429 from Yahoo


def closes(tk, start):
    p1 = int(dt.datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp()) - 10 * 86400
    p2 = int(time.time()) + 86400
    for host in ("query1", "query2"):
        u = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(tk)}"
             f"?period1={p1}&period2={p2}&interval=1d")
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=25) as r:
                res = json.load(r)["chart"]["result"][0]
            ds, cs = [], []
            for t, c in zip(res.get("timestamp", []), res["indicators"]["quote"][0]["close"]):
                if c is None:
                    continue
                d = dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%d")
                if ds and ds[-1] == d:
                    cs[-1] = round(c, 4)
                else:
                    ds.append(d); cs.append(round(c, 4))
            meta = res.get("meta", {})
            return {"d": ds, "c": cs, "name": meta.get("shortName") or meta.get("longName") or ""}
        except Exception as e:
            print(f"  {tk} via {host}: {e}", file=sys.stderr)
            time.sleep(2)
    return None


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(R.ROOT, "data", "market.json")
    trades = R.fetch_trades()
    start = min((t["opened"] for t in trades if t["opened"]), default=dt.date.today().isoformat())
    tickers = sorted({t["ticker"] for t in trades if t["ticker"]}) + BENCH
    series = {}
    for tk in tickers:
        s = closes(tk, start)
        if s and s["d"]:
            series[tk] = s
        time.sleep(0.6)
    if not all(b in series for b in BENCH):
        sys.exit("benchmarks missing, keeping the previous file")
    old = {}
    try:
        old = json.load(open(out))
    except Exception:
        pass
    for tk, s in old.get("series", {}).items():   # a failed ticker keeps yesterday's data
        series.setdefault(tk, s)
    doc = {"from": start, "series": series}
    if old.get("from") == doc["from"] and old.get("series") == doc["series"]:
        print("no change")
        return
    doc["asOf"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"wrote {out}: {len(series)} series from {start}")


if __name__ == "__main__":
    main()
