// ============================================================
// The Race, as numbers: our fund's daily value against gold and
// the S&P 500 from the same starting pot.
//
// Fund = the BANKING model used everywhere else (roi.js simulate,
// monthly_report.py): each call is sized by its "% of pot" (wt).
// Closed calls bank wt × final %, open calls count wt × live %.
// Day by day, a call only counts from its open date, is marked at
// that day's close (buys/sells after that day ignored) and banks
// its final % from its close date on. Unsized calls don't count.
// Gold = GLD, S&P 500 = ^GSPC, rebased to the pot the day before
// the first call.
// ============================================================

import { history, stepper } from "./history.js?v=11";

export const GOLD = "GLD", SPX = "^GSPC";

// Fetch everything the race needs. Resolves null if no sized calls
// or the benchmark history could not be loaded.
export async function loadRace(trades, pot, quotes = {}) {
  const sized = trades.filter(t => t.wt > 0 && t.opened);
  if (!sized.length) return null;
  const first = sized.reduce((m, t) => (t.opened < m ? t.opened : m), "9999-99-99");
  const tks = [...new Set(sized.map(t => t.ticker))];
  const [gold, spx, ...hs] = await Promise.all([GOLD, SPX, ...tks].map(tk => history(tk, first)));
  if (!spx.dates.length || !gold.dates.length) return null;
  const hist = Object.fromEntries(tks.map((tk, i) => [tk, hs[i]]));
  // a call held across a trading day with no closes would silently drop out of the line
  const end = t => (t.status === "closed" ? (t.closed || t.opened) : spx.dates.at(-1));
  if (sized.some(t => !hist[t.ticker].dates.length && spx.dates.some(d => d >= t.opened && d < end(t)))) return null;
  return buildRace({ trades: sized, hist, gold, spx, pot, quotes, first });
}

export function buildRace({ trades, hist, gold, spx, pot, quotes = {}, first }) {
  const cal = spx.dates;
  let i0 = cal.findIndex(d => d >= first);
  if (i0 === -1) i0 = cal.length;
  const days = cal.slice(Math.max(0, i0 - 1));        // baseline: last close before the first call
  if (!days.length) return null;

  const at = Object.fromEntries(Object.entries(hist).map(([tk, h]) => [tk, stepper(h)]));
  const g = stepper(gold), s = stepper(spx);
  const g0 = g(days[0]), s0 = s(days[0]);
  const last = days.length - 1;

  const fund = [], goldV = [], spxV = [];
  days.forEach((d, i) => {
    let c = 0;
    const now = i === last;   // the endpoint is "now", exactly like the scoreboard
    for (const t of trades) {
      const livePx = now && t.status === "active" ? quotes[t.ticker]?.c : null;
      if (t.opened > d && !(now && (t.status === "closed" || livePx != null))) continue;
      const w = t.wt / 100;
      if (t.status === "closed" && (now || (t.closed || t.opened) <= d)) { c += w * (t.finalPct || 0) / 100; continue; }
      const r = pctAt(t, livePx ?? at[t.ticker]?.(d), now ? "9999-12-31" : d);
      if (r != null) c += w * r / 100;
    }
    fund.push(pot * (1 + c));
    goldV.push(pot * g(d) / g0);
    spxV.push(pot * s(d) / s0);
  });

  const markers = [];
  for (const t of trades) {
    if (t.opened >= days[0]) markers.push({ d: t.opened, tk: t.ticker, kind: "open" });
    if (t.status === "closed" && t.closed) markers.push({ d: t.closed, tk: t.ticker, kind: "close", pct: t.finalPct });
  }
  return { days, fund, gold: goldV, spx: spxV, pot, first, markers };
}

// A call's blended % on day d, using only its trades up to that day.
function pctAt(t, px, d) {
  let bought = 0, cost = 0, sold = 0, proceeds = 0;
  for (const x of t.txns || []) {
    if (x.d && x.d > d) continue;
    if (x.t === "buy") { bought += x.sh; cost += x.sh * x.px; }
    else { sold += x.sh; proceeds += x.sh * x.px; }
  }
  if (cost <= 0) return null;
  const held = Math.max(0, bought - sold);
  if (held === 0) return ((proceeds - cost) / cost) * 100;
  if (px == null) return null;
  return ((proceeds + held * px - cost) / cost) * 100;
}

// Summary numbers for one series of daily values. Best and worst
// day skip day one: calls opened before the record started all carry
// its date, so day one shows their earlier gains landing at once.
export function seriesStats(days, v) {
  const n = v.length;
  let peak = v[0], dd = 0, best = null, worst = null;
  for (let i = 1; i < n; i++) {
    peak = Math.max(peak, v[i]);
    dd = Math.min(dd, (v[i] / peak - 1) * 100);
    if (i < 2) continue;
    const ch = (v[i] / v[i - 1] - 1) * 100;
    if (!best || ch > best.pct) best = { d: days[i], pct: ch };
    if (!worst || ch < worst.pct) worst = { d: days[i], pct: ch };
  }
  return { ret: (v[n - 1] / v[0] - 1) * 100, end: v[n - 1], maxDD: dd, best, worst };
}

// Month-by-month % change: [{ m: "2026-07", fund, gold, spx }]
export function monthly(race) {
  const out = [];
  let prev = 0;
  race.days.forEach((d, i) => {
    const m = d.slice(0, 7), nextM = race.days[i + 1]?.slice(0, 7);
    if (i === 0 || nextM === m) return;
    const ch = k => (race[k][i] / race[k][prev] - 1) * 100;
    out.push({ m, fund: ch("fund"), gold: ch("gold"), spx: ch("spx") });
    prev = i;
  });
  return out;
}

// Race headline: returns since the start, and our lead in points.
export function raceSummary(race) {
  const n = race.days.length - 1, r = k => (race[k][n] / race[k][0] - 1) * 100;
  const fund = r("fund"), gold = r("gold"), spx = r("spx");
  return { fund, gold, spx, leadGold: fund - gold, leadSpx: fund - spx, value: race.fund[n], asOf: race.days[n] };
}
