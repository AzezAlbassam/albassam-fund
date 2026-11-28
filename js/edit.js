// ============================================================
// Mission control (edit.html): the fund manager's desk.
// Google sign-in gate, owner check, every write action. Two
// render paths so typing in a form is never wiped by a tick:
//  * renderAll  rebuilds the lists (trade data changed)
//  * updateLive retouches only live numbers (prices, pot)
// Firestore rules enforce owner-only writes server-side too.
// ============================================================

import { DEMO, firebaseConfig, OWNER_EMAIL } from "./config.js?v=46";
import { store, purified } from "./store.js?v=46";
import { addPick, addWt, cashProblem, kNow, newPick, potUsd, unreadable } from "./cashpick.js?v=46";
import { healRecord } from "./owner.js?v=46";
import { live, state } from "./live.js?v=46";
import { quotes, fetchProfile, checkTicker } from "./prices.js?v=46";
import { watchNews } from "./news.js?v=46";
import { derive, blendedPct, simulate, computeStats, fmtPct, today, exitPx, cashPct, lastAdd, parseNum, share } from "./roi.js?v=46";
import { initShell, observeReveals, roll, countTo, esc, logoHtml, pctClass, usd0, usd2, pct1, shortUsd, day, dayYear, daysBetween, sessionWord } from "./shell.js?v=46";

const $ = (s, r = document) => r.querySelector(s);
const WAIT = "…";
const money = (v) => (v == null || isNaN(v) ? WAIT : usd2(v));
const pct2 = (p) => (p == null || isNaN(p) ? WAIT : fmtPct(p));
const heldFor = (a, b) => { const n = daysBetween(a, b); return n ? `Held ${n} day${n === 1 ? "" : "s"}` : "Same day"; };
const sh = (v) => (+v || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
const MARK = `<span class="orb" aria-hidden="true"></span>`;
const emptyBox = (html, tag = "div") => `<${tag} class="empty-state">${MARK}<p>${html}</p></${tag}>`;
const WIRE_EMPTY = `<div class="empty">Quiet. The wire wakes up when we hold a position.</div>`;

let canWrite = DEMO;   // demo: the desk is open without sign-in
// Write controls wait for the live record: the device snapshot paints
// first, but saves need the store's own synced copy of each call.
const writable = () => canWrite && !state.cached;

initShell();

// the title builds itself letter by letter
let ci = 0;
document.querySelectorAll("#deskTitle .hl").forEach(w => {
  w.innerHTML = [...w.textContent].map(ch => `<span class="ch" style="--i:${ci++}">${esc(ch)}</span>`).join("");
});
// a rebuilt list plays its entrance again (cards stagger, rows rise as they scroll in)
const restage = (el, html) => { el.classList.remove("in", "done"); el.innerHTML = html; observeReveals(el.parentElement); };

/* ----------------------- toasts ----------------------- */
let toastT;
function toast(text, isErr) {
  const el = $("#toast");
  el.textContent = text;
  el.className = "toast show " + (isErr ? "err" : "ok");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), 6000);
}
const fail = (m) => (toast(m, true), false);

/* ----------------------- render: full ----------------------- */
const newCallCash = newPick($("#adTicker"), $("#adShares"), $("#adPrice"), $("#adWt"));   // "use 50% of the remaining cash"
function renderAll() {
  newCallCash.refresh();
  const active = state.trades.filter(t => t.status === "active");
  const closed = state.trades.filter(t => t.status === "closed");

  const w = writable();
  // adding a call or changing the pot never needs the synced copy of a
  // call, so those show the moment the owner signs in
  $("#desk").classList.toggle("ro", !canWrite);
  $("#forms").hidden = !canWrite;
  $("#quickAdd").hidden = !canWrite;
  $("#potEdit").hidden = !canWrite;
  if (!canWrite) $("#potForm").hidden = true;
  if (!state.ready) return;   // keep the loading skeletons until data lands

  $("#activeCount").textContent = active.length + " open";
  restage($("#activeCards"), active.length ? active.map(cardHtml).join("") :
    emptyBox(`<b>All cash. Every gain is banked.</b> The next call shows up here the minute it opens.` +
      (w ? ` <span class="muted">Launch it from New call.</span>` : "")));

  $("#closedCount").textContent = closed.length + " closed";
  restage($("#closedList"), closed.length ? closed.map(rowHtml).join("") :
    emptyBox("Nothing closed yet. Closed calls land here with their result locked in.", "li"));

  updateLive();
}

