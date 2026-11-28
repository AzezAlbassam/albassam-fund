#!/usr/bin/env python3
"""
Daily closes for every ticker the fund has ever called, plus the two
benchmarks (GLD for gold, ^GSPC for the S&P 500), saved as one JSON
file the site reads from its own domain. No CORS proxy, no API key.

Also keeps data/splits.json: every stock split of a called ticker, from
Yahoo's split events, or spotted when Yahoo's adjusted closes suddenly
sit a whole multiple away from the saved ones (Yahoo can be a day late
with the event). The site uses it to put old buys in today's shares.

And data/trades.json: the whole trade record as Firestore's public REST
API returns it, so git history can restore a deleted or overwritten call.

Run by .github/workflows/market-data.yml four times a day on weekdays.
Usage: python3 tools/market_data.py <out.json>
"""
import json, os, sys, time, datetime as dt
import urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import monthly_report as R   # fetch_trades(): public Firestore read

BENCH = ["GLD", "^GSPC", "^TASI.SR"]
UA = {"User-Agent": "Mozilla/5.0"}   # a full browser UA gets 429 from Yahoo


def closes(tk, start):
    p1 = int(dt.datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp()) - 10 * 86400
    p2 = int(time.time()) + 86400
    # Yahoo spells class shares BRK-B where CNBC and the site say BRK.B. As spelled
    # first, so ^TASI.SR and VOD.L are never rewritten; main() saves it under tk
    syms = dict.fromkeys([tk, tk.replace(".", "-")])
    for sym, host in [(s, h) for s in syms for h in ("query1", "query2")]:
        u = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
             f"?period1={p1}&period2={p2}&interval=1d&events=split")
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
            sp = [[dt.datetime.fromtimestamp(v["date"], dt.timezone.utc).strftime("%Y-%m-%d"), v["numerator"] / v["denominator"]]
                  for v in (res.get("events") or {}).get("splits", {}).values() if v.get("denominator")]
            return {"d": ds, "c": cs, "name": meta.get("shortName") or meta.get("longName") or "", "splits": sp}
        except Exception as e:
            print(f"  {sym} via {host}: {e}", file=sys.stderr)
            time.sleep(2)
    return None


def spotted(old, new):
    """Split ratio when every shared close moved by the same whole multiple, else None."""
    a = dict(zip(old["d"], old["c"]))
    r = sorted(a[d] / c for d, c in zip(new["d"], new["c"]) if d in a and c and a[d])
    if len(r) < 3:
        return None
    m = r[len(r) // 2]
    if any(abs(x / m - 1) > 0.02 for x in r):
        return None
    for k in (m, 1 / m):   # forward split, or a reverse one
        n = round(k)
        if n >= 2 and abs(k / n - 1) < 0.02:
            return float(n) if k == m else 1 / n
    return None


def save_splits(path, found):
    try:
        have = json.load(open(path))
    except Exception:
        have = {}
    for tk, items in found.items():
        cur = have.get(tk, [])
        for item in items:
            d, r = item[0], item[1]
            # an event that lands within a week of one already kept, at the same
            # ratio, is the same split: Yahoo's own date wins over a spotted one
            same = [x for x in cur if abs(x[1] - r) < 1e-6 and
                    abs((dt.date.fromisoformat(x[0]) - dt.date.fromisoformat(d)).days) <= 7]
            if not same:
                cur.append(list(item))
            elif len(item) == 2 and len(same[0]) > 2:
                cur[cur.index(same[0])] = [d, r]
        have[tk] = sorted(cur)
    with open(path, "w") as f:
        json.dump(have, f, separators=(",", ":"))


def backup(path):
    """Every trades doc, keys sorted: Firestore sends fields in a random order, and
    unsorted the file would change (commit, rebuild the site) on every run.
    Written only once every page came back, so a failed read never saves a short file."""
    docs, tok = [], ""
    while tok is not None:
        d = R.get(f"{R.FS}/trades?pageSize=300&pageToken={urllib.parse.quote(tok)}")
        docs += d.get("documents", [])
        tok = d.get("nextPageToken")
    with open(path, "w") as f:
        json.dump({"documents": docs}, f, indent=1, sort_keys=True)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(R.ROOT, "data", "market.json")
    data = os.path.dirname(os.path.abspath(out))
    trades = R.fetch_trades()
    backup(os.path.join(data, "trades.json"))
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
    sp, kept = os.path.join(data, "splits.json"), {}
    try:
        kept = json.load(open(sp))
    except Exception:
        pass
    found = {tk: s.pop("splits") for tk, s in series.items() if s.get("splits")}
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date()   # New York
    today, week = now.isoformat(), (now - dt.timedelta(days=7)).isoformat()
    for tk, s in old.get("series", {}).items():
        r = tk in series and spotted(s, series[tk])
        if r and any(abs(r * x[1] - 1) < 0.02 and x[0] >= week for x in kept.get(tk, []) + found.get(tk, [])):
            # closes that undo this week's split are Yahoo serving stale history, not a
            # reverse split: keep the saved closes and record nothing.
            # ponytail: a real split undone within the week would wait the week out (Yahoo's event still records it)
            print(f"  {tk}: closes undo this week's split (stale Yahoo answer), keeping the saved ones")
            del series[tk]
        elif r:
            print(f"  {tk}: split {r:g} spotted in the closes")
            found.setdefault(tk, []).append([today, r, "spotted"])
    save_splits(sp, found)
    for tk, s in old.get("series", {}).items():
        if tk not in series:   # a failed ticker keeps yesterday's data
            series[tk] = s
            continue
        # merge by date, new closes win: Yahoo serves TASI (^TASI.SR) as one
        # point only, so its history (seeded from TradingView) grows a day at a time
        new = series[tk]
        byday = dict(zip(s["d"], s["c"])); byday.update(zip(new["d"], new["c"]))
        days = sorted(byday)
        series[tk] = {**new, "d": days, "c": [byday[x] for x in days]}
    # hand corrections win over Yahoo: days it serves wrong (SNDK after its split) or never
    # serves (TASI's Sunday sessions). ponytail: take closes from CNBC's bars if this list grows
    try:
        fixes = json.load(open(os.path.join(data, "closes-fix.json")))
    except Exception:
        fixes = {}
    for tk, days in fixes.items():
        if tk in series and isinstance(days, dict):
            byday = dict(zip(series[tk]["d"], series[tk]["c"])); byday.update(days)
            ds = sorted(byday); series[tk] = {**series[tk], "d": ds, "c": [byday[x] for x in ds]}
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
