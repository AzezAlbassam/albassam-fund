// ============================================================
// The Ledger: every call on the record. Summary tally, then one
// expandable row per call with a sparkline of the hold. Filter,
// sort and search run client side over rows that stay mounted,
// so expanded rows, sparklines and reveals survive every change.
// ============================================================

import { initShell, observeReveals, onReveal, countTo, roll, usd0, usd2, signedUsd, pct1, day, daysBetween, esc, logoHtml } from "./shell.js?v=12";
import { live, state } from "./live.js?v=12";
import { derive, blendedPct, today, exitPx } from "./roi.js?v=12";
import { history } from "./history.js?v=12";

initShell();

const $ = (s) => document.querySelector(s);

// the title flips up letter by letter
let ci = 0;
document.querySelectorAll(".lhead h1 .w").forEach(w => {
  w.innerHTML = [...w.textContent].map(ch => `<span class="ch" style="--i:${ci++}">${esc(ch)}</span>`).join("");
});
const list = $("#calls"), tally = $("#tally"), emptyEl = $("#empty"), countEl = $("#count");
const ui = { filter: "all", sort: "new", q: "" };
const expanded = new Set();          // ids of open rows
const rows = new Map();              // id -> <li>, kept mounted across renders
const sparks = new Map();            // id -> { key, html }
let byId = new Map();

/* ----------------------- per-call numbers ----------------------- */
const isOpen = (t) => t.status !== "closed";
const pctOf = (t) => isOpen(t) ? blendedPct(t, state.quotes[t.ticker]?.c ?? null) : (t.finalPct ?? null);
const potUsd = (t, p) => (t.wt > 0 && p != null ? (t.wt / 100) * (p / 100) * state.pot : null);
const endOf = (t) => (isOpen(t) ? today() : t.closed || t.opened || "");
const money = (v) => (v == null || isNaN(v) ? "…" : usd2(Number(v)));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const LOW = -1e15;   // sorts missing values last

const FILTERS = {
  all: () => true,
  open: isOpen,
  closed: (t) => !isOpen(t),
  wins: (t) => !isOpen(t) && t.finalPct > 0,
  losses: (t) => !isOpen(t) && t.finalPct < 0,
};
const SORTS = {
  new: (a, b) => cmp(endOf(b), endOf(a)) || cmp(b.opened || "", a.opened || ""),
  gain: (a, b) => (pctOf(b) ?? LOW) - (pctOf(a) ?? LOW),
  size: (a, b) => (b.wt > 0 ? b.wt : LOW) - (a.wt > 0 ? a.wt : LOW) || (pctOf(b) ?? LOW) - (pctOf(a) ?? LOW),
  profit: (a, b) => (potUsd(b, pctOf(b)) ?? LOW) - (potUsd(a, pctOf(a)) ?? LOW),
};

/* ----------------------- row markup ----------------------- */
function stampHtml(t, p) {
  const cls = isOpen(t) ? "open" : p < 0 ? "loss" : "";
  return `<span class="stamp ${cls}">${p == null ? "…" : pct1(p)}<small>${isOpen(t) ? "OPEN" : "CLOSED"}</small></span>`;
}

function pxHtml(t) {
  const d = derive(t);
  // the joiner ends the first half, so a wrapped line never starts with it
  const half = (lbl, v, join = "") => `<span><span class="lbl">${lbl}</span> ${money(v)}${join}</span>`;
  if (isOpen(t)) {
    const c = state.quotes[t.ticker]?.c;
    return c == null ? half("Bought", d.avgCost) : half("Bought", d.avgCost, ` <span class="sep">·</span>`) + " " + half("Now", c);
  }
  const sell = exitPx(t);
  return sell == null ? half("Bought", d.avgCost) : half("Bought", d.avgCost, ` <span class="arr">→</span>`) + " " + half("Sold", sell);
}

function potHtml(t, p) {
  if (!(t.wt > 0)) return `<span class="sz muted">Unsized</span>`;
  const v = potUsd(t, p);
  return `<span class="sz">${+Number(t.wt).toFixed(1)}% of pot</span>` +
    (v == null ? "" : `<span class="money ${v < 0 ? "loss" : "pos"}"><b>${signedUsd(v)}</b> on the pot</span>`);
}

function txHtml(t) {
  const on = (d) => (d ? ` on ${day(d)}` : "");
  const lines = (t.txns || []).map(x =>
    `<li>${x.t === "sell" ? "Sold" : "Bought"} at <b>${money(x.px)}</b>${on(x.d)}</li>`);
  if (!isOpen(t) && t.closePx != null && derive(t).heldSh > 0)   // shares still held when it closed
    lines.push(`<li class="fin">Sold at <b>${money(t.closePx)}</b>${on(t.closed)}</li>`);
  return lines.join("");
}

