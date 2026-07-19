#!/usr/bin/env python3
"""
Albassam Fund — monthly report pack generator.

Pulls the live fund data from Firestore (public read), fetches each
ticker's real daily price history + logo, computes the month's
performance, and writes a report pack into reports/<YYYY-MM>/:

  brief.md    — content spec to hand to Claude design for slides
  report.html — self-contained visual preview (dark theme, charts, logos)

Usage:  python3 monthly_report.py [YYYY-MM]   (defaults to current month)
No dependencies beyond the Python 3 standard library.
"""
import json, sys, os, base64, datetime as dt
import urllib.request, urllib.parse

PROJECT = "albassam-fund"
FS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
UA = {"User-Agent": "Mozilla/5.0"}
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

GREEN, RED, INK, DIM, BG, PANEL = "#3ea768", "#d3564a", "#eaf2ec", "#9eafa3", "#14161a", "#1b1f24"


# ----------------------------- fetch -----------------------------
def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def fval(f):
    for k in ("stringValue", "booleanValue"):
        if k in f: return f[k]
    if "doubleValue" in f: return float(f["doubleValue"])
    if "integerValue" in f: return float(f["integerValue"])
    if "nullValue" in f: return None
    return None


def fetch_trades():
    d = get(f"{FS}/trades?pageSize=200")
    out = []
    for doc in d.get("documents", []):
        f = doc["fields"]
        g = lambda k: fval(f[k]) if k in f else None
        out.append({
            "ticker": g("ticker"), "name": g("name") or "", "status": g("status"),
            "opened": g("opened"), "closed": g("closed"),
            "finalPct": g("finalPct"), "closePx": g("closePx"), "wt": g("wt"),
            "txns": [
                {"t": fval(x["mapValue"]["fields"]["t"]),
                 "sh": fval(x["mapValue"]["fields"]["sh"]),
                 "px": fval(x["mapValue"]["fields"]["px"])}
                for x in (f.get("txns", {}).get("arrayValue", {}).get("values", []) or [])
            ],
        })
    return out


def fetch_settings():
    try:
        d = get(f"{FS}/meta/settings")
        return {k: fval(v) for k, v in d.get("fields", {}).items()}
    except Exception:
        return {}


