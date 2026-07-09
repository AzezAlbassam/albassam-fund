// ============================================================
// Blended ROI math. A trade holds a list of transactions:
//   { t: "buy" | "sell", sh: shares, px: price, d: "YYYY-MM-DD" }
// Blended ROI = (sale proceeds + value of held shares − total
// cost of all buys) / total cost of all buys.
// ============================================================

export function derive(trade) {
  let boughtSh = 0, costBasis = 0, soldSh = 0, proceeds = 0;
  for (const tx of trade.txns || []) {
    if (tx.t === "buy") { boughtSh += tx.sh; costBasis += tx.sh * tx.px; }
    else { soldSh += tx.sh; proceeds += tx.sh * tx.px; }
  }
  const heldSh = Math.max(0, boughtSh - soldSh);
  const avgCost = boughtSh > 0 ? costBasis / boughtSh : 0;
  return { boughtSh, soldSh, heldSh, costBasis, proceeds, avgCost };
}

// Blended ROI % of an active trade at a given live price.
// Falls back to null when there is no price yet.
export function blendedPct(trade, livePx) {
  const d = derive(trade);
  if (d.costBasis <= 0) return null;
  if (d.heldSh === 0) return ((d.proceeds - d.costBasis) / d.costBasis) * 100;
  if (livePx == null) return null;
  return ((d.proceeds + d.heldSh * livePx - d.costBasis) / d.costBasis) * 100;
}

// ROI % a trade shows in stats: live blended for active trades,
// the locked-in finalPct for closed ones.
export function statPct(trade, quotes) {
  if (trade.status === "closed") return trade.finalPct;
  const q = quotes[trade.ticker];
  return blendedPct(trade, q ? q.c : null);
}

// Resolve "% of pot" weights for a group of calls held together.
// Calls with an explicit wt keep it; the rest split what's left
// of 100% equally. Returns fractions (0..1).
export function resolveWeights(calls) {
  const sumExp = calls.reduce((a, c) => a + (c.wt > 0 ? c.wt : 0), 0);
  const nAuto = calls.filter(c => !(c.wt > 0)).length;
  const auto = nAuto ? Math.max(0, 100 - sumExp) / nAuto : 0;
  return calls.map(c => (c.wt > 0 ? c.wt : auto) / 100);
}

export function computeStats(trades, quotes) {
  const active = trades.filter(t => t.status === "active");
  const closed = trades.filter(t => t.status === "closed");

  // Fund signal: pot-share-weighted average ROI of active calls
  const acts = active.map(t => ({ pct: statPct(t, quotes), wt: t.wt }))
    .filter(x => x.pct != null);
  const fr = resolveWeights(acts);
  const frTot = fr.reduce((a, b) => a + b, 0);
  const avgActive = acts.length && frTot > 0
    ? acts.reduce((a, x, i) => a + fr[i] * x.pct, 0) / frTot
    : (acts.length ? acts.reduce((a, x) => a + x.pct, 0) / acts.length : null);

  const closedPcts = closed.map(t => t.finalPct).filter(p => p != null);
  const avgClosed = closedPcts.length
    ? closedPcts.reduce((a, b) => a + b, 0) / closedPcts.length : null;

  let best = null, worst = null;
  for (const t of trades) {
    const p = statPct(t, quotes);
    if (p == null) continue;
    if (!best || p > best.pct) best = { ticker: t.ticker, pct: p };
    if (!worst || p < worst.pct) worst = { ticker: t.ticker, pct: p };
  }

  const wins = closedPcts.filter(p => p > 0).length;
  const winRate = closedPcts.length ? Math.round((wins / closedPcts.length) * 100) : null;

  return { nOpen: active.length, nClosed: closed.length, avgActive, avgClosed, best, worst, winRate };
}

// "$X since day one" simulation. Calls whose holding periods
// overlap form one WAVE: the pot splits equally across the wave
// and each call compounds its share; waves then compound in
// chronological order. Waves are derived purely from each call's
// buy/sell dates, so editing a call regroups everything.
export function simulate(trades, quotes, start = 100000) {
  const items = trades.map(t => {
    const pct = t.status === "closed" ? t.finalPct : statPct(t, quotes);
    if (pct == null) return null;
    return {
      from: t.opened || "0000-00-00",
      to: t.status === "closed" ? (t.closed || t.opened || "9999-99-99") : "9999-99-99",
      pct, wt: t.wt,
    };
  }).filter(Boolean).sort((a, b) => a.from.localeCompare(b.from));

  const waves = [];
  for (const it of items) {
    const w = waves[waves.length - 1];
    if (w && it.from <= w.to) {
      w.calls.push(it);
      if (it.to > w.to) w.to = it.to;
    } else {
      waves.push({ from: it.from, to: it.to, calls: [it] });
    }
  }
  let value = start;
  for (const w of waves) {
    // pot-share weighted: each call grows its slice, whatever
    // isn't deployed (weights under 100%) sits as cash
    const fr = resolveWeights(w.calls);
    const deployed = fr.reduce((a, b) => a + b, 0);
    w.mult = w.calls.reduce((a, c, i) => a + fr[i] * (1 + c.pct / 100), 0)
      + Math.max(0, 1 - deployed);
    value *= w.mult;
  }
  return { value, totalPct: (value / start - 1) * 100, waves, nCalls: items.length };
}

// $100000 -> "$100K", $10000 -> "$10K", $1500000 -> "$1.5M"
export function fmtShortMoney(v) {
  if (v >= 1e6) return "$" + +(v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return "$" + +(v / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return "$" + Math.round(v);
}

export function fmtPct(p, digits = 2) {
  if (p == null || isNaN(p)) return "—";
  const r = Math.round(p * 10 ** digits) / 10 ** digits;
  return (r > 0 ? "+" : "") + r.toFixed(digits) + "%";
}

export function fmtMoney(v) {
  if (v == null || isNaN(v)) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
