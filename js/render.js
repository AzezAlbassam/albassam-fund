// ============================================================
// Rendering. Two paths so typing in a form never gets wiped:
//  * renderAll  — rebuilds the card lists (on data changes)
//  * updateLive — retouches only live numbers (on price ticks)
// ============================================================

import { derive, blendedPct, statPct, computeStats, fmtPct, fmtMoney } from "./roi.js";
import { quotes } from "./prices.js";
import { setPlanets } from "./space.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function logoHtml(t, cls) {
  return t.logo
    ? `<img class="logo ${cls}" src="${esc(t.logo)}" alt="" onerror="this.outerHTML='<span class=&quot;logo ph ${cls}&quot;>${esc(t.ticker[0])}</span>'">`
    : `<span class="logo ph ${cls}">${esc(t.ticker[0])}</span>`;
}

function pctClass(p) { return p == null ? "" : p >= 0 ? "pos" : "neg"; }

export function renderAll(state) {
  const { trades, mode } = state;
  const active = trades.filter(t => t.status === "active");
  const closed = trades.filter(t => t.status === "closed");
  const edit = mode === "edit" && state.canWrite;

  $("#activeCount").textContent = active.length + " open";
  $("#activeCards").innerHTML = active.length ? active.map(t => {
    const d = derive(t);
    const q = quotes[t.ticker];
    const pct = blendedPct(t, q ? q.c : null);
    return `<div class="card" data-id="${t.id}" data-ticker="${esc(t.ticker)}">
      <div class="head">
        ${logoHtml(t, "")}
        <div><div class="tk">${esc(t.ticker)}</div><div class="nm">${esc(t.name)}</div></div>
        <div class="roi">
          <div class="pct ${pctClass(pct)}" data-f="pct">${fmtPct(pct)}</div>
          <div class="today" data-f="today">${q && q.dp != null ? `<span class="${pctClass(q.dp)}">${fmtPct(q.dp)}</span> today` : ""}</div>
        </div>
      </div>
      <div class="kvs">
        <div class="kv"><span class="k">Avg cost</span><span class="v">${fmtMoney(d.avgCost)}</span></div>
        <div class="kv"><span class="k">Live price</span><span class="v" data-f="px">${q ? fmtMoney(q.c) : "—"}</span></div>
        ${edit ? `<div class="kv"><span class="k">Shares held</span><span class="v">${d.heldSh}${d.soldSh ? ` <span style="color:var(--dim)">(sold ${d.soldSh})</span>` : ""}</span></div>` : ""}
      </div>
      <div class="bar"><i data-f="bar" style="${barStyle(pct)}"></i></div>
      <div class="meta">opened ${esc(t.opened)} · ${t.txns.length} txn${t.txns.length > 1 ? "s" : ""}</div>
      ${edit ? `<div class="ctl">
        <button class="mini" data-act="buy">＋ Buy</button>
        <button class="mini" data-act="sell">− Sell</button>
        <button class="mini warn" data-act="close">Close ▸</button>
        <button class="mini ghost" data-act="del">✕</button>
      </div><div class="inline-form" hidden></div>` : ""}
    </div>`;
  }).join("") : `<div class="empty">No active positions${edit ? " — add your first call below." : " right now."}</div>`;

  $("#closedCount").textContent = closed.length + " closed";
  $("#closedList").innerHTML = closed.length ? closed.map(t => `
    <div class="closed-row" data-id="${t.id}">
      <div class="l">${logoHtml(t, "")}
        <div><div class="tk">${esc(t.ticker)}</div>
        <div class="when">${esc(t.opened)} → ${esc(t.closed || "")}${t.closePx ? " @ " + fmtMoney(t.closePx) : ""}</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="pct ${pctClass(t.finalPct)}">${fmtPct(t.finalPct)}</span>
        ${edit ? `<span class="acts">
          <button class="mini ghost" data-act="reopen" title="Reopen">↩</button>
          <button class="mini ghost" data-act="del" title="Delete">✕</button></span>` : ""}
      </div>
    </div>`).join("") : `<div class="empty">Nothing closed yet — closed calls land here with their final ROI locked in.</div>`;

  updateLive(state);
}

function barStyle(pct) {
  if (pct == null) return "width:0";
  const pos = pct >= 0, w = Math.min(Math.abs(pct), 100) / 2;
  return `${pos ? "left:50%" : "right:50%"};width:${w}%;background:${pos ? "#FF8C2B" : "#FF5A4E"}`;
}

// Light pass: only live numbers, stats, hero and sphere planets.
export function updateLive(state) {
  const { trades } = state;

  for (const el of document.querySelectorAll("#activeCards .card")) {
    const t = trades.find(x => x.id === el.dataset.id);
    if (!t) continue;
    const q = quotes[t.ticker];
    const pct = blendedPct(t, q ? q.c : null);
    const pctEl = el.querySelector('[data-f="pct"]');
    pctEl.textContent = fmtPct(pct);
    pctEl.className = "pct " + pctClass(pct);
    el.querySelector('[data-f="px"]').textContent = q ? fmtMoney(q.c) : "—";
    el.querySelector('[data-f="today"]').innerHTML =
      q && q.dp != null ? `<span class="${pctClass(q.dp)}">${fmtPct(q.dp)}</span> today` : "";
    el.querySelector('[data-f="bar"]').style.cssText = barStyle(pct);
  }

  const s = computeStats(trades, quotes);
  const big = $("#big");
  if (s.avgActive == null) {
    big.innerHTML = `—<small>%</small>`;
  } else {
    const v = Math.abs(Math.round(s.avgActive * 100) / 100).toFixed(2);
    big.innerHTML = `<span class="sign ${s.avgActive >= 0 ? "pos" : "neg"}">${s.avgActive >= 0 ? "+" : "−"}</span>${v}<small>%</small>`;
  }
  $("#stOpen").textContent = s.nOpen;
  $("#stClosed").textContent = s.nClosed;
  setStat("#stBest", s.best ? `${s.best.ticker} ${fmtPct(s.best.pct, 1)}` : "—", s.best?.pct);
  setStat("#stWorst", s.worst ? `${s.worst.ticker} ${fmtPct(s.worst.pct, 1)}` : "—", s.worst?.pct);
  setStat("#stAvgClosed", fmtPct(s.avgClosed), s.avgClosed);
  $("#stWin").textContent = s.winRate == null ? "—" : s.winRate + "%";
  $("#tagWin").textContent = s.winRate == null ? "—" : s.winRate + "%";

  setPlanets(trades.filter(t => t.status === "active")
    .map(t => ({ ticker: t.ticker, pct: statPct(t, quotes) ?? 0 })));
}

function setStat(sel, text, pct) {
  const el = $(sel);
  el.textContent = text;
  el.className = "v " + pctClass(pct);
}

export function toast(text, isErr) {
  const el = $("#msg");
  if (!el) return;
  el.textContent = text;
  el.className = "msg " + (isErr ? "err" : "ok");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.textContent = ""; }, 6000);
}
