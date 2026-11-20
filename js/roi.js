// ============================================================
// Blended ROI math. A trade holds a list of transactions:
//   { t: "buy" | "sell", sh: shares, px: price, d: "YYYY-MM-DD" }
// Blended ROI = (sale proceeds + value of held shares − total
// cost of all buys) / total cost of all buys.
// ============================================================

// Stock splits, from data/splits.json ({ "SNDK": [["2026-11-20", 8]] }),
// kept up to date by the market-data Action from Yahoo's split events.
// A split multiplies the shares and divides the price of every transaction
// made before it, so the average and the return line up with today's price.
// asOf marks numbers already in post-split shares: an adjusted transaction
// gets the split date, and anything typed in fresh gets today. That keeps
// it from being split twice when a call is saved back.
let SPLITS = {};
export async function loadSplits() {
  try { SPLITS = await (await fetch(new URL("../data/splits.json", import.meta.url), { cache: "no-cache" })).json(); }
  catch (e) { console.warn("splits not loaded:", e); }
}
export function splitAdjust(t) {
  const list = (SPLITS[t.ticker] || []).filter(([d]) => d <= (t.closed || today()));
  if (!list.length || !t.txns?.length) return t;
  let hit = [];
  const txns = t.txns.map(x => {
    let y = x;
    for (const [d, r] of list) if ((y.asOf || y.d) < d && r > 0) { y = { ...y, sh: y.sh * r, px: y.px / r, asOf: d }; hit.push([d, r]); }
    return y;
  });
  if (!hit.length) return t;
  hit = [...new Map(hit.map(h => [h[0], h])).values()];
  return { ...t, txns, splits: hit };
}

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

// The latest buy, when it can be taken back: it has to be the newest
// transaction of an open call and not the buy that opened it. back = the
// "% of pot" it added, which returns to cash.
// ponytail: buys saved before the size was stored on them (first day of
// pot-linked buys, 2026-11-18) get it worked out from their cost; older
// buys never changed the size, so they give nothing back.
export function lastAdd(t) {
  const tx = t.txns || [], b = tx.at(-1);
  if (t.status !== "active" || tx.length < 2 || b.t !== "buy") return null;
  const cost = derive(t).costBasis;
  const back = !(t.wt > 0) ? 0 : b.wt ?? (b.d >= "2026-11-18" && cost > 0 ? (t.wt * b.sh * b.px) / cost : 0);
  return { buy: b, back, wt: t.wt > 0 ? +(t.wt - back).toFixed(2) : t.wt ?? null };
}

// Share-weighted average exit price of a closed call: sells at their
// own prices, any shares still held at close at closePx.
export function exitPx(t) {
  const d = derive(t), rest = t.closePx != null ? d.heldSh : 0, n = d.soldSh + rest;
  return n > 0 ? (d.proceeds + rest * t.closePx) / n : (t.closePx ?? null);
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

// "$X since day one" simulation — BANKING model (no leverage).
// Each call's "% of pot" is the capital put to work in it. Closed
// calls BANK their gain (size × final %); open calls MARK to today
// (size × live %). Total return = banked realized + open unrealized.
// Because calls are sized as a share of the pot and gains bank as
// they close, positions that rotated over time never overlap into
// phantom leverage — you can never make more than you actually put
// in. Each trade's `wt` (% of pot) drives it; unsized trades don't
// count toward the pot until you give them a size.
export function simulate(trades, quotes, start = 100000) {
  let realized = 0, openPct = 0, nClosed = 0, nOpen = 0;
  for (const t of trades) {
    const wt = t.wt > 0 ? t.wt / 100 : 0;
    if (t.status === "closed") {
      if (t.finalPct != null) { realized += wt * t.finalPct; nClosed++; }
    } else {
      const p = statPct(t, quotes);
      if (p != null) { openPct += wt * p; nOpen++; }
    }
  }
  const totalPct = realized + openPct;
  return {
    value: start * (1 + totalPct / 100),
    totalPct, realizedPct: realized, openPct,
    realizedDollars: start * realized / 100,
    nClosed, nOpen,
  };
}

// $100000 -> "$100K", $10000 -> "$10K", $1500000 -> "$1.5M"
export function fmtShortMoney(v) {
  if (v >= 1e6) return "$" + +(v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return "$" + +(v / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return "$" + Math.round(v);
}

export function fmtPct(p, digits = 2) {
  if (p == null || isNaN(p)) return "…";
  const r = Math.round(p * 10 ** digits) / 10 ** digits;
  return (r > 0 ? "+" : "") + r.toFixed(digits) + "%";
}

export function fmtMoney(v) {
  if (v == null || isNaN(v)) return "…";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Cash left in the pot, in % of the pot: 100 minus the share of every open, sized call.
export const cashPct = (trades) =>
  Math.max(0, 100 - trades.reduce((s, t) => s + (t.status === "active" && t.wt > 0 ? +t.wt : 0), 0));

// Free cash (% of pot) at the start of day d: 100 less every sized call
// open then, at its size then (its % now, less buys added from d on).
// Stands in for buys saved before each buy kept its own `cash`.
export function cashOn(trades, d) {
  let used = 0;
  for (const t of trades) {
    if (!(t.wt > 0) || t.opened >= d || (t.closed && t.closed < d)) continue;
    used += t.wt - (t.txns || []).reduce((s, x) => s + (x.t === "buy" && x.wt > 0 && x.d >= d ? +x.wt : 0), 0);
  }
  return Math.max(0, 100 - used);
}

// How much of the free cash a sized buy used: { pot, of } in %, or null.
// ponytail: same-day buys all count against that morning's cash
export function cashUsed(trades, t, b) {
  const pot = b === t.txns?.[0] ? t.wt - t.txns.reduce((s, x) => s + (x !== b && x.t === "buy" && x.wt > 0 ? +x.wt : 0), 0) : b?.wt;
  const cash = b?.cash ?? cashOn(trades, b?.d);
  return pot > 0 && cash > 0 ? { pot: +pot, of: Math.min(100, (pot / cash) * 100) } : null;
}

// Shares that add up to the pot: an open, sized call whose shares cost more
// or less than its "% of pot" of the pot in dollars gets them rescaled.
// The opening part (the first buy, buys with no size of their own, sells)
// scales as one, so its average and return stay the same; each sized add
// becomes its % of the pot at its own price. null = already adds up.
export function resize(t, pot) {
  if (t.status !== "active" || !(t.wt > 0) || !(pot > 0) || !t.txns?.length) return null;
  const sized = (x, i) => i > 0 && x.t === "buy" && x.wt > 0;
  const base = t.wt - t.txns.reduce((s, x, i) => s + (sized(x, i) ? +x.wt : 0), 0);
  const baseCost = t.txns.reduce((s, x, i) => s + (x.t === "buy" && !sized(x, i) ? x.sh * x.px : 0), 0);
  if (!(base > 0) || !(baseCost > 0)) return null;
  const k = (base / 100) * pot / baseCost, r4 = (v) => +v.toFixed(4);
  const txns = t.txns.map((x, i) => ({ ...x, sh: r4(sized(x, i) ? ((x.wt / 100) * pot) / x.px : x.sh * k) }));
  const off = txns.some((x, i) => Math.abs(x.sh - t.txns[i].sh) > 0.005 * t.txns[i].sh);
  return off ? txns : null;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