def fetch_history(ticker):
    """{date -> close} for the last ~2 months."""
    try:
        u = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?interval=1d&range=2mo"
        d = get(u, UA)["chart"]["result"][0]
        ts, cl = d["timestamp"], d["indicators"]["quote"][0]["close"]
        out = {}
        for t, c in zip(ts, cl):
            if c is not None:
                out[dt.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")] = c
        meta = d.get("meta", {})
        return out, (meta.get("shortName") or meta.get("longName") or "")
    except Exception:
        return {}, ""


def fetch_logo(ticker):
    try:
        u = f"https://assets.parqet.com/logos/symbol/{urllib.parse.quote(ticker)}?format=png&size=64"
        req = urllib.request.Request(u, headers=UA)
        with urllib.request.urlopen(req, timeout=15) as r:
            if r.status == 200:
                return "data:image/png;base64," + base64.b64encode(r.read()).decode()
    except Exception:
        pass
    return None


# ----------------------------- derive -----------------------------
def derive(t):
    bought = cost = sold = proceeds = 0.0
    for x in t["txns"]:
        if x["t"] == "buy":
            bought += x["sh"]; cost += x["sh"] * x["px"]
        else:
            sold += x["sh"]; proceeds += x["sh"] * x["px"]
    avg = cost / bought if bought else 0
    return {"boughtSh": bought, "soldSh": sold, "heldSh": max(0, bought - sold),
            "avgCost": avg, "cost": cost, "proceeds": proceeds}


def live_pct(t, price):
    d = derive(t)
    if d["cost"] <= 0: return None
    if d["heldSh"] == 0: return (d["proceeds"] - d["cost"]) / d["cost"] * 100
    if price is None: return None
    return (d["proceeds"] + d["heldSh"] * price - d["cost"]) / d["cost"] * 100


def resolve_weights(calls):
    sum_exp = sum(c["wt"] for c in calls if c.get("wt"))
    n_auto = sum(1 for c in calls if not c.get("wt"))
    auto = max(0.0, 100 - sum_exp) / n_auto if n_auto else 0.0
    return [(c["wt"] if c.get("wt") else auto) / 100 for c in calls]


# ----------------------------- charts (inline SVG) -----------------------------
def line_chart(points, bench=None, w=920, h=300, pad=44, padl=78):
    """points: [(label, value)] fund line. bench: optional [(label, value)]
    benchmark (S&P 500) drawn as a muted dashed line on the same scale."""
    if len(points) < 2:
        return f'<svg viewBox="0 0 {w} {h}"><text x="{w/2}" y="{h/2}" fill="{DIM}" text-anchor="middle" font-family="monospace">not enough data yet</text></svg>'
    vals = [v for _, v in points]
    bvals = [v for _, v in bench] if bench else []
    lo, hi = min(vals + bvals), max(vals + bvals)
    if hi == lo: hi = lo + 1
    span = hi - lo
    iw, ih = w - padl - pad, h - pad * 2
    X = lambda i, n: padl + iw * i / (n - 1)
    Y = lambda v: pad + ih * (1 - (v - lo) / span)
    xs = [X(i, len(points)) for i in range(len(points))]
    ys = [Y(v) for v in vals]
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
    area = f"{xs[0]:.1f},{pad+ih:.1f} " + pts + f" {xs[-1]:.1f},{pad+ih:.1f}"
    up = vals[-1] >= vals[0]
    col = GREEN if up else RED
    grid = ""
    for gi in range(5):
        gy = pad + ih * gi / 4
        gv = hi - span * gi / 4
        grid += f'<line x1="{padl}" y1="{gy:.1f}" x2="{w-pad}" y2="{gy:.1f}" stroke="{DIM}" stroke-opacity=".15" stroke-dasharray="2 4"/>'
        grid += f'<text x="{padl-8}" y="{gy+4:.1f}" fill="{DIM}" font-size="11" font-family="monospace" text-anchor="end">${gv:,.0f}</text>'
    xlab = ""
    step = max(1, len(points) // 6)
    for i in range(0, len(points), step):
        xlab += f'<text x="{xs[i]:.1f}" y="{h-14}" fill="{DIM}" font-size="10" font-family="monospace" text-anchor="middle">{points[i][0][5:]}</text>'
    benchsvg = legend = ""
    if bench and len(bench) >= 2:
        bpts = " ".join(f"{X(i, len(bench)):.1f},{Y(v):.1f}" for i, (_, v) in enumerate(bench))
        benchsvg = (f'<polyline points="{bpts}" fill="none" stroke="{DIM}" stroke-width="2" '
                    f'stroke-dasharray="5 4" stroke-opacity=".8"/>'
                    f'<circle cx="{X(len(bench)-1, len(bench)):.1f}" cy="{Y(bench[-1][1]):.1f}" r="3.5" fill="{DIM}"/>')
        legend = (f'<g font-family="monospace" font-size="11">'
                  f'<line x1="{padl}" y1="24" x2="{padl+22}" y2="24" stroke="{col}" stroke-width="2.5"/>'
                  f'<text x="{padl+28}" y="28" fill="{INK}">Albassam Fund</text>'
                  f'<line x1="{padl+150}" y1="24" x2="{padl+172}" y2="24" stroke="{DIM}" stroke-width="2" stroke-dasharray="5 4"/>'
                  f'<text x="{padl+178}" y="28" fill="{DIM}">S&amp;P 500</text></g>')
    dot = f'<circle cx="{xs[-1]:.1f}" cy="{ys[-1]:.1f}" r="4" fill="{col}"/>'
    return f'''<svg viewBox="0 0 {w} {h}">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="{col}" stop-opacity=".28"/><stop offset="1" stop-color="{col}" stop-opacity="0"/>
      </linearGradient></defs>
      {grid}
      <polygon points="{area}" fill="url(#lg)"/>
      {benchsvg}
      <polyline points="{pts}" fill="none" stroke="{col}" stroke-width="2.5" stroke-linejoin="round"/>
      {dot}{xlab}{legend}
    </svg>'''


def bars_chart(items, w=920, h=320, pad=44):
    """items: [(ticker, pct, logo)] contribution bars."""
    if not items:
        return ""
    mx = max(abs(p) for _, p, _ in items) or 1
    bw = (w - pad * 2) / len(items)
    zero = h - pad - 30
    scale = (zero - pad) / mx
    bars = ""
    for i, (tk, pct, logo) in enumerate(items):
        cx = pad + bw * i + bw / 2
        bh = abs(pct) * scale
        col = GREEN if pct >= 0 else RED
        y = zero - bh if pct >= 0 else zero
        bars += f'<rect x="{cx-14:.1f}" y="{y:.1f}" width="28" height="{bh:.1f}" rx="4" fill="{col}"/>'
        bars += f'<text x="{cx:.1f}" y="{(y-8) if pct>=0 else (y+bh+16):.1f}" fill="{col}" font-size="12" font-weight="700" font-family="monospace" text-anchor="middle">{pct:+.1f}%</text>'
        if logo:
            bars += f'<image href="{logo}" x="{cx-11:.1f}" y="{zero+8:.1f}" width="22" height="22"/>'
        bars += f'<text x="{cx:.1f}" y="{zero+44:.1f}" fill="{DIM}" font-size="10" font-family="monospace" text-anchor="middle">{tk}</text>'
    axis = f'<line x1="{pad}" y1="{zero}" x2="{w-pad}" y2="{zero}" stroke="{DIM}" stroke-opacity=".3"/>'
    return f'<svg viewBox="0 0 {w} {h}">{axis}{bars}</svg>'


def donut(win, total, size=150):
    if not total:
        return ""
    frac = win / total
    import math
    r, cx, cy = size / 2 - 12, size / 2, size / 2
    a = frac * 2 * math.pi - math.pi / 2
    lx, ly = cx + r * math.cos(-math.pi / 2), cy + r * math.sin(-math.pi / 2)
    ex, ey = cx + r * math.cos(a), cy + r * math.sin(a)
    large = 1 if frac > 0.5 else 0
    return f'''<svg viewBox="0 0 {size} {size}">
      <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{RED}" stroke-opacity=".35" stroke-width="14"/>
      <path d="M {lx:.1f} {ly:.1f} A {r} {r} 0 {large} 1 {ex:.1f} {ey:.1f}" fill="none" stroke="{GREEN}" stroke-width="14" stroke-linecap="round"/>
      <text x="{cx}" y="{cy-2}" fill="{INK}" font-size="26" font-weight="700" font-family="monospace" text-anchor="middle">{frac*100:.0f}%</text>
      <text x="{cx}" y="{cy+18}" fill="{DIM}" font-size="10" font-family="monospace" text-anchor="middle">WIN RATE</text>
    </svg>'''


# ----------------------------- main -----------------------------
def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    inception = arg in ("inception", "all", "alltime")
    if inception:
        slug = "inception"
        month_name = "Since Inception"
        first, last = "0000-00-00", "9999-99-99"
    else:
        if arg in (None, "current"):
            month = dt.date.today().strftime("%Y-%m")
        elif arg == "prev":                      # the calendar month that just ended
            first_of_this = dt.date.today().replace(day=1)
            month = (first_of_this - dt.timedelta(days=1)).strftime("%Y-%m")
        else:
            month = arg
        y, m = map(int, month.split("-"))
        month_name = dt.date(y, m, 1).strftime("%B %Y")
        slug = month
        first = f"{month}-01"
        last = f"{month}-31"

    trades = fetch_trades()
    settings = fetch_settings()
    pot = settings.get("simStart") or 100000

    tickers = sorted({t["ticker"] for t in trades})
    hist, logos, names = {}, {}, {}
    for tk in tickers:
        h, nm = fetch_history(tk)
        hist[tk] = h; names[tk] = nm
        logos[tk] = fetch_logo(tk)
    spx_hist, _ = fetch_history("^GSPC")   # S&P 500 benchmark

    def last_price(tk):
        h = hist.get(tk) or {}
        return h[max(h)] if h else None

    active = [t for t in trades if t["status"] == "active"]
    closed = [t for t in trades if t["status"] == "closed"]
    # "this month" realized = closed within the month window
    realized_month = [t for t in closed if (t["closed"] or "") >= first and (t["closed"] or "") <= last]

    # per-call return
    def call_pct(t):
        return t["finalPct"] if t["status"] == "closed" else live_pct(t, last_price(t["ticker"]))

    # fund signal (weighted active)
    acts = [{"pct": call_pct(t), "wt": t["wt"], "tk": t["ticker"]} for t in active]
    acts = [a for a in acts if a["pct"] is not None]
    fr = resolve_weights(acts)
    frtot = sum(fr) or 1
    fund_signal = sum(f * a["pct"] for f, a in zip(fr, acts)) / frtot if acts else None

    # simulator: waves
    items = []
    for t in trades:
        p = call_pct(t)
        if p is None: continue
        items.append({"from": t["opened"] or "0000", "to": (t["closed"] or "9999") if t["status"] == "closed" else "9999",
                      "pct": p, "wt": t["wt"], "tk": t["ticker"]})
    items.sort(key=lambda x: x["from"])
    waves = []
    for it in items:
        if waves and it["from"] <= waves[-1]["to"]:
            waves[-1]["calls"].append(it); waves[-1]["to"] = max(waves[-1]["to"], it["to"])
        else:
            waves.append({"from": it["from"], "to": it["to"], "calls": [it]})
    sim = pot
    for wv in waves:
        wfr = resolve_weights(wv["calls"])
        deployed = sum(wfr)
        wv["mult"] = sum(f * (1 + c["pct"] / 100) for f, c in zip(wfr, wv["calls"])) + max(0, 1 - deployed)
        sim *= wv["mult"]
    sim_total_pct = (sim / pot - 1) * 100

    # best / worst / win rate (month realized, fall back to all)
    universe = realized_month if realized_month else closed
    best = max(universe, key=lambda t: t["finalPct"]) if universe else None
    worst = min(universe, key=lambda t: t["finalPct"]) if universe else None
    wins = sum(1 for t in universe if (t["finalPct"] or 0) > 0)
    win_rate = round(wins / len(universe) * 100) if universe else 0

    # daily portfolio line — mark to market across the month
    days = sorted({d for tk in tickers for d in (hist.get(tk) or {}) if first <= d <= last})
    line = []
    for d in days:
        # realized locked by day d
        locked = 0.0
        # per day, weight-normalise the calls active on/before d that belong to same wave logic —
        # simplified honest mark: pot * (1 + sum over calls of wavefrac*ret_so_far(d))
        contrib = 0.0
        for wv in waves:
            wfr = resolve_weights(wv["calls"])
            for f, c in zip(wfr, wv["calls"]):
                t = next((x for x in trades if x["ticker"] == c["tk"] and (x["closed"] or "9999") == (None if c["to"] == "9999" else c["to"]) and (x["opened"] or "0000") == c["from"]), None)
                if c["from"] > d:
                    continue
                if c["to"] != "9999" and c["to"] <= d:
                    contrib += f * (c["pct"] / 100)                    # locked realized
                else:
                    px = (hist.get(c["tk"]) or {}).get(d)
                    if t and px:
                        r = live_pct(t, px)
                        if r is not None:
                            contrib += f * (r / 100)                    # mark to market
        line.append((d, pot * (1 + contrib)))

    # benchmark: $pot invested in the S&P 500 across the same days
    bench = []
    if line and spx_hist:
        base = None
        for d, _ in line:
            if d in spx_hist:
                if base is None:
                    base = spx_hist[d]
                bench.append((d, pot * spx_hist[d] / base))
            elif bench:
                bench.append((d, bench[-1][1]))       # carry forward gaps
    spx_ret = (bench[-1][1] / bench[0][1] - 1) * 100 if len(bench) >= 2 else None
    alpha = (sim_total_pct - spx_ret) if spx_ret is not None else None

    # ---- write files ----
    outdir = os.path.join(ROOT, "reports", slug)
    os.makedirs(outdir, exist_ok=True)

    contribs = []
    for t in sorted(universe, key=lambda t: -(t["finalPct"] or 0)):
        contribs.append((t["ticker"], t["finalPct"] or 0, logos.get(t["ticker"])))

    money = lambda v: "$" + format(round(v), ",")
    pctf = lambda p: ("+" if (p or 0) >= 0 else "") + f"{p:.1f}%" if p is not None else "—"

    # ------- HTML preview -------
    def logo_img(tk, s=26):
        l = logos.get(tk)
        return (f'<img src="{l}" width="{s}" height="{s}" style="border-radius:50%;background:#fff;vertical-align:middle">'
                if l else f'<span style="display:inline-flex;width:{s}px;height:{s}px;border-radius:50%;background:#2a2f35;color:{GREEN};font:700 12px monospace;align-items:center;justify-content:center;vertical-align:middle">{tk[0]}</span>')

    rows = ""
    for t in sorted(universe, key=lambda t: -(t["finalPct"] or 0)):
        d = derive(t)
        sell = t["closePx"] or (d["proceeds"] / d["soldSh"] if d["soldSh"] else None)
        col = GREEN if (t["finalPct"] or 0) >= 0 else RED
        rows += f'''<tr>
          <td>{logo_img(t["ticker"])} <b>{t["ticker"]}</b> <span class="dim">{names.get(t["ticker"]) or t["name"]}</span></td>
          <td class="mono">{money(d["avgCost"]) if d["avgCost"] else "—"} → {money(sell) if sell else "—"}</td>
          <td class="mono dim">{t["opened"]} → {t["closed"] or "open"}</td>
          <td class="mono">{(str(round(t["wt"]))+"%") if t.get("wt") else "auto"}</td>
          <td class="mono" style="color:{col};font-weight:700;text-align:right">{pctf(t["finalPct"])}</td>
        </tr>'''

    act_rows = ""
    for t in active:
        p = call_pct(t); col = GREEN if (p or 0) >= 0 else RED
        act_rows += f'''<tr>
          <td>{logo_img(t["ticker"])} <b>{t["ticker"]}</b></td>
          <td class="mono">avg {money(derive(t)["avgCost"])} · live {money(last_price(t["ticker"])) if last_price(t["ticker"]) else "—"}</td>
          <td class="mono">{(str(round(t["wt"]))+"%") if t.get("wt") else "auto"}</td>
          <td class="mono" style="color:{col};font-weight:700;text-align:right">{pctf(p)}</td>
        </tr>'''

    fund_col = GREEN if (fund_signal or 0) >= 0 else RED
    sim_col = GREEN if sim_total_pct >= 0 else RED

    html = f'''<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Albassam Fund — {month_name}</title>
<style>
  body{{margin:0;background:{BG};color:{INK};font-family:'Space Grotesk',system-ui,sans-serif;padding:34px}}
  .mono{{font-family:'JetBrains Mono',ui-monospace,monospace}}
  .dim{{color:{DIM};font-size:12px}}
  h1{{letter-spacing:.28em;text-transform:uppercase;color:{GREEN};font-size:26px;margin:0}}
  .sub{{color:{DIM};font-family:monospace;letter-spacing:.2em;text-transform:uppercase;font-size:12px;margin-top:6px}}
  .kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:26px 0}}
  .kpi{{background:{PANEL};border:1px solid rgba(62,167,104,.2);border-radius:12px;padding:16px}}
  .kpi .k{{font-family:monospace;font-size:10px;letter-spacing:.2em;color:{DIM};text-transform:uppercase}}
  .kpi .v{{font-family:monospace;font-size:26px;font-weight:700;margin-top:6px}}
  .panel{{background:{PANEL};border:1px solid rgba(62,167,104,.2);border-radius:14px;padding:20px;margin:18px 0}}
  .panel h2{{font-family:monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:{GREEN};margin:0 0 14px}}
  table{{width:100%;border-collapse:collapse}}
  td{{padding:10px 8px;border-bottom:1px solid rgba(158,175,163,.12);font-size:14px}}
  th{{text-align:left;font-family:monospace;font-size:10px;letter-spacing:.16em;color:{DIM};text-transform:uppercase;padding:0 8px 8px}}
  .flex{{display:flex;gap:20px;flex-wrap:wrap;align-items:center}}
  .panel svg{{display:block;width:100%;height:auto;max-height:360px}}
  .panel.donutp svg{{max-height:170px}}
</style></head><body>
  <h1>Albassam Fund</h1>
  <div class="sub">{'Performance Report' if inception else 'Monthly Report'} · {month_name}</div>

  <div class="kpis">
    <div class="kpi"><div class="k">$1M-style Sim Value</div><div class="v">{money(sim)}</div></div>
    <div class="kpi"><div class="k">Total Return</div><div class="v mono" style="color:{sim_col}">{pctf(sim_total_pct)}</div></div>
    <div class="kpi"><div class="k">vs S&amp;P 500</div><div class="v mono" style="color:{GREEN if (alpha or 0)>=0 else RED};font-size:22px">{(('+' if alpha>=0 else '')+f'{alpha:.1f} pts') if alpha is not None else '—'}</div></div>
    <div class="kpi"><div class="k">Fund Signal · open</div><div class="v mono" style="color:{fund_col}">{pctf(fund_signal)}</div></div>
    <div class="kpi"><div class="k">Calls Closed</div><div class="v">{len(universe)}</div></div>
    <div class="kpi"><div class="k">Best</div><div class="v mono" style="color:{GREEN};font-size:18px">{best["ticker"] if best else "—"} {pctf(best["finalPct"]) if best else ""}</div></div>
    <div class="kpi"><div class="k">Worst</div><div class="v mono" style="color:{RED};font-size:18px">{worst["ticker"] if worst else "—"} {pctf(worst["finalPct"]) if worst else ""}</div></div>
  </div>

  <div class="panel"><h2>Portfolio Value vs S&amp;P 500 · {month_name}</h2>{line_chart(line, bench)}</div>

  <div class="panel"><h2>Contribution by Call</h2>{bars_chart(contribs)}</div>

  <div class="flex">
    <div class="panel" style="flex:1;min-width:280px"><h2>Open Positions</h2>
      <table><tr><th>Stock</th><th>Basis</th><th>Pot</th><th style="text-align:right">ROI</th></tr>{act_rows or '<tr><td class="dim">none</td></tr>'}</table>
    </div>
    <div class="panel donutp" style="width:210px;text-align:center"><h2>Win Rate</h2>{donut(wins, len(universe))}</div>
  </div>

  <div class="panel"><h2>Closed Calls · {month_name}</h2>
    <table><tr><th>Stock</th><th>Bought → Sold</th><th>Window</th><th>Pot</th><th style="text-align:right">Result</th></tr>{rows}</table>
  </div>

  <div class="sub" style="text-align:center;margin-top:26px">Generated {dt.date.today()} · data via Firestore + Yahoo Finance · ✦ idea from Rejooo ✦</div>
</body></html>'''

    with open(os.path.join(outdir, "report.html"), "w") as f:
        f.write(html)

    # ------- markdown brief (for Claude design) -------
    md = [f"# Albassam Fund — {month_name} Report Brief\n",
          "_Hand this to Claude design to build the slide deck. Every number below is live from the fund database._\n",
          "## Headline numbers (cover slide)\n",
          f"- **Simulated fund value** (starting pot {money(pot)}): **{money(sim)}**",
          f"- **Total return to date:** {pctf(sim_total_pct)}",
          (f"- **S&P 500 same period:** {pctf(spx_ret)}  →  **fund beat the market by {alpha:+.1f} points**" if alpha is not None else ""),
          f"- **Open-positions fund signal:** {pctf(fund_signal)}",
          f"- **Calls closed this month:** {len(universe)}  ·  **Win rate:** {win_rate}%",
          f"- **Best call:** {best['ticker']} {pctf(best['finalPct'])}" if best else "",
          f"- **Worst call:** {worst['ticker']} {pctf(worst['finalPct'])}" if worst else "",
          "\n## Slide: Portfolio value vs S&P 500 line chart\n",
          f"Daily marked-to-market value of the fund across {month_name}. Start {money(line[0][1]) if line else '—'} → latest {money(line[-1][1]) if line else '—'}.",
          "Two lines: solid green = Albassam Fund, dashed grey = S&P 500 (same starting pot).",
          "Data points (date, fund value, S&P 500 value):",
          "```",
          "\n".join(f"{d}  fund {money(v)}   spx {money(dict(bench).get(d)) if dict(bench).get(d) else '—'}" for d, v in line) or "(not enough daily data)",
          "```",
          "\n## Slide: Contribution by call (bar chart)\n",
          "| Stock | Result | Pot share |",
          "|---|---|---|"]
    for tk, pct, _ in contribs:
        t = next(x for x in universe if x["ticker"] == tk)
        md.append(f"| {tk} | {pctf(pct)} | {(str(round(t['wt']))+'%') if t.get('wt') else 'auto'} |")
    md += ["\n## Slide: Open positions\n", "| Stock | Avg cost | Pot share | Live ROI |", "|---|---|---|---|"]
    for t in active:
        p = call_pct(t)
        md.append(f"| {t['ticker']} ({names.get(t['ticker']) or t['name']}) | {money(derive(t)['avgCost'])} | {(str(round(t['wt']))+'%') if t.get('wt') else 'auto'} | {pctf(p)} |")
    md += ["\n## Slide: All closed calls this month\n", "| Stock | Bought → Sold | Window | Pot share | Result |", "|---|---|---|---|---|"]
    for t in sorted(universe, key=lambda t: -(t["finalPct"] or 0)):
        d = derive(t); sell = t["closePx"] or (d["proceeds"] / d["soldSh"] if d["soldSh"] else None)
        md.append(f"| {t['ticker']} | {money(d['avgCost'])} → {money(sell) if sell else '—'} | {t['opened']} → {t['closed'] or 'open'} | {(str(round(t['wt']))+'%') if t.get('wt') else 'auto'} | {pctf(t['finalPct'])} |")
    md += ["\n## Waves (how the pot was deployed)\n"]
    for i, wv in enumerate(waves, 1):
        nm = ", ".join(c["tk"] for c in wv["calls"])
        md.append(f"- **Wave {i}** ({wv['from']} → {'open' if wv['to']=='9999' else wv['to']}): {nm} — pot ×{wv['mult']:.2f}")
    md += ["\n## Stock logos\n", "Logos are embedded in report.html (base64). Source URL pattern for fresh pulls:",
           "`https://assets.parqet.com/logos/symbol/<TICKER>?format=png&size=128`\n",
           "Tickers this month: " + ", ".join(tickers)]

    with open(os.path.join(outdir, "brief.md"), "w") as f:
        f.write("\n".join(x for x in md if x is not None))

    print(f"Report pack written to {outdir}/")
    print(f"  report.html  ({len(html):,} bytes)")
    print(f"  brief.md")
    print(f"Headline: {money(sim)} ({pctf(sim_total_pct)}) · {len(universe)} closed · win {win_rate}% · signal {pctf(fund_signal)}")


if __name__ == "__main__":
    main()
