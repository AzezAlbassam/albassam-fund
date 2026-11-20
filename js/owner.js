// ============================================================
// The owner's quick add: on a device where the manager has signed
// in once (edit.html sets af:owner), every page shows a "+ New call"
// button that opens a small sheet and saves the call straight away.
// The family never sees it: it only appears for the owner's Google
// account, and Firestore rules still check every write.
// ============================================================

import { addPick, addWt, cashProblem, newPick } from "./cashpick.js?v=35";
import { firebaseConfig, OWNER_EMAIL } from "./config.js?v=35";
import { store } from "./store.js?v=35";
import { state } from "./live.js?v=35";
import { checkTicker, fetchProfile } from "./prices.js?v=35";
import { today, derive, lastAdd } from "./roi.js?v=35";

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
    const sized = act === "buy" && t.wt > 0 && derive(t).costBasis > 0;   // a buy that draws on the cash
    const field = (label, name, ph, val = "") => `<label class="os-f"><span>${label}</span><input name="${name}" type="number" step="any" min="0" inputmode="decimal" placeholder="${ph}" value="${val}"></label>`;
    dlg.innerHTML = `<form method="dialog" class="os-form" novalidate>
      <div class="os-head"><h2 id="otTitle">${act === "buy" ? "Buy more " : act === "sell" ? "Sell " : act === "undo" ? "Undo last buy, " : "Purification, "}${t.ticker}</h2><button type="button" class="os-x" aria-label="Close">×</button></div>
      ${act === "undo" ? `<p class="os-undo">This takes back the buy of <b>${num(u.buy.sh)} shares at $${(+u.buy.px).toFixed(2)}</b> from ${u.buy.d}.${u.back > 0
          ? ` Its <b>${num((+u.back).toFixed(2))}% of the pot</b> goes back to cash, and ${t.ticker} returns to ${num(u.wt)}% of the pot.` : ""} To redo it, use Buy more again.</p>`
        : act === "pur" ? field("Purification % of profit", "pur", "e.g. 5", t.pur > 0 ? t.pur : "") +
          `<p class="os-more" style="text-align:left">${t.status === "closed" ? "The locked result is worked out again." : "Taken off the profit when the call closes. A loss has nothing to purify."}</p>`
        : `<div class="os-row">${field("Shares", "sh", "e.g. 50")}${field("Price $", "px", "e.g. 140", state.quotes[t.ticker]?.c?.toFixed(2) ?? "")}</div>
           ${sized ? field("Adds % of pot", "wt", "e.g. 5") : ""}
           <label class="os-f"><span>Date</span><input name="d" type="date" value="${today()}"></label>`}
      <p class="os-msg" role="status"></p>
      <button class="btn os-go" type="submit">${act === "undo" ? "Undo this buy" : "Save"}</button></form>`;
    const f = dlg.querySelector("form"), msg = dlg.querySelector(".os-msg");
    const say = (txt, err) => { msg.textContent = txt; msg.className = "os-msg " + (err ? "err" : "ok"); };
    dlg.querySelector(".os-x").addEventListener("click", () => dlg.close());
    if (sized) addPick(t, f.sh, f.px, f.wt);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const go = f.querySelector(".os-go"); go.disabled = true;
      try {
        if (act === "undo") await store.undoBuy(t.id);
        else if (act === "pur") {
          const v = parseFloat(f.pur.value);
          await store.setPur(t.id, v > 0 ? Math.min(100, v) : null);
        } else {
          const sh = parseFloat(f.sh.value), px = parseFloat(f.px.value);
          if (!(sh > 0)) return say("Enter how many shares.", true);
          if (!(px > 0)) return say("Enter the price.", true);
          if (act === "sell" && sh > derive(t).heldSh + 1e-9) return say(`You hold ${+derive(t).heldSh.toFixed(4)} shares.`, true);
          const add = act === "buy" ? addWt(t, sh, px) : null;
          if (add && cashProblem(add)) return say(cashProblem(add), true);
          await store.addTxn(t.id, { t: act, sh, px, d: f.d.value || today(), asOf: today(), ...(add && { wt: +add.toFixed(4) }) }, add ? +(t.wt + add).toFixed(2) : null);
        }
        say(act === "undo" ? "Buy taken back." : "Saved.");
        setTimeout(() => dlg.close(), 700);
      } catch (err) { console.error(err); say(err.message || "Could not save. Try again.", true); }
      finally { go.disabled = false; }
    });
    dlg.showModal();
  });
}

