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
  const list = (SPLITS[t.ticker] || []).filter(([d, r]) => r > 0 && d <= (t.closed || today()));
  if (!list.length || !t.txns?.length) return t;
  const txns = t.txns.map(x => {
    let y = x;
    for (const [d, r] of list) if ((y.asOf || y.d) < d) y = { ...y, sh: y.sh * r, px: y.px / r, asOf: d };
    return y;
  });
  // the note follows the trade dates, so it stays once adjusted buys are saved back with asOf
  return { ...t, txns, splits: list.filter(([d]) => t.txns.some(x => x.d < d)) };
}

// A closed call's later splits (after its close date): its saved daily
// closes are in today's split shares, so its old prices must be scaled
// back up before they meet its pre-split buys.
export const afterClose = (t) =>
  (SPLITS[t.ticker] || []).reduce((k, [d, r]) => (t.closed && d > t.closed && d <= today() && r > 0 ? k * r : k), 1);

export function derive(trade) {
  let boughtSh = 0, costBasis = 0, soldSh = 0, proceeds = 0;
  for (const tx of trade.txns || []) {
    if (tx.t === "buy") { boughtSh += tx.sh; costBasis += tx.sh * tx.px; }
    else { soldSh += tx.sh; proceeds += tx.sh * tx.px; }
  }
  // ponytail: shares are kept to 4 decimals; 6 drops float dust (150 + 0.1 + 0.2 = 150.29999999999998)
  boughtSh = +boughtSh.toFixed(6); soldSh = +soldSh.toFixed(6);
  const heldSh = Math.max(0, +(boughtSh - soldSh).toFixed(6));
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

// ---- The pot grows with what is banked ----------------------------
// A "% of pot" is a share of the pot ON THE DAY OF THE BUY: the start
// ($100K) plus everything banked by then ($168,648 since Aug 7). k is
// that pot over the start. A sized buy saves its own k; older buys work
// it out: the July/August calls were all sized on the flat start (k = 1),
// later ones on the start plus the calls closed before their day.
// ponytail: Aug 8 = the day after the last July/August close; buys on and
// after it without a saved k were sized on the grown pot (owner, Nov 20).
const GROWS_FROM = "2026-08-08";
const kMemo = new WeakMap();
function kAt(trades, d) {
  if (!d || d < GROWS_FROM) return 1;
  let m = kMemo.get(trades);
  if (!m) kMemo.set(trades, (m = new Map()));
  if (m.has(d)) return m.get(d);
  m.set(d, 1);   // a loop in odd dates falls back to the flat start
  const k = 1 + trades.reduce((s, c) => s + (c.status === "closed" && c.closed && c.closed < d && c.finalPct != null
    ? sizePts(c, trades) * c.finalPct / 100 : 0), 0) / 100;
  m.set(d, k);
  return k;
}
const kOf = (x, trades) => (x.k > 0 ? +x.k : kAt(trades, x.d));

// A call's txns with what its buys on the grown pot still work out written
// in, or null when there is nothing to write: k on every such buy, and on an
// add saved before adds kept their size (before Nov 18), its "% of pot" from
// its cost (start: the pot's start in $). Saved once, the sizes stay put even
// if an old closed call is edited later; the call's total size is unchanged.
export function withK(t, trades, start) {
  let n = 0;
  const tx = t.txns || [], opening = t.wt - tx.reduce((s, x, i) => s + (i && x.t === "buy" && x.wt > 0 ? +x.wt : 0), 0);
  let room = opening;   // what the opening buy holds; an add's size comes out of it and must leave it above 0
  const txns = tx.map((x, i) => {
    if (x.t !== "buy" || !x.d || x.d < GROWS_FROM) return x;
    let y = x;
    const k = x.k > 0 ? +x.k : +kAt(trades, x.d).toFixed(6);
    if (!(x.k > 0)) { y = { ...y, k }; n++; }
    if (i && !(x.wt > 0) && t.wt > 0 && start > 0 && x.sh > 0 && x.px > 0) {
      const w = +((x.sh * x.px) / (start * k) * 100).toFixed(4);
      if (w < room - 0.01) { y = { ...y, wt: w }; room -= w; n++; }
    }
    return y;
  });
  return n ? txns : null;
}

// A call's size in points of the start, buy by buy: each add holds the
// "% of pot" saved on it, the opening buy the rest of the call's wt.
// upTo: only the buys made by that day (the size the call had then).
export function sizePts(t, trades, upTo) {
  if (!(t.wt > 0)) return 0;
  const tx = t.txns || [];
  if (!tx.length) return upTo && t.opened > upTo ? 0 : t.wt * kAt(trades, t.opened);
  const opening = t.wt - tx.reduce((s, x, i) => s + (i && x.t === "buy" && x.wt > 0 ? +x.wt : 0), 0);
  return tx.reduce((s, x, i) => (x.t !== "buy" || (upTo && x.d > upTo) ? s
    : s + (i ? (x.wt > 0 ? +x.wt : 0) : opening) * kOf(x, trades)), 0);
}

// Banked, in % of the start: every closed call's size × its final %.
export const bankedPct = (trades) => trades.reduce((s, t) =>
  s + (t.status === "closed" && t.finalPct != null ? sizePts(t, trades) * t.finalPct / 100 : 0), 0);

// Today's pot over the start (1.686 = $168,648 on $100K).
export const potK = (trades) => 1 + bankedPct(trades) / 100;

// "% of pot" as it stands: an open call's share of TODAY's pot, a closed
// call's share of the pot it was sized on. Same as wt until a call closes
// after a later buy; the cash bar, the size labels and "on the pot" use it.
export const share = (t, trades) => (!(t.wt > 0) ? 0 : t.status === "closed" ? +t.wt : +(sizePts(t, trades) / potK(trades)).toFixed(4));

// "$X since day one" — BANKING model (no leverage). Each call's "% of
// pot" is the capital put to work in it. Closed calls BANK their gain
// (size × final %); open calls MARK to today (size × live %). Sizes are
// counted in points of the START (sizePts), so a call sized on the grown
// pot weighs what its money weighs: total = banked + open, in dollars.
// openPct = the open calls' gain or loss in % of TODAY's pot.
export function simulate(trades, quotes, start = 100000) {
  let realized = 0, open = 0, nClosed = 0, nOpen = 0;
  for (const t of trades) {
    const w = sizePts(t, trades) / 100;
    if (t.status === "closed") {
      if (t.finalPct != null) { realized += w * t.finalPct; nClosed++; }
    } else {
      const p = statPct(t, quotes);
      if (p != null) { open += w * p; nOpen++; }
    }
  }
  const totalPct = realized + open, k = 1 + realized / 100;
  return {
    value: start * (1 + totalPct / 100),
    totalPct, realizedPct: realized, openPct: open / k,
    pot: start * k,
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

// A number as typed on any phone: Arabic-Indic digits, the Arabic decimal
// mark and a decimal comma ("41,5") all read right. Thousands separators
// ("1,000") are refused (NaN) rather than guessed.
export const parseNum = (s) => {
  let t = String(s ?? "").trim().replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 1776).replace(/٫/g, ".");
  if (/^\d+[,،](\d{1,2}|\d{4,})$/.test(t)) t = t.replace(/[,،]/, ".");
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? +t : NaN;
};

export function fmtPct(p, digits = 2) {
  if (p == null || isNaN(p)) return "…";
  const r = Math.round(p * 10 ** digits) / 10 ** digits;
  return (r > 0 ? "+" : "") + r.toFixed(digits) + "%";
}

export function fmtMoney(v) {
  if (v == null || isNaN(v)) return "…";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Cash left in the pot, in % of today's pot: 100 minus the share of every open, sized call.
export const cashPct = (trades) =>
  Math.max(0, +(100 - trades.reduce((s, t) => s + (t.status === "active" ? share(t, trades) : 0), 0)).toFixed(4));

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

// The "% of pot" a call held at the close of day d: its wt now less the
// sized buys added after d (for d = its open date: the size it opened at).
export const wtOn = (t, d) => Math.max(0, (+t.wt || 0) - (t.txns || []).reduce((s, x, i) => s + (i && x.t === "buy" && x.wt > 0 && x.d > d ? +x.wt : 0), 0));

// How much of the free cash a sized buy used: { pot, of } in %, or null.
// ponytail: same-day buys all count against that morning's cash
export function cashUsed(trades, t, b) {
  const pot = b === t.txns?.[0] ? t.wt - t.txns.reduce((s, x) => s + (x !== b && x.t === "buy" && x.wt > 0 ? +x.wt : 0), 0) : b?.wt;
  const cash = b?.cash ?? cashOn(trades, b?.d);
  return pot > 0 && cash > 0 ? { pot: +pot, of: Math.min(100, (pot / cash) * 100) } : null;
}

// Today's New York date (the market's day), wherever the phone is.
export function today() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
