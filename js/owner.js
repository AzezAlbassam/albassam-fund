// ============================================================
// The owner's quick add: on a device where the manager has signed
// in once (edit.html sets af:owner), every page shows a "+ New call"
// button that opens a small sheet and saves the call straight away.
// The family never sees it: it only appears for the owner's Google
// account, and Firestore rules still check every write.
// ============================================================

import { addPick, addWt, cashProblem, kNow, newPick, unreadable } from "./cashpick.js?v=46";
import { firebaseConfig, OWNER_EMAIL } from "./config.js?v=46";
import { store } from "./store.js?v=46";
import { state } from "./live.js?v=46";
import { checkTicker, fetchProfile } from "./prices.js?v=46";
import { today, derive, lastAdd, cashPct, parseNum, share, withK } from "./roi.js?v=46";
import { day, esc } from "./shell.js?v=46";

// Self-repair on the owner's signed-in visit, once the live record is in.
// Both steps write nothing once done:
// - open calls' buys saved before buys kept their own k (the pot they were
//   sized on, $168,648 for NVDA/SNDK/NBIS) get it written in, so a later
//   edit to an old closed call can never resize them;
// - a call saved without its company name gets one.
let healing = false;
export async function healRecord() {
  if (healing) return;
  healing = true;
  for (let i = 0; i < 60 && !(state.ready && !state.cached); i++) await new Promise(r => setTimeout(r, 500));
  if (!state.ready || state.cached) return;
  for (const { id } of [...state.trades]) {
    const t = state.trades.find(x => x.id === id);   // as it is now: a write moments ago is included
    if (!t) continue;
    try {
      const txns = t.status === "active" ? withK(t, state.trades, state.pot) : null;
      if (txns) await store.saveTxns(t.id, txns);
      if (!t.name) { const p = await fetchProfile(t.ticker); if (p.name) await store.setProfile(t.id, { name: p.name, logo: p.logo || t.logo || "" }); }
    } catch (e) { console.warn("record check:", t.ticker, e); }
  }
}

export async function startOwner() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js");
  const { getAuth, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
  const app = window.__fbApp || (window.__fbApp = initializeApp(firebaseConfig));
  onAuthStateChanged(getAuth(app), (user) => {
    const owner = !!user && user.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
    document.querySelector(".owner-fab")?.remove();
    if (!owner) { try { localStorage.removeItem("af:owner"); } catch (e) {} return; }
    mount();
  });
}