function cardHtml(t) {
  const d = derive(t);
  const n = (t.txns || []).length;
  const tk = esc(t.ticker);
  return `<article class="call glass tilt" data-id="${esc(t.id)}">
    <div class="call-top">
      ${logoHtml(t)}
      <div class="call-id"><h3>${tk}</h3><p>${esc(t.name || "")}</p></div>
      <div class="call-roi"><b class="num" data-f="pct">${WAIT}</b><span data-f="today"></span></div>
    </div>
    <dl class="kv">
      <div><dt>Live price</dt><dd data-f="px">${WAIT}</dd></div>
      <div><dt>Avg cost</dt><dd>${money(d.avgCost)}</dd></div>
      ${t.wt > 0 ? `<div><dt>Pot share</dt><dd>${+share(t, state.trades).toFixed(2)}%</dd></div>
      <div><dt>On the pot</dt><dd data-f="onpot">${WAIT}</dd></div>` : ""}
      ${t.pur > 0 ? `<div><dt>Purification</dt><dd>${esc(t.pur)}% at close</dd></div>` : ""}
      ${canWrite ? `<div><dt>Shares held</dt><dd>${sh(d.heldSh)}${d.soldSh ? ` <small>sold ${sh(d.soldSh)}</small>` : ""}</dd></div>` : ""}
    </dl>
    <div class="bar" aria-hidden="true"><i data-f="bar"></i></div>
    <p class="meta">Opened ${esc(dayYear(t.opened))} · ${daysBetween(t.opened, today()) ? heldFor(t.opened, today()).toLowerCase() : "new today"} · ${n} txn${n === 1 ? "" : "s"}</p>
    ${writable() ? `<div class="ctl" role="group" aria-label="Actions for ${tk}">
      <button class="act" type="button" data-act="buy">+ Buy</button>
      <button class="act" type="button" data-act="sell">− Sell</button>
      ${lastAdd(t) ? `<button class="act" type="button" data-act="undo" aria-label="Undo the last buy of ${tk}">↩ Undo buy</button>` : ""}
      <button class="act" type="button" data-act="close">Close</button>
      <button class="act" type="button" data-act="share" aria-label="Share card for ${tk}">Share card</button>
      <button class="act" type="button" data-act="edit" aria-label="Fix ${tk} numbers">✎ Fix</button>
      <button class="act" type="button" data-act="pur" aria-label="Purification for ${tk}">Purification${t.pur > 0 ? " " + esc(t.pur) + "%" : ""}</button>
      <button class="act del" type="button" data-act="del" aria-label="Delete ${tk}">✕</button>
    </div>
    <div class="inline-form" hidden></div>` : ""}
  </article>`;
}

function rowHtml(t, i) {
  const d = derive(t);
  const sellPx = exitPx(t);
  const p = t.finalPct;
  const tk = esc(t.ticker);
  const verdict = p > 0 ? "WIN" : p < 0 ? "LOSS" : "FLAT";
  return `<li class="crow" data-id="${esc(t.id)}" data-reveal style="--i:${i % 4}">
    <div class="crow-main">
      <span class="stamp${p < 0 ? " loss" : p === 0 ? " flat" : ""}">${p == null ? WAIT : pct1(p)}<small>${verdict}</small></span>
      <div class="crow-id">${logoHtml(t)}<div><b>${tk}</b><span>${esc(t.name || "")}</span></div></div>
      <div class="crow-info">
        <p><span>${esc(day(t.opened))} → ${esc(dayYear(t.closed))}</span><span class="muted">${heldFor(t.opened, t.closed || today())}</span></p>
        <p><span>Bought ${money(d.avgCost)} → Sold ${money(sellPx)}</span></p>
        ${t.pur > 0 && t.grossPct > 0 ? `<p><span class="muted">${pct1(t.grossPct)} before ${esc(t.pur)}% purification</span></p>` : ""}
        <p>${t.wt > 0 && p != null
          ? `<span>${esc(t.wt)}% of pot</span><span data-onpot="${t.wt * p}"></span>`
          : `<span class="muted">No pot size yet</span>`}</p>
      </div>
      ${writable() ? `<div class="crow-acts" role="group" aria-label="Actions for ${tk}">
        <button class="act" type="button" data-act="edit" aria-label="Fix ${tk} numbers">✎ Fix</button>
      <button class="act" type="button" data-act="pur" aria-label="Purification for ${tk}">Purification${t.pur > 0 ? " " + esc(t.pur) + "%" : ""}</button>
        <button class="act" type="button" data-act="share" aria-label="Share card for ${tk}">Share card</button>
        <button class="act" type="button" data-act="reopen" aria-label="Reopen ${tk}">↩ Reopen</button>
        <button class="act del" type="button" data-act="del" aria-label="Delete ${tk}">✕</button>
      </div>` : ""}
    </div>
    ${writable() ? `<div class="inline-form" hidden></div>` : ""}
  </li>`;
}

