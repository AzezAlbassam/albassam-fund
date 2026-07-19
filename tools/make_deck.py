#!/usr/bin/env python3
"""Build the standalone gold deck for a given month (or 'inception').
Reuses monthly_report's data helpers. Usage: python3 make_deck.py [inception|YYYY-MM|prev]"""
import sys, os, datetime as dt
import monthly_report as R
from deck_template import build_deck

def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "inception"
    inception = arg in ("inception", "all")
    if inception:
        slug, month_name, first, last = "inception", "Since Inception", "0000-00-00", "9999-99-99"
    else:
        month = dt.date.today().strftime("%Y-%m") if arg in (None, "current") else (
            (dt.date.today().replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m") if arg == "prev" else arg)
        y, m = map(int, month.split("-"))
        slug, month_name = month, dt.date(y, m, 1).strftime("%B %Y")
        first, last = f"{month}-01", f"{month}-31"

    trades = R.fetch_trades()
    pot = R.fetch_settings().get("simStart") or 100000
    tickers = sorted({t["ticker"] for t in trades})
    hist, names = {}, {}
    for tk in tickers:
        h, nm = R.fetch_history(tk); hist[tk] = h; names[tk] = nm
    spx_hist, _ = R.fetch_history("^GSPC")
    last_price = lambda tk: (hist.get(tk) or {}).get(max(hist[tk])) if hist.get(tk) else None
    call_pct = lambda t: t["finalPct"] if t["status"] == "closed" else R.live_pct(t, last_price(t["ticker"]))

    active = [t for t in trades if t["status"] == "active"]
    universe = [t for t in trades if t["status"] == "closed"
                and (t["closed"] or "") >= first and (t["closed"] or "") <= last]

    realized_pct = sum((t["wt"] or 0)/100 * (t["finalPct"] or 0) for t in universe if t["wt"])
    open_pct = sum((t["wt"] or 0)/100 * (call_pct(t) or 0) for t in active if t["wt"] and call_pct(t) is not None)
    total_pct = realized_pct + open_pct
    value = pot * (1 + total_pct/100)
    realized_dollars = pot * realized_pct/100
    pnl = lambda t, p: (t["wt"] or 0)/100 * (p or 0)/100 * pot

    best = max(universe, key=lambda t: t["finalPct"]) if universe else None
    worst = min(universe, key=lambda t: t["finalPct"]) if universe else None
    n_wins = sum(1 for t in universe if (t["finalPct"] or 0) > 0)
    win_rate = round(n_wins/len(universe)*100) if universe else 0

    # daily line (banking) + benchmark
    days = sorted({d for tk in tickers for d in (hist.get(tk) or {}) if first <= d <= last})
    line = []
    for d in days:
        contrib = 0.0
        for t in trades:
            wt = (t["wt"] or 0)/100
            if not wt or (t["opened"] or "0") > d: continue
            if t["status"] == "closed" and (t["closed"] or "9") <= d:
                contrib += wt * (t["finalPct"] or 0)/100
            else:
                px = (hist.get(t["ticker"]) or {}).get(d)
                r = R.live_pct(t, px) if px else None
                if r is not None: contrib += wt * r/100
        line.append((d, pot * (1 + contrib)))
    bench = []
    if line and spx_hist:
        base = None
        for d, _ in line:
            if d in spx_hist:
                base = base or spx_hist[d]; bench.append((d, pot * spx_hist[d]/base))
            elif bench: bench.append((d, bench[-1][1]))
    spx_ret = (bench[-1][1]/bench[0][1] - 1)*100 if len(bench) >= 2 else 0
    alpha = total_pct - spx_ret

    def d01(t):
        d = R.derive(t); sell = t["closePx"] or (d["proceeds"]/d["soldSh"] if d["soldSh"] else 0)
        return d["avgCost"], sell
    closed_ctx = []
    for t in sorted(universe, key=lambda t: -(t["finalPct"] or 0)):
        buy, sell = d01(t)
        closed_ctx.append({"tk": t["ticker"], "name": names.get(t["ticker"]) or t["name"],
                           "pct": t["finalPct"], "wt": round(t["wt"] or 0), "pnl": pnl(t, t["finalPct"]),
                           "buy": buy, "sell": sell})
    open_ctx = [{"tk": t["ticker"], "name": names.get(t["ticker"]) or t["name"], "avg": R.derive(t)["avgCost"],
                 "wt": round(t["wt"] or 0), "pct": call_pct(t), "pnl": pnl(t, call_pct(t))} for t in active]

    money = lambda v: "$" + format(round(v), ",")
    pf = lambda p: ("+" if (p or 0) >= 0 else "") + f"{p:.1f}%"
    top = ", ".join(f"{t['ticker']} {pf(t['finalPct'])}" for t in sorted(universe, key=lambda t:-(t['finalPct'] or 0))[:3])
    opentxt = ", ".join(f"{t['ticker']} {pf(call_pct(t))}" for t in active) or "none"
    narrative = (f"Since inception, the Albassam Fund closed {len(universe)} calls with a {win_rate}% win rate. "
                 f"On a {money(pot)} book the fund grew to {money(value)} — a {pf(total_pct)} return, "
                 f"with {money(realized_dollars)} banked in realized profit and the S&amp;P 500 up just {pf(spx_ret)} "
                 f"over the same stretch. Top movers were {top}. {len(active)} positions remain open ({opentxt}).")

    # period label from close months
    months = sorted({(t["closed"] or "")[:7] for t in universe if t["closed"]})
    plabel = dt.datetime.strptime(months[-1]+"-01", "%Y-%m-%d").strftime("%b %Y") if months else month_name

    ctx = dict(month_name=month_name, period_label=plabel, pot=pot, value=value, total_pct=total_pct,
               realized_dollars=realized_dollars, spx_ret=spx_ret, alpha=alpha,
               win_rate=win_rate, n_closed=len(universe), n_wins=n_wins,
               best={"tk": best["ticker"], "pct": best["finalPct"]} if best else {"tk":"—","pct":0},
               worst={"tk": worst["ticker"], "pct": worst["finalPct"]} if worst else {"tk":"—","pct":0},
               narrative=narrative, line=line, bench=bench, closed=closed_ctx, open=open_ctx)

    outdir = os.path.join(R.ROOT, "reports", slug); os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, "deck.html")
    open(path, "w").write(build_deck(ctx))
    print("deck ->", path)
    print(f"{money(value)} ({pf(total_pct)}) · banked {money(realized_dollars)} · vs S&P {alpha:+.1f} · {len(universe)} closed")

if __name__ == "__main__":
    main()