// Buy more, sell, or set purification on a call, from inside its row on the
// Portfolio tab. Rules still check every write against the manager's account.
function mountRowTools() {
  document.body.classList.add("is-owner");
  const dlg = document.createElement("dialog");
  dlg.className = "owner-sheet";
  dlg.setAttribute("aria-labelledby", "otTitle");
  document.body.appendChild(dlg);
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-own-act]");
    if (!b) return;
    const t = state.trades.find(x => x.id === b.dataset.id);
    if (!t) return;
    const act = b.dataset.ownAct;
    const u = act === "undo" ? lastAdd(t) : null;
    if (act === "undo" && !u) return;
    const num = (v) => +(+v).toFixed(4);
    // the undo in today's pot, as the rows and the cash bar count it: the call's share after it, and what returns to cash
    const after = u && share({ ...t, txns: t.txns.slice(0, -1), wt: u.wt }, state.trades), back = u && share(t, state.trades) - after;
    const sized = act === "buy" && t.wt > 0 && derive(t).costBasis > 0;   // a buy that draws on the cash
    const field = (label, name, ph, val = "") => `<label class="os-f"><span>${label}</span><input name="${name}" type="text" inputmode="decimal" autocomplete="off" placeholder="${ph}" value="${val}"></label>`;
    dlg.innerHTML = `<form method="dialog" class="os-form" novalidate>
      <div class="os-head"><h2 id="otTitle">${act === "buy" ? "Buy more " : act === "sell" ? "Sell " : act === "undo" ? "Undo last buy, " : "Purification, "}${esc(t.ticker)}</h2><button type="button" class="os-x" aria-label="Close">×</button></div>
      ${act === "undo" ? `<p class="os-undo">This takes back the buy of <b>${num(u.buy.sh)} shares at $${(+u.buy.px).toFixed(2)}</b> from ${day(u.buy.d)}.${u.back > 0
          ? ` Its <b>${+back.toFixed(2)}% of the pot</b> goes back to cash, and ${esc(t.ticker)} returns to ${+after.toFixed(2)}% of the pot.` : ""} To redo it, use Buy more again.</p>`
        : act === "pur" ? field("Purification % of profit", "pur", "e.g. 5", t.pur > 0 ? t.pur : "") +
          `<p class="os-more" style="text-align:left">${t.status === "closed" ? "The locked result is worked out again." : "Taken off the profit when the call closes. A loss has nothing to purify."}</p>`
        : `<div class="os-row">${field("Shares", "sh", "e.g. 50")}${field("Price $", "px", "e.g. 140", state.quotes[t.ticker]?.c?.toFixed(2) ?? "")}</div>
           ${sized ? field("Adds % of pot", "wt", "e.g. 5") : ""}
           <label class="os-f"><span>Date</span><input name="d" type="date" min="${esc(t.opened)}" max="${today()}" value="${today()}"></label>`}
      <p class="os-msg" role="status"></p>
      <button class="btn os-go" type="submit">${act === "undo" ? "Undo this buy" : "Save"}</button></form>`;
    const f = dlg.querySelector("form"), msg = dlg.querySelector(".os-msg");
    const say = (txt, err) => { msg.textContent = txt; msg.className = "os-msg " + (err ? "err" : "ok"); };
    dlg.querySelector(".os-x").addEventListener("click", () => dlg.close());
    if (sized) addPick(t, f.sh, f.px, f.wt);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const go = f.querySelector(".os-go"); go.disabled = true;
      let ok = false, all = false;   // ok: stored, so the button stays off (a second tap would save it twice); the next open rebuilds the sheet
      try {
        if (unreadable(f)) return say(unreadable(f), true);
        if (act === "undo") await store.undoBuy(t.id);
        else if (act === "pur") {
          const v = parseNum(f.pur.value);
          await store.setPur(t.id, v > 0 ? Math.min(100, v) : null);
        } else {
          const sh = parseNum(f.sh.value), px = parseNum(f.px.value), d = f.d.value || today(), held = derive(t).heldSh;
          if (!(sh > 0)) return say("Enter how many shares.", true);
          if (!(px > 0)) return say("Enter the price.", true);
          if (d < t.opened || d > today()) return say(`Pick a date from ${day(t.opened)} to today.`, true);
          if (act === "sell" && sh > held + 1e-9) return say(`You hold ${+held.toFixed(4)} shares.`, true);
          all = act === "sell" && sh >= held - 1e-9;   // nothing left: the call ends on this sale
          const add = act === "buy" ? addWt(t, sh, px) : null;
          if (add && cashProblem(add)) return say(cashProblem(add), true);
          await store.addTxn(t.id, { t: act, sh, px, d, asOf: today(), ...(add && { wt: +add.toFixed(4), cash: +cashPct(state.trades).toFixed(4), k: kNow() }) }, add ? +(t.wt + add).toFixed(2) : null);
          if (all) await store.close(t.id, px, d);   // the rest is valued at this price, so the locked result equals the sells
        }
        ok = true;
        say(act === "undo" ? "Buy taken back." : all ? `Sold everything. ${t.ticker} is closed.` : "Saved.");
        setTimeout(() => dlg.close(), 700);
      } catch (err) { console.error(err); say(err.message || "Could not save. Try again.", true); }
      finally { if (!ok) go.disabled = false; }
    });
    // a save re-renders the row, so the button that opened the sheet is gone: land on its fresh twin, else the row's head
    dlg.addEventListener("close", () => {
      if (!b.isConnected) (document.querySelector(`[data-own-act="${act}"][data-id="${CSS.escape(t.id)}"]`) || document.querySelector(`.call[data-id="${CSS.escape(t.id)}"] .call-head`))?.focus({ preventScroll: true });
    }, { once: true });
    dlg.showModal();
  });
}