/* ----------------------- render: live numbers only ----------------------- */
function setOnPot(el, wtTimesPct, suffix = "") {
  const v = wtTimesPct == null ? null : wtTimesPct / 100;   // % the call adds to the pot
  el.textContent = v == null ? WAIT : pct1(v) + suffix;
  el.className = pctClass(v);
}

function updateLive() {
  for (const el of document.querySelectorAll("#activeCards [data-id]")) {
    const t = state.trades.find(x => x.id === el.dataset.id);
    if (!t) continue;
    const q = quotes[t.ticker];
    const p = blendedPct(t, q ? q.c : null);
    const f = (k) => el.querySelector(`[data-f="${k}"]`);
    f("pct").textContent = pct2(p);
    f("pct").className = "num " + pctClass(p);
    f("px").textContent = q ? usd2(q.c) : WAIT;
    f("today").innerHTML = q?.dp != null
      ? `<span class="${pctClass(q.dp)}">${pct2(q.dp)}</span> ${sessionWord(q)}` : "Waiting for price";
    const bar = f("bar");
    bar.className = p < 0 ? "neg" : "";
    bar.style.transform = `scaleX(${p == null ? 0 : Math.min(Math.abs(p), 100) / 100})`;
    const op = f("onpot");
    if (op) setOnPot(op, p == null ? null : share(t, state.trades) * p);
  }
  for (const el of document.querySelectorAll("#closedList [data-onpot]"))
    setOnPot(el, +el.dataset.onpot, " on the pot");

  if (!state.ready) return;
  const sim = simulate(state.trades, quotes, state.pot);
  const st = computeStats(state.trades, quotes);
  roll($("#kValue"), usd0(sim.value));
  const ret = $("#kRet");
  countTo(ret, sim.totalPct, pct1);
  ret.className = "num " + pctClass(sim.totalPct);
  $("#kPot").textContent = shortUsd(state.pot);
  const pot = potUsd();   // the start plus everything banked: what every "% of pot" buy is sized on
  $("#kPotNow").textContent = `${usd0(pot)} · 1% = ${usd0(pot / 100)}`;
  const unsized = state.trades.filter(t => !(t.wt > 0)).length;
  $("#kMeta").textContent = `Banked ${pct1(sim.realizedPct)} · open calls ${pct1(sim.openPct)} of the pot · cash ${+cashPct(state.trades).toFixed(1)}%` +
    (unsized ? ` · ${unsized} call${unsized > 1 ? "s" : ""} with no pot size yet` : "");
  roll($("#kOpen"), String(st.nOpen));
  roll($("#kClosed"), String(st.nClosed));
  roll($("#kWin"), st.winRate == null ? "n/a" : st.winRate + "%");
  $("#kWinTile").style.setProperty("--p", st.winRate ?? 0);
}

/* ----------------------- inline form plumbing ----------------------- */
// purification: a share of the profit, 0 to 100 (blank = none)
const purOf = (v) => { const x = parseNum(v); return x > 0 ? Math.min(100, x) : null; };
const fld = (label, attrs) => `<label class="fld"><span>${label}</span><input ${attrs}></label>`;
// type=text: Chrome's type=number drops a typed "," (41,5 -> 415); parseNum reads it
const num = (label, key, val = "", more = "") =>
  fld(label, `type="text" inputmode="decimal" autocomplete="off" data-in="${key}" value="${esc(val)}" ${more}`);
const date = (label, key, val = "") => fld(label, `type="date" data-in="${key}" value="${esc(val)}"`);
const val = (box, k) => box.querySelector(`[data-in="${k}"]`).value;

