// ============================================================
// Monthly recap (recap.html?m=2026-10): one month on one page.
// Our fund's month against gold, the S&P 500 and TASI (the same
// month-by-month numbers as the Analytics grid), the best and the
// weakest call that closed, and every call opened or closed.
// With no ?m it shows the last finished month.
// ============================================================

import { initShell, observeReveals, countTo, pct1, pts1, day, esc, logoHtml } from "./shell.js?v=31";
import { live, state } from "./live.js?v=31";
import { today } from "./roi.js?v=31";
import { loadRace, monthly } from "./series.js?v=31";

const $ = (id) => document.getElementById(id);
const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const title = (m) => `${NAMES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const SERIES = [["fund", "Our fund"], ["gold", "Gold"], ["spx", "S&P 500"], ["tasi", "TASI"]];
const FAIL = "The month could not load right now. Try again in a minute.";
const note = (msg, tag = "p") => `<${tag} class="state-note">${msg}</${tag}>`;

initShell();

// Which month to show: the one asked for, else the last finished one.
export function pickMonth(M, want, now = today().slice(0, 7)) {
  return M.find(m => m.m === want) || M.findLast(m => m.m < now) || M.at(-1) || null;
}

// The calls of one month: closed in it (best first) and opened in it.
export function monthCalls(trades, m) {
  const closed = trades.filter(t => t.status === "closed" && t.finalPct != null && (t.closed || t.opened || "").startsWith(m))
    .sort((a, b) => b.finalPct - a.finalPct);
  const opened = trades.filter(t => (t.opened || "").startsWith(m)).sort((a, b) => (a.opened < b.opened ? -1 : 1));
  return { closed, opened, won: closed.filter(t => t.finalPct > 0).length };
}

let key = "", seq = 0, cur = null;

async function onLive(what) {
  if (!state.ready) return;
  const k = JSON.stringify([state.pot, state.trades.map(t => [t.id, t.status, t.opened, t.closed, t.finalPct, t.wt, t.txns])]);
  const running = cur && cur.m === today().slice(0, 7);
  if (k === key && !(what === "quotes" && running)) return;   // a price tick only moves a month still running
  key = k;
  const my = ++seq;
  let race = null;
  try { race = await loadRace(state.trades, state.pot, state.quotes); } catch (e) { console.warn("recap failed:", e); }
  if (my !== seq) return;
  paint(race ? monthly(race) : null);
}

function paint(M) {
  const want = new URLSearchParams(location.search).get("m");
  cur = M && pickMonth(M, want);
  if (!cur) {
    $("rcFund").textContent = "…";
    $("rcSub").textContent = M ? "The first month has not started yet." : FAIL;
    for (const id of ["rcBest", "rcWorst", "rcCount"]) $(id).innerHTML = note("Nothing yet.");
    $("rcClosed").innerHTML = $("rcOpened").innerHTML = note("Nothing yet.", "li");
    return;
  }
  const m = cur.m, running = m === today().slice(0, 7);
  document.title = `${title(m)} · Albassam Fund`;
  $("rcTitle").textContent = title(m) + ".";
  $("rcLede").textContent = running ? "Still running: these numbers move until the month ends." : "One month of the fund, on one page.";

  // earlier / later / share
  const i = M.indexOf(cur);
  for (const [id, x] of [["rcPrev", M[i - 1]], ["rcNext", M[i + 1]]]) {
    $(id).hidden = !x;
    if (x) { $(id).href = "?m=" + x.m; $(id).textContent = id === "rcPrev" ? "‹ " + title(x.m) : title(x.m) + " ›"; }
  }
  $("rcShare").hidden = false;

  // the score
  const big = $("rcFund");
  big.classList.toggle("neg", cur.fund < 0);
  countTo(big, cur.fund, pct1, 1600);
  const beat = SERIES.slice(1).filter(([k]) => cur.fund > cur[k]).length;
  $("rcSub").textContent = beat === 3 ? "Ahead of gold, the S&P 500 and TASI this month."
    : beat === 0 ? "Behind gold, the S&P 500 and TASI this month." : `Ahead of ${beat} of the 3 benchmarks this month.`;
  const lo = Math.min(0, ...SERIES.map(([k]) => cur[k])), hi = Math.max(0, ...SERIES.map(([k]) => cur[k])), span = hi - lo || 1;
  const bars = $("rcBars");
  bars.style.setProperty("--z", ((-lo / span) * 100).toFixed(2) + "%");
  bars.innerHTML = SERIES.map(([k, name], n) => {
    const v = cur[k], lead = cur.fund - v;
    return `<li class="${k}${v < 0 ? " neg" : ""}" style="--i:${n}"><span class="nm">${esc(name)}</span>
      <span class="trk" aria-hidden="true"><i style="--w:${((Math.abs(v) / span) * 100).toFixed(2)}%"></i></span><b class="v">${pct1(v)}</b>
      ${k === "fund" ? "" : `<small>we are ${lead >= 0 ? "ahead" : "behind"} by ${pts1(Math.abs(lead)).slice(1)}</small>`}</li>`;
  }).join("");

  // best, weakest, count
  const { closed, opened, won } = monthCalls(state.trades, m);
  const card = (t) => `<p class="who">${logoHtml(t)}<span>${esc(t.ticker)}</span></p>
    <p class="n${t.finalPct < 0 ? " neg" : ""}">${pct1(t.finalPct)}</p>
    <small>${day(t.opened)} → ${day(t.closed || t.opened)}${t.wt > 0 ? ` · ${pct1((t.wt * t.finalPct) / 100)} on the pot` : ""}</small>`;
  const none = note(running ? "No call has closed yet this month." : "No call closed this month.");
  $("rcBest").innerHTML = closed.length ? card(closed[0]) : none;
  $("rcWorstK").textContent = closed.length > 1 && closed.at(-1).finalPct < 0 ? "Worst call" : "Weakest call";
  $("rcWorst").innerHTML = closed.length > 1 ? card(closed.at(-1)) : note(closed.length ? "Only one call closed." : "None to compare.");
  $("rcCount").innerHTML = closed.length
    ? `<p class="n">${closed.length}</p><small>${won} won · ${closed.length - won} lost</small>` : none;

  // the lists
  const row = (t, right) => `<li class="rc-row">${logoHtml(t)}<span class="id"><b>${esc(t.ticker)}</b><small>${esc(t.name || "")}</small></span>${right}</li>`;
  $("rcClosed").innerHTML = closed.length ? closed.map(t => row(t,
    `<span class="r"><b class="${t.finalPct < 0 ? "neg" : ""}">${pct1(t.finalPct)}</b><small>${day(t.opened)} → ${day(t.closed || t.opened)}</small></span>`)).join("")
    : note(running ? "No call has closed yet this month." : "No call closed this month.", "li");
  $("rcOpened").innerHTML = opened.length ? opened.map(t => row(t,
    `<span class="r"><b>${t.wt > 0 ? +Number(t.wt).toFixed(1) + "% of pot" : "Unsized"}</b><small>${day(t.opened)} · ${t.status === "closed" ? "closed since" : "still open"}</small></span>`)).join("")
    : note("No new call this month.", "li");
  observeReveals(document);
}

// Share: the phone's share sheet with one line and the link; else copy it.
$("rcShare").addEventListener("click", async (e) => {
  if (!cur) return;
  const url = `${location.origin}${location.pathname}?m=${cur.m}`;
  const text = `Albassam Fund, ${title(cur.m)}: ${pct1(cur.fund)}. Gold ${pct1(cur.gold)}, S&P 500 ${pct1(cur.spx)}, TASI ${pct1(cur.tasi)}. Not investment advice.`;
  if (navigator.share) return navigator.share({ title: `Albassam Fund · ${title(cur.m)}`, text, url }).catch(() => {});
  try { await navigator.clipboard.writeText(`${text} ${url}`); e.target.textContent = "Copied"; }
  catch (err) { e.target.textContent = "Copy failed"; }
  setTimeout(() => (e.target.textContent = "Share this recap"), 2200);
});

live(onLive).catch(e => { console.error("Recap feed failed:", e); if (!state.ready) paint(null); });
setTimeout(() => { if (!state.ready) paint(null); }, 15000);