export function mount() {   // exported so the sheet can be exercised without a sign-in
  mountRowTools();
  healRecord();
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "owner-fab";
  fab.innerHTML = `<span aria-hidden="true">+</span> New call`;
  document.body.appendChild(fab);

  const dlg = document.createElement("dialog");
  dlg.className = "owner-sheet";
  dlg.setAttribute("aria-labelledby", "osTitle");
  dlg.innerHTML = `
    <form method="dialog" class="os-form" novalidate>
      <div class="os-head"><h2 id="osTitle">New call</h2><button type="button" class="os-x" aria-label="Close">×</button></div>
      <label class="os-f"><span>Ticker (US market)</span><input name="ticker" type="text" placeholder="e.g. RKLB" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
      <div class="os-row">
        <label class="os-f"><span>Shares bought</span><input name="shares" type="text" inputmode="decimal" autocomplete="off" placeholder="Fills from % of pot"></label>
        <label class="os-f"><span>Avg buy price $</span><input name="price" type="text" inputmode="decimal" autocomplete="off" placeholder="Fills from live price"></label>
      </div>
      <div class="os-row">
        <label class="os-f"><span>Entry date</span><input name="date" type="date"></label>
        <label class="os-f"><span>% of pot (optional)</span><input name="wt" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 30"></label>
        <label class="os-f"><span>Purification % (optional)</span><input name="pur" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 5"></label>
      </div>
      <p class="os-msg" role="status"></p>
      <button class="btn os-go" type="submit">Launch position</button>
      <a class="os-more" href="edit.html">Log a past call, buy, sell or close: open Mission control</a>
    </form>`;
  document.body.appendChild(dlg);
  const f = dlg.querySelector("form"), msg = dlg.querySelector(".os-msg"), go = dlg.querySelector(".os-go");
  const cash = newPick(f.ticker, f.shares, f.price, f.wt);
  const say = (t, err) => { msg.textContent = t; msg.className = "os-msg " + (err ? "err" : "ok"); };

  fab.addEventListener("click", () => { f.reset(); go.disabled = false; delete f.dataset.unverified; f.date.value = f.date.max = today(); say(""); cash.refresh(); dlg.showModal(); setTimeout(() => f.ticker.focus(), 50); });
  dlg.querySelector(".os-x").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // tap outside closes

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker = f.ticker.value.trim().toUpperCase();
    const shares = parseNum(f.shares.value), price = parseNum(f.price.value);
    const date = f.date.value || today(), wtv = parseNum(f.wt.value);
    if (!ticker) return say("Enter a ticker symbol.", true);
    if (unreadable(f)) return say(unreadable(f), true);
    if (!(shares > 0)) return say("Enter how many shares you bought.", true);
    if (!(price > 0)) return say("Enter your average buy price.", true);
    if (date > today()) return say("The entry date is in the future.", true);
    if (state.trades.some(t => t.ticker === ticker && t.status === "active")) return say(ticker + " is already an active position.", true);
    if (cashProblem(wtv)) return say(cashProblem(wtv), true);
    go.disabled = true;
    let ok = false;   // saved: Launch stays off until the sheet is opened again (a second tap would say "already active")
    try {
      say("Checking " + ticker + "…");
      // the price feed can be down: a second tap on the same ticker saves anyway
      if (!(await checkTicker(ticker)) && f.dataset.unverified !== ticker) {
        f.dataset.unverified = ticker;
        return say(`Couldn't confirm ${ticker} with the price feed. Check the symbol, then tap Launch again to save anyway.`, true);
      }
      const profile = await fetchProfile(ticker);
      const pv = parseNum(f.pur.value);
      await store.add({ ticker, shares, price, date, wt: wtv > 0 ? Math.min(100, wtv) : null, pur: pv > 0 ? Math.min(100, pv) : null, cash: +cashPct(state.trades).toFixed(4), k: kNow(), ...profile });
      ok = true;
      say(ticker + " added. Live ROI is now tracking.");
      setTimeout(() => dlg.close(), 1200);
    } catch (err) {
      console.error(err);
      say(err.message || "Could not save. Try again.", true);
    } finally { if (!ok) go.disabled = false; }
  });
}