// How much more of today's pot the open calls would hold if t changed: a Fix
// that sizes it up, or a Reopen (which also takes its banked gain back out of
// the pot). cashProblem() then checks it against the free cash.
// ponytail: a Fix that also changes shares or price folds the buys at their
// average k (store.js), a hair off this; fine for a guard.
// After an edit to a closed call moves the pot: the open calls can end up
// holding more than all of it (the free cash is then below zero). Say so.
const overNote = () => {
  const used = state.trades.reduce((s, x) => s + (x.status === "active" ? share(x, state.trades) : 0), 0);
  return used > 100.005 ? ` The open calls now hold ${+used.toFixed(2)}% of the pot, more than all of it.` : "";
};

function extraShare(t, change) {
  const used = (all) => all.reduce((s, x) => s + (x.status === "active" ? share(x, all) : 0), 0);
  return used(state.trades.map(x => (x.id === t.id ? { ...x, ...change } : x))) - used(state.trades);
}

function formBody(title, fields, go) {
  return `<p class="fl">${title}</p><div class="if-fields">${fields}</div>
    <div class="if-btns"><button class="btn sm" type="button" data-go>${go}</button>
    <button class="btn ghost sm" type="button" data-cancel>Cancel</button></div>`;
}

// Cancel/Escape closes, Enter in any field = the go button. go()
// returns false to keep the form open (validation failed). Focus goes
// back to the button that opened the form, so keyboard work carries on.
function wireForm(box, go, opener) {
  const close = () => {
    const had = box.contains(document.activeElement);
    box.hidden = true; box.dataset.form = "";
    if (had && opener?.isConnected) opener.focus();
  };
  box.querySelector("[data-cancel]").addEventListener("click", close);
  box.querySelectorAll("input").forEach(inp => inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); box.querySelector("[data-go]").click(); }
    if (e.key === "Escape") close();
  }));
  const goBtn = box.querySelector("[data-go]");
  goBtn.addEventListener("click", async () => {
    if (unreadable(box)) return fail(unreadable(box));
    goBtn.disabled = true;
    try {
      if ((await go()) !== false) {
        close();
        // a save rebuilds the lists: land on the matching button of the fresh card, else the list heading
        const id = opener?.closest("[data-id]")?.dataset.id;
        setTimeout(() => {
          if (!document.activeElement || document.activeElement === document.body) {
            const again = id && document.querySelector(`[data-id="${CSS.escape(id)}"] [data-act="${opener.dataset.act}"]`);
            (again || opener?.closest("section")?.querySelector("h2[tabindex]"))?.focus();
          }
        }, 60);
      }
    }
    catch (err) { console.error(err); fail(err.message || "Could not save. Try again."); }
    finally { goBtn.disabled = false; }
  });
  box.querySelector("input")?.focus();
}

// Same button twice closes the form it opened.
function openBox(holder, kind) {
  const box = holder.querySelector(".inline-form");
  if (!box) return null;
  if (box.dataset.form === kind && !box.hidden) { box.hidden = true; box.dataset.form = ""; return null; }
  box.dataset.form = kind;
  box.hidden = false;
  return box;
}