export function mount() {   // exported so the sheet can be exercised without a sign-in
  mountRowTools();
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
        <label class="os-f"><span>Shares bought</span><input name="shares" type="number" step="any" min="0" inputmode="decimal" placeholder="Fills from % of pot"></label>
        <label class="os-f"><span>Avg buy price $</span><input name="price" type="number" step="any" min="0" inputmode="decimal" placeholder="Fills from live price"></label>
      </div>
      <div class="os-row">
        <label class="os-f"><span>Entry date</span><input name="date" type="date"></label>
        <label class="os-f"><span>% of pot (optional)</span><input name="wt" type="number" step="any" min="0" max="100" inputmode="decimal" placeholder="e.g. 30"></label>
        <label class="os-f"><span>Purification % (optional)</span><input name="pur" type="number" step="any" min="0" max="100" inputmode="decimal" placeholder="e.g. 5"></label>
      </div>
      <p class="os-msg" role="status"></p>
      <button class="btn os-go" type="submit">Launch position</button>
      <a class="os-more" href="edit.html">Log a past call, buy, sell or close: open Mission control</a>
    </form>`;
  document.body.appendChild(dlg);
  const f = dlg.querySelector("form"), msg = dlg.querySelector(".os-msg"), go = dlg.querySelector(".os-go");
  const cash = newPick(f.ticker, f.shares, f.price, f.wt);
  const say = (t, err) => { msg.textContent = t; msg.className = "os-msg " + (err ? "err" : "ok"); };

  fab.addEventListener("click", () => { f.reset(); delete f.dataset.unverified; f.date.value = today(); say(""); cash.refresh(); dlg.showModal(); setTimeout(() => f.ticker.focus(), 50); });
  dlg.querySelector(".os-x").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // tap outside closes

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker = f.ticker.value.trim().toUpperCase();
    const shares = parseFloat(f.shares.value), price = parseFloat(f.price.value);
    const date = f.date.value || today(), wtv = parseFloat(f.wt.value);
    if (!ticker) return say("Enter a ticker symbol.", true);
    if (!(shares > 0)) return say("Enter how many shares you bought.", true);
    if (!(price > 0)) return say("Enter your average buy price.", true);
    if (state.trades.some(t => t.ticker === ticker && t.status === "active")) return say(ticker + " is already an active position.", true);
    if (cashProblem(wtv)) return say(cashProblem(wtv), true);
    go.disabled = true;
    try {
      say("Checking " + ticker + "…");
      // the price feed can be down: a second tap on the same ticker saves anyway
      if (!(await checkTicker(ticker)) && f.dataset.unverified !== ticker) {
        f.dataset.unverified = ticker;
        return say(`Couldn't confirm ${ticker} with the price feed. Check the symbol, then tap Launch again to save anyway.`, true);
      }
      const profile = await fetchProfile(ticker);
      const pv = parseFloat(f.pur.value);
      await store.add({ ticker, shares, price, date, wt: wtv > 0 ? Math.min(100, wtv) : null, pur: pv > 0 ? Math.min(100, pv) : null, ...profile });
      say(ticker + " added. Live ROI is now tracking.");
      setTimeout(() => dlg.close(), 1200);
    } catch (err) {
      console.error(err);
      say(err.message || "Could not save. Try again.", true);
    } finally { go.disabled = false; }
  });
}
