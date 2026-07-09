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

export function computeStats(trades, quotes) {
  const active = trades.filter(t => t.status === "active");
  const closed = trades.filter(t => t.status === "closed");

  const activePcts = active.map(t => statPct(t, quotes)).filter(p => p != null);
  const avgActive = activePcts.length
    ? activePcts.reduce((a, b) => a + b, 0) / activePcts.length : null;

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

// "$100K since day one" simulation: the pot compounds through
// every closed call in the order they closed (all-in each time),
// then today's average live ROI of the active calls is applied
// on top (pot split equally across them).
export function simulate(trades, quotes, start = 100000) {
  const closed = trades.filter(t => t.status === "closed" && t.finalPct != null)
    .sort((a, b) => (a.closed || "").localeCompare(b.closed || ""));
  let realized = 1;
  for (const t of closed) realized *= 1 + t.finalPct / 100;
  const pcts = trades.filter(t => t.status === "active")
    .map(t => statPct(t, quotes)).filter(p => p != null);
  const liveAvg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
  const value = start * realized * (1 + liveAvg / 100);
  return { value, totalPct: (value / start - 1) * 100, realized, liveAvg, nClosed: closed.length };
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