// Buy more / sell part / close at a price.
function openInlineForm(holder, t, act) {
  const box = openBox(holder, act);
  if (!box) return;
  const q = quotes[t.ticker];
  const d = derive(t);
  const tk = esc(t.ticker);
  const sized = act === "buy" && t.wt > 0 && d.costBasis > 0;   // a buy that draws on the cash
  const titles = {
    buy: `Buy more ${tk}. The average price and its share of the pot update on their own.`,
    sell: `Sell part of ${tk}. Holding ${sh(d.heldSh)} shares.`,
    close: `Close ${tk}. The final result locks at this price.`,
  };
  box.innerHTML = formBody(titles[act],
    (act !== "close" ? num("Shares", "sh") : "") + num("Price $", "px", q ? q.c.toFixed(2) : "") + (sized ? num("Adds % of pot", "wt") : ""),
    act === "close" ? "Close call" : "OK");
  const inp = (k) => box.querySelector(`[data-in="${k}"]`);
  if (sized) addPick(t, inp("sh"), inp("px"), inp("wt"));
  wireForm(box, async () => {
    const px = parseNum(val(box, "px"));
    if (!(px > 0)) return fail("Enter a valid price.");
    if (act === "close") {
      await store.close(t.id, px);
      toast(`${t.ticker} closed at ${usd2(px)}. ROI locked in.`);
      return;
    }
    const n = parseNum(val(box, "sh"));
    if (!(n > 0)) return fail("Enter a number of shares.");
    if (act === "sell" && n > d.heldSh + 1e-9) return fail(`You only hold ${sh(d.heldSh)} shares of ${t.ticker}.`);
    const add = act === "buy" ? addWt(t, n, px) : null;
    if (add && cashProblem(add)) return fail(cashProblem(add));
    await store.addTxn(t.id, { t: act, sh: n, px, d: today(), asOf: today(), ...(add && { wt: +add.toFixed(4), cash: +cashPct(state.trades).toFixed(4), k: kNow() }) }, add ? +(t.wt + add).toFixed(2) : null);
    if (act === "sell" && n >= d.heldSh - 1e-9) {   // nothing left: the call ends on this sale (d = before it)
      await store.close(t.id, px);
      return void toast(`${t.ticker}: sold all ${sh(n)} @ ${usd2(px)}. Call closed, result locked in.`);
    }
    toast(`${t.ticker}: ${act === "buy" ? "bought" : "sold"} ${sh(n)} @ ${usd2(px)}.`);
  }, holder.querySelector(`[data-act="${act}"]`));
}

// ✎ Fix mistyped numbers without deleting the call.
function openEditForm(holder, t) {
  const box = openBox(holder, "edit");
  if (!box) return;
  const d = derive(t);
  const tk = esc(t.ticker);
  const avg = d.avgCost ? d.avgCost.toFixed(2) : "";
  // an open call's wt is its share of the pot when bought; once a later close moves the pot, say both
  const now = t.status === "active" && t.wt > 0 ? share(t, state.trades) : null;
  const wtIn = num(now != null && Math.abs(now - t.wt) > 0.005 ? `% of pot when bought (${+now.toFixed(2)}% of today's)` : "% of pot", "wt", t.wt > 0 ? t.wt : "") +
    num("Purification % of profit", "pur", t.pur > 0 ? t.pur : "", `placeholder="none"`);
  if (t.status === "active") {
    box.innerHTML = formBody(`Fix ${tk}. Sells stay intact. "% of pot" sizes it in the fund value.`,
      num("Total shares", "sh", d.boughtSh) + num("Avg price $", "px", avg) + date("Entry date", "d", t.opened) + wtIn, "Save");
  } else {
    const sellPx = exitPx(t) ?? "";
    box.innerHTML = formBody(`Fix ${tk}, closed call. "% of pot" sizes it on the pot.`,
      num("Bought $", "buy", avg) + num("Sold $", "sell", sellPx ? Number(sellPx).toFixed(2) : "") +
      date("Buy date", "d1", t.opened) + date("Sell date", "d2", t.closed || "") + wtIn, "Save");
  }
  wireForm(box, async () => {
    const wtv = parseNum(val(box, "wt"));
    const wt = wtv > 0 ? Math.min(100, wtv) : null, pur = purOf(val(box, "pur"));
    if (t.status === "active") {
      const shares = parseNum(val(box, "sh"));
      const price = parseNum(val(box, "px"));
      const dt = val(box, "d") || t.opened;
      if (!(shares > 0)) return fail("Enter total shares bought.");
      if (!(price > 0)) return fail("Enter the average buy price.");
      if (dt > today()) return fail("The entry date is in the future.");
      const next = (t.txns || []).slice(1).map(x => x.d).filter(Boolean).sort()[0];
      if (next && dt > next) return fail(`The entry date can't be after a later buy or sell (${day(next)}).`);
      const adds = (t.txns || []).reduce((s, x, i) => s + (i && x.t === "buy" && x.wt > 0 ? +x.wt : 0), 0);
      if (wt != null && wt < adds - 0.005) return fail(`${t.ticker}'s later buys alone are ${+adds.toFixed(2)}% of the pot. Undo them first, or enter at least that.`);
      if (shares < d.soldSh) return fail(`You already sold ${sh(d.soldSh)} shares. Total bought can't be less.`);
      const more = extraShare(t, { wt });   // only a bigger size draws on the free cash
      if (more > 0 && cashProblem(more)) return fail(cashProblem(more));
      await store.editActive(t.id, { shares, price, date: dt, wt, pur });
      toast(`${t.ticker} numbers fixed.`);
    } else {
      const buyPx = parseNum(val(box, "buy"));
      const sellPx = parseNum(val(box, "sell"));
      const opened = val(box, "d1") || t.opened;
      const closed = val(box, "d2") || t.closed;
      if (!(buyPx > 0) || !(sellPx > 0)) return fail("Enter both buy and sell prices.");
      if (opened && closed && closed < opened) return fail("Sell date is before the buy date.");
      if (closed > today()) return fail("The sell date is in the future.");
      const lastD = (t.txns || []).map(x => x.d).filter(Boolean).sort().at(-1);
      if (lastD && closed < lastD) return fail(`The sell date can't be before its last trade (${day(lastD)}).`);
      await store.editClosed(t.id, { buyPx, sellPx, opened, closed, wt, pur });
      toast(`${t.ticker} closed call fixed.` + overNote());
    }
  }, holder.querySelector('[data-act="edit"]'));
}