function rowHtml(t) {
  const p = pctOf(t), n = daysBetween(t.opened, endOf(t)), id = esc(t.id);
  const held = n === 0 ? "Same day" : `Held ${n} day${n === 1 ? "" : "s"}`;
  const on = expanded.has(t.id);
  return `
  <button class="call-head" type="button" aria-expanded="${on}" aria-controls="tx-${id}">
    <span class="c-stamp" data-k="stamp">${stampHtml(t, p)}</span>
    <span class="c-id">${logoHtml(t)}<span class="c-name"><span class="tk">${esc(t.ticker)}</span><span class="nm">${esc(t.name || "")}</span></span></span>
    <span class="c-when"><span class="dt">${day(t.opened)} → ${isOpen(t) ? "now" : day(t.closed || t.opened)}</span><span class="held">${held}</span></span>
    <span class="c-px" data-k="px">${pxHtml(t)}</span>
    <span class="c-pot" data-k="pot">${potHtml(t, p)}</span>
    <span class="c-spark" data-k="spark" aria-hidden="true">${sparks.get(t.id)?.key === sparkKey(t) ? sparks.get(t.id).html : `<span class="flat wait"><i></i></span>`}</span>
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <div class="call-body" id="tx-${id}"${on ? "" : " inert"}><div><div class="inner">
    <h3>Trades</h3><ul class="txns">${txHtml(t)}</ul>
  </div></div></div>`;
}

/* ----------------------- sparklines (lazy) ----------------------- */
const sparkKey = (t) => [t.ticker, t.opened, endOf(t), isOpen(t), (pctOf(t) ?? 0) < 0].join("|");
const earliest = () => state.trades.reduce((m, t) => (t.opened && t.opened < m ? t.opened : m), "9999-12-31");

async function loadSpark(id) {
  const t = byId.get(id);
  if (!t || sparks.get(id)?.key === sparkKey(t)) return;
  let h = { dates: [], closes: [] };
  try { h = await history(t.ticker, earliest()); } catch (e) { /* drawn as a quiet dash */ }
  const now = byId.get(id);
  if (!now) return;
  const html = sparkSvg(now, h);
  if (h.dates.length) sparks.set(id, { key: sparkKey(now), html });
  const cell = rows.get(id)?.querySelector('[data-k="spark"]');
  if (cell) cell.innerHTML = html;
}

let gid = 0;   // unique gradient ids across rows
function sparkSvg(t, h) {
  const end = endOf(t), pts = [];
  h.dates.forEach((d, i) => { if (d >= t.opened && d <= end && h.closes[i] != null) pts.push(h.closes[i]); });
  if (pts.length < 2) {
    const same = daysBetween(t.opened, end) === 0;
    return same ? `<span class="flat"><i></i>Same day</span>` : `<span class="flat quiet"><i></i></span>`;
  }
  const W = 140, H = 40, P = 4;
  const lo = Math.min(...pts), k = Math.max(...pts) - lo || 1;
  const xy = pts.map((v, i) => [P + (i * (W - 2 * P)) / (pts.length - 1), H - P - ((v - lo) / k) * (H - 2 * P)]
    .map(n => +n.toFixed(1)));
  const d = xy.map(([x, y], i) => (i ? "L" : "M") + x + " " + y).join("");
  const [x0, y0] = xy[0], [x1, y1] = xy[xy.length - 1];
  const g = "sg" + ++gid, cls = isOpen(t) ? "open" : (pctOf(t) ?? 0) < 0 ? "loss" : "";
  return `<svg class="spark ${cls}" viewBox="0 0 ${W} ${H}" focusable="false">` +
    `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".32"/>` +
    `<stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>` +
    `<path class="area" fill="url(#${g})" d="${d}L${x1} ${H}L${x0} ${H}Z"/><path class="ln" pathLength="1" d="${d}"/>` +
    `<circle class="p0" cx="${x0}" cy="${y0}" r="3"/><circle class="halo" cx="${x1}" cy="${y1}" r="3"/><circle class="p1" cx="${x1}" cy="${y1}" r="3"/></svg>`;
}

/* ----------------------- summary tally ----------------------- */
function stat(k, v, fmt, tail = "", cls = "", grad = false) {
  const dd = tally.querySelector(`[data-s="${k}"]`);
  if (v == null) { dd.className = "none"; dd.textContent = "None yet"; return; }
  if (!dd._n || !dd.contains(dd._n)) { dd.innerHTML = "<span></span><small></small>"; dd._n = dd.firstChild; }
  dd.className = cls;
  dd.lastChild.textContent = tail;
  grad ? countTo(dd._n, v, fmt, 1800) : roll(dd._n, String(fmt(v)));   // rolling digits break background-clip text
}