// Purification: the % of the profit given away. Taken off when the call closes;
// on a closed call the result is worked out again straight away.
function openPurForm(holder, t) {
  const box = openBox(holder, "pur");
  if (!box) return;
  const tk = esc(t.ticker);
  box.innerHTML = formBody(t.status === "closed"
      ? `Purification for ${tk}. The locked result is worked out again from ${pct1(t.grossPct ?? t.finalPct)} before purification.`
      : `Purification for ${tk}. It is taken off the profit when this call closes. A loss has nothing to purify.`,
    num("Purification % of profit", "pur", t.pur > 0 ? t.pur : "", `placeholder="e.g. 5"`), "Save");
  wireForm(box, async () => {
    const pur = purOf(val(box, "pur"));
    await store.setPur(t.id, pur);
    toast((pur ? `${t.ticker}: ${pur}% purification${t.status === "closed" ? " applied." : " at close."}` : `${t.ticker}: no purification.`) + overNote());
  }, holder.querySelector('[data-act="pur"]'));
}

/* ----------------------- card + row actions ----------------------- */
// Delegation matches BUTTONS with data-act only: clicks inside an
// inline form (inputs, OK, Cancel) never re-trigger the action.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn || !writable()) return;
  const holder = btn.closest("[data-id]");
  if (!holder) return;
  const t = state.trades.find(x => x.id === holder.dataset.id);
  if (!t) return;
  const act = btn.dataset.act;
  try {
    if (act === "share") return void (await import("./card.js?v=46")).shareCall(t);
    if (act === "del" || act === "reopen" || act === "undo") {
      // two-step: the first click arms the button, a second one at least
      // half a second later confirms (a double-click can never do both)
      const isDel = act === "del", u = act === "undo" ? lastAdd(t) : null;
      if (act === "undo" && !u) return;
      if (act === "reopen" && state.trades.some(x => x.id !== t.id && x.ticker === t.ticker && x.status === "active"))
        return fail(`${t.ticker} is already an active position. Close it before reopening this one.`);
      const more = act === "reopen" ? extraShare(t, { status: "active" })   // a reopened call needs its size in free cash again
        : u ? extraShare(t, { txns: t.txns.slice(0, -1), wt: u.wt }) : 0;   // an undone buy hands back -more of today's pot
      if (more > 0 && cashProblem(more)) return fail(cashProblem(more));
      const what = u && `the buy of ${+(+u.buy.sh).toFixed(4)} ${t.ticker} at ${usd2(+u.buy.px)}`;
      if (btn.dataset.armed) {
        if (Date.now() - +btn.dataset.armed < 500) return;
        if (isDel) { await store.remove(t.id); toast(t.ticker + " deleted." + overNote()); }
        else if (u) { await store.undoBuy(t.id); toast(`Took back ${what}.` + (-more > 0.005 ? ` ${+(-more).toFixed(2)}% of the pot is cash again.` : "")); }
        else { await store.reopen(t.id); toast(t.ticker + " reopened. Live ROI resumed."); }
      } else {
        const label = btn.textContent, aria = btn.getAttribute("aria-label");
        btn.dataset.armed = String(Date.now());
        btn.style.minWidth = btn.getBoundingClientRect().width + "px";   // SURE? keeps the pill's width: the wrapped row can't move under the confirming tap
        btn.textContent = "SURE?";
        btn.classList.add("warn");
        btn.setAttribute("aria-label", isDel ? `SURE? Confirm: delete ${t.ticker} permanently` : u ? `SURE? Confirm: take back ${what}` : `SURE? Confirm: reopen ${t.ticker} and clear its sale`);
        toast(isDel ? `Click SURE? again to delete ${t.ticker} permanently.`
              : u ? `Click SURE? again to take back ${what}.`
                    : `Click SURE? again to reopen ${t.ticker}. Its sale price and result will be cleared.`, true);
        setTimeout(() => {
          if (!btn.isConnected) return;
          delete btn.dataset.armed;
          btn.textContent = label;
          btn.style.minWidth = "";
          btn.classList.remove("warn");
          btn.setAttribute("aria-label", aria);
        }, 3500);
      }
    } else if (act === "edit") {
      openEditForm(holder, t);
    } else if (act === "pur") {
      openPurForm(holder, t);
    } else {
      openInlineForm(holder, t, act);
    }
  } catch (err) { console.error(err); fail(err.message || "Could not save. Try again."); }
});

/* ----------------------- pot editor ----------------------- */
$("#potEdit").addEventListener("click", () => {
  const box = $("#potForm");
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = formBody("Starting pot for the simulation",
    num("Pot $", "amt", state.pot, `placeholder="e.g. 100000"`), "Save");
  wireForm(box, async () => {
    const v = parseNum(val(box, "amt"));
    if (!(v > 0)) return fail("Enter a starting amount, digits only (e.g. 100000).");
    await store.setSimStart(v);
    toast(`The pot now starts from $${v.toLocaleString("en-US")}.`);
  }, $("#potEdit"));
});

/* ----------------------- the two big forms ----------------------- */
async function busy(form, fn) {
  const b = form.querySelector('[type="submit"]');
  b.disabled = true;
  let ok = false;
  try { await fn(); ok = true; }
  catch (err) { console.error(err); fail(err.message || "Could not save. Try again."); }
  finally { ok ? setTimeout(() => (b.disabled = false), 1000) : (b.disabled = false); }   // a quick second tap would hit the emptied form
}

$("#adDate").value = today();
$("#quickAdd").addEventListener("click", (e) => {
  const a = e.target.closest("a[href^='#']"); if (!a) return;
  e.preventDefault();
  const h = document.querySelector(a.getAttribute("href"));
  h.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => h.closest("section, .panel, form, div")?.querySelector("input")?.focus({ preventScroll: true }), 450);
});
$("#addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const ticker = $("#adTicker").value.trim().toUpperCase();
  const shares = parseNum($("#adShares").value);
  const price = parseNum($("#adPrice").value);
  const date = $("#adDate").value || today();
  const wtv = parseNum($("#adWt").value), pur = purOf($("#adPur").value);
  if (!ticker) return fail("Enter a ticker symbol.");
  if (unreadable(form)) return fail(unreadable(form));
  if (!(shares > 0)) return fail("Enter how many shares you bought.");
  if (!(price > 0)) return fail("Enter your average buy price.");
  if (date > today()) return fail("The entry date is in the future.");
  if (state.trades.some(t => t.ticker === ticker && t.status === "active"))
    return fail(ticker + " is already an active position.");
  if (cashProblem(wtv)) return fail(cashProblem(wtv));
  busy(form, async () => {
    toast("Checking " + ticker + "…");
    // the live price feed can be down: a second tap on the same ticker launches it anyway
    if (!(await checkTicker(ticker)) && form.dataset.unverified !== ticker) {
      form.dataset.unverified = ticker;
      return fail(`Couldn't confirm ${ticker} with the price feed (it may be down). Check the symbol, then tap Launch again to add it anyway.`);
    }
    delete form.dataset.unverified;
    const profile = await fetchProfile(ticker);
    await store.add({ ticker, shares, price, date, wt: wtv > 0 ? wtv : null, pur, cash: +cashPct(state.trades).toFixed(4), k: kNow(), ...profile });
    form.reset();
    $("#adDate").value = today();
    newCallCash.refresh();   // reset() empties the box but leaves the last buy's cash check
    toast(ticker + " added. Live ROI is now tracking.");
  });
});