function paintSummary() {
  const closed = state.trades.filter(t => !isOpen(t) && t.finalPct != null);
  const won = closed.filter(t => t.finalPct > 0), lost = closed.filter(t => t.finalPct < 0);
  const mean = (a) => (a.length ? a.reduce((s, t) => s + t.finalPct, 0) / a.length : null);
  const banked = closed.reduce((s, t) => s + (t.wt > 0 ? (t.wt / 100) * (t.finalPct / 100) * state.pot : 0), 0);
  const n = closed.length, calls = state.trades.length;
  onReveal(tally, () => {
    stat("calls", calls, v => Math.round(v));
    stat("won", n ? won.length : null, v => Math.round(v), ` of ${n}`);
    stat("rate", n ? (won.length / n) * 100 : null, v => Math.round(v) + "%");
    stat("avgw", won.length ? mean(won) : null, pct1, "", "pos");
    stat("avgl", lost.length ? mean(lost) : null, pct1, "", "loss");
    stat("bank", banked, usd0, "", banked < 0 ? "loss" : "grad-text", true);
    $("#rateBar").style.setProperty("--w", n ? won.length / n : 0);
    const pips = closed.slice(0, 40).map(t => t.finalPct > 0).sort((a, b) => b - a);
    const pk = pips.join();
    if ($("#pips")._k !== pk) {
      $("#pips")._k = pk;
      $("#pips").innerHTML = pips.map((w, i) => `<i${w ? "" : ' class="l"'} style="--i:${i}"></i>`).join("");
    }
  });
}

/* ----------------------- render ----------------------- */
function build() {
  byId = new Map(state.trades.map(t => [t.id, t]));
  if (list.hasAttribute("aria-busy")) { list.innerHTML = ""; list.removeAttribute("aria-busy"); $("#slow").hidden = true; }
  for (const t of state.trades) {
    let li = rows.get(t.id);
    if (!li) {
      li = document.createElement("li");
      li.className = "call tilt";
      li.dataset.reveal = "";
      li.dataset.id = t.id;
      rows.set(t.id, li);
    }
    const focused = li.contains(document.activeElement);
    li.classList.toggle("open", expanded.has(t.id));
    li.classList.toggle("glow", expanded.has(t.id));
    li.innerHTML = rowHtml(t);
    if (focused) li.querySelector(".call-head").focus({ preventScroll: true });
  }
  for (const [id, li] of rows) if (!byId.has(id)) { li.remove(); rows.delete(id); expanded.delete(id); }
  apply(false);
  for (const [id, li] of rows) onReveal(li, () => {
    loadSpark(id);
    setTimeout(() => li.style.setProperty("--d", 0), 1600);   // entrance done: hover and tilt react at once
  });
  observeReveals(list);
  paintSummary();
}

// Filter, sort and search: reorder mounted rows, hide the rest.
function apply(announce = true, deal = announce) {
  if (!state.ready) return;
  const q = ui.q;
  const vis = state.trades.filter(t => FILTERS[ui.filter](t) &&
    (!q || (t.ticker || "").toLowerCase().includes(q) || (t.name || "").toLowerCase().includes(q)));
  vis.sort(SORTS[ui.sort]);
  const shown = new Set(vis.map(t => t.id));
  let i = 0;
  for (const [id, li] of rows) li.hidden = !shown.has(id);
  for (const t of vis) {
    const li = rows.get(t.id);
    if (!li.classList.contains("in")) li.style.setProperty("--d", i < 6 ? i : 0);
    li.style.setProperty("--i", Math.min(i, 10));
    i++;
  }
  // hidden rows stay mounted so the reveal observer still sees them later
  list.append(...vis.map(t => rows.get(t.id)), ...[...rows.values()].filter(li => li.hidden));
  emptyEl.hidden = vis.length > 0;
  if (deal) { list.classList.remove("re"); void list.offsetWidth; list.classList.add("re"); }
  countEl.textContent = announce ? `${vis.length} of ${state.trades.length} calls shown` : "";
}

// Quote ticks: only the open rows' live numbers change.
function updateLive() {
  for (const t of state.trades) {
    const li = isOpen(t) && rows.get(t.id);
    if (!li) continue;
    const p = pctOf(t);
    li.querySelector('[data-k="stamp"]').innerHTML = stampHtml(t, p);
    li.querySelector('[data-k="px"]').innerHTML = pxHtml(t);
    li.querySelector('[data-k="pot"]').innerHTML = potHtml(t, p);
  }
}

/* ----------------------- controls ----------------------- */
list.addEventListener("click", (e) => {
  const b = e.target.closest(".call-head");
  if (!b) return;
  const li = b.closest(".call"), id = li.dataset.id, on = !expanded.has(id);
  on ? expanded.add(id) : expanded.delete(id);
  li.classList.toggle("open", on);
  li.classList.toggle("glow", on);
  b.setAttribute("aria-expanded", on);
  li.querySelector(".call-body").inert = !on;
});

$("#filter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  ui.filter = b.dataset.f;
  for (const x of b.parentElement.children) x.setAttribute("aria-pressed", x === b);
  apply();
});
$("#sort").addEventListener("change", (e) => { ui.sort = e.target.value; apply(); });
$("#q").addEventListener("input", (e) => { ui.q = e.target.value.trim().toLowerCase(); apply(true, false); });

/* ----------------------- live data ----------------------- */
const slowTimer = setTimeout(() => { if (!state.ready) $("#slow").hidden = false; }, 12000);
live((what) => {
  if (!state.ready) return;
  clearTimeout(slowTimer);
  if (what === "quotes") updateLive();
  else build();
}).catch((e) => { console.error("Ledger feed failed:", e); $("#slow").hidden = false; });