// A past (already sold) call goes straight into Closed.
$("#pastForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const ticker = $("#pcTicker").value.trim().toUpperCase();
  const buyPx = parseNum($("#pcBuy").value);
  const sellPx = parseNum($("#pcSell").value);
  const opened = $("#pcOpened").value || today();   // the dates that will actually be stored
  const closed = $("#pcClosed").value || today();
  const wtv = parseNum($("#pcWt").value), pur = purOf($("#pcPur").value);
  if (!ticker) return fail("Enter a ticker symbol.");
  if (unreadable(form)) return fail(unreadable(form));
  if (!(buyPx > 0)) return fail("Enter the buy price.");
  if (!(sellPx > 0)) return fail("Enter the sell price.");
  if (closed < opened) return fail("Sell date is before the buy date.");
  if (closed > today()) return fail("The sell date is in the future.");
  busy(form, async () => {
    const profile = await fetchProfile(ticker);
    await store.addClosed({ ticker, buyPx, sellPx, opened, closed, wt: wtv > 0 ? Math.min(100, wtv) : null, pur, ...profile });
    form.reset();
    const pct = purified(((sellPx - buyPx) / buyPx) * 100, pur);
    toast(`${ticker} logged: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% locked in.` + overNote());
  });
});

/* ----------------------- auth gate ----------------------- */
if (DEMO) {
  $("#gate").hidden = true;
  $("#dash").hidden = false;
  $("#demoChip").hidden = false;
} else {
  (async () => {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js");
    const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } =
      await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
    const app = window.__fbApp || (window.__fbApp = initializeApp(firebaseConfig));
    const auth = getAuth(app);

    $("#signInBtn").addEventListener("click", () =>
      signInWithPopup(auth, new GoogleAuthProvider()).catch(e => toast(e.message, true)));
    $("#signOutBtn").addEventListener("click", () => signOut(auth));

    onAuthStateChanged(auth, (user) => {
      const owner = !!user && user.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
      canWrite = owner;
      $("#gate").hidden = !!user;
      $("#dash").hidden = !user;
      $("#authBox").hidden = !user;
      if (user) {
        $("#authPhoto").innerHTML = user.photoURL
          ? `<img src="${esc(user.photoURL)}" alt="" width="36" height="36" referrerpolicy="no-referrer">` : "";
        $("#authWho").textContent = user.email || "";
        $("#authRole").textContent = owner ? "Owner" : "View only";
        $("#authRole").classList.toggle("ro", !owner);
      }
      if (user && !owner) toast("Signed in, but this account has no edit access. View only.", true);
      // remember the owner on this device: every page then shows the "+ New call" button
      try { owner ? localStorage.setItem("af:owner", "1") : localStorage.removeItem("af:owner"); } catch (e) {}
      if (owner && !DEMO) healRecord();   // writes nothing once the record is complete
      renderAll();
      // arriving from a "+ New call" link: go straight to the form
      if (owner && location.hash === "#new" && !renderAll.jumped) {
        renderAll.jumped = true;
        setTimeout(() => { $("#newTitle").scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => $("#adTicker")?.focus({ preventScroll: true }), 500); }, 300);
      }
    });
  })().catch(err => { console.error(err); toast("Could not load sign-in. Check the connection, then reload.", true); });
}

/* ----------------------- data (last: demo data arrives synchronously) ----------------------- */
function offline() {
  if (state.ready) return;
  const msg = "Still connecting to the fund record. Check the connection, then reload.";
  $("#activeCards").innerHTML = emptyBox(msg);
  $("#closedList").innerHTML = emptyBox(msg, "li");
  $("#activeCount").textContent = $("#closedCount").textContent = "Offline";
  $("#kMeta").textContent = msg;
}

live((what) => {
  if (what === "trades") {
    const active = state.trades.filter(t => t.status === "active");
    watchNews(active);
    // news.js never renders when the watchlist starts (or ends) empty
    if (!active.length) $("#newsList").innerHTML = WIRE_EMPTY;
    renderAll();
  } else {
    if (what === "settings") newCallCash.refresh();   // the pot in $ moves with the starting pot
    updateLive();
  }
}).catch(err => {
  console.error(err);
  toast("Could not connect to the database.", true);
  offline();
});
setTimeout(offline, 15000);
