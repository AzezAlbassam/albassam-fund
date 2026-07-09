// ============================================================
// Bootstrap. The page sets <body data-mode="view|edit">.
// View mode: realtime read-only dashboard, no auth, no controls.
// Edit mode: Google sign-in gate, full controls; Firestore
// security rules enforce owner-only writes server-side too.
// ============================================================

import { DEMO, firebaseConfig, OWNER_EMAIL } from "./config.js?v=6";
import { initStore, store } from "./store.js?v=6";
import { startPrices, watchTickers, fetchProfile, checkTicker, quotes } from "./prices.js?v=6";
import { watchNews } from "./news.js?v=6";
import { renderAll, updateLive, toast } from "./render.js?v=6";
import { startStarfield, startSphere } from "./space.js?v=6";
import { derive, fmtMoney, today } from "./roi.js?v=6";

const mode = document.body.dataset.mode || "view";
const state = { trades: [], mode, canWrite: mode === "edit" && DEMO, simStart: 100000 };
const $ = (s) => document.querySelector(s);

/* ----------------------- visuals ----------------------- */
startStarfield($("#stars"));
startSphere($("#sphere"));

function clock() {
  const n = new Date();
  $("#clockT").textContent = n.toTimeString().slice(0, 8);
  $("#clockD").textContent = n.toDateString().toUpperCase().slice(0, 10);
}
clock(); setInterval(clock, 1000);

if (DEMO) $("#demoBanner")?.removeAttribute("hidden");

/* ----------------------- data ----------------------- */
startPrices(() => updateLive(state));

initStore((trades) => {
  state.trades = trades;
  const active = trades.filter(t => t.status === "active");
  watchTickers(active.map(t => t.ticker));
  watchNews(active);
  renderAll(state);
}, (settings) => {
  if (settings.simStart > 0) state.simStart = settings.simStart;
  updateLive(state);
}).catch(err => {
  console.error(err);
  toast("Could not connect to the database.", true);
});

/* ----------------------- auth (edit mode) ----------------------- */
if (mode === "edit" && !DEMO) {
  (async () => {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js");
    const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } =
      await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
    const app = window.__fbApp || (window.__fbApp = initializeApp(firebaseConfig));
    const auth = getAuth(app);

    $("#signInBtn")?.addEventListener("click", () =>
      signInWithPopup(auth, new GoogleAuthProvider()).catch(e => toast(e.message, true)));
    $("#signOutBtn")?.addEventListener("click", () => signOut(auth));

    onAuthStateChanged(auth, (user) => {
      const owner = !!user && user.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
      state.canWrite = owner;
      $("#gate").hidden = !!user;
      $("#dash").hidden = !user;
      $("#authBox").hidden = !user;
      if (user) {
        $("#authPhoto").src = user.photoURL || "";
        $("#authWho").textContent = user.email;
      }
      if (user && !owner)
        toast("Signed in, but this account has no edit access — view only.", true);
      renderAll(state);
    });
  })();
} else if (mode === "edit" && DEMO) {
  $("#gate").hidden = true;
  $("#dash").hidden = false;
}

/* ----------------------- edit actions ----------------------- */
if (mode === "edit") {
  // Add position
  $("#addForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker = $("#adTicker").value.trim().toUpperCase();
    const shares = parseFloat($("#adShares").value);
    const price = parseFloat($("#adPrice").value);
    const date = $("#adDate").value || today();
    if (!ticker) return toast("Enter a ticker symbol.", true);
    if (!(shares > 0)) return toast("Enter how many shares you bought.", true);
    if (!(price > 0)) return toast("Enter your average buy price.", true);
    if (state.trades.some(t => t.ticker === ticker && t.status === "active"))
      return toast(ticker + " is already an active position.", true);
    const wtv = parseFloat($("#adWt")?.value);
    toast("Checking " + ticker + "…");
    if (!(await checkTicker(ticker)))
      return toast(ticker + " not found — is it a US-listed symbol?", true);
    const profile = await fetchProfile(ticker);
    await store.add({ ticker, shares, price, date, wt: wtv > 0 ? wtv : null, ...profile });
    $("#addForm").reset();
    $("#adDate").value = today();
    toast(ticker + " added — live ROI is now tracking.");
  });
  if ($("#adDate")) $("#adDate").value = today();

  // Log a past (already sold) call straight into Closed
  $("#pastForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker = $("#pcTicker").value.trim().toUpperCase();
    const buyPx = parseFloat($("#pcBuy").value);
    const sellPx = parseFloat($("#pcSell").value);
    const opened = $("#pcOpened").value;
    const closed = $("#pcClosed").value;
    if (!ticker) return toast("Enter a ticker symbol.", true, "#pastMsg");
    if (!(buyPx > 0)) return toast("Enter the buy price.", true, "#pastMsg");
    if (!(sellPx > 0)) return toast("Enter the sell price.", true, "#pastMsg");
    if (opened && closed && closed < opened)
      return toast("Sell date is before the buy date.", true, "#pastMsg");
    const wtv = parseFloat($("#pcWt")?.value);
    const profile = await fetchProfile(ticker);
    await store.addClosed({ ticker, buyPx, sellPx, opened, closed, wt: wtv > 0 ? wtv : null, ...profile });
    $("#pastForm").reset();
    const pct = ((sellPx - buyPx) / buyPx) * 100;
    toast(`${ticker} logged: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% locked in.`, false, "#pastMsg");
  });

  // ✎ on the simulator: change the starting pot (e.g. $100K → $10K)
  $("#simEditBtn")?.addEventListener("click", () => {
    const box = $("#simForm");
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `
      <span class="fl">Starting pot for the simulation</span>
      <input type="number" step="any" min="1" placeholder="e.g. 10000" data-in="amt" value="${state.simStart}" style="width:130px">
      <button class="mini" data-go>Save</button>
      <button class="mini ghost" data-cancel>Cancel</button>`;
    box.querySelector("[data-cancel]").addEventListener("click", () => { box.hidden = true; });
    box.querySelector('[data-in="amt"]').addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); box.querySelector("[data-go]").click(); }
    });
    box.querySelector("[data-go]").addEventListener("click", async () => {
      const v = parseFloat(box.querySelector('[data-in="amt"]').value);
      if (!(v > 0)) return toast("Enter a starting amount.", true);
      await store.setSimStart(v);
      box.hidden = true;
      toast(`Simulator now starts from $${v.toLocaleString("en-US")}.`);
    });
  });

  // Card + closed-row actions via event delegation.
  // Match BUTTONS only — clicks inside the inline form (inputs,
  // OK/Cancel) must never re-trigger the action that opened it.
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const holder = btn.closest("[data-id]");
    if (!holder) return;
    const id = holder.dataset.id;
    const t = state.trades.find(x => x.id === id);
    if (!t) return;

    const act = btn.dataset.act;
    if (act === "del") {
      // two-step confirm: first click arms the button, second deletes
      if (btn.dataset.armed) {
        await store.remove(id);
        toast(t.ticker + " deleted.");
      } else {
        btn.dataset.armed = "1";
        btn.textContent = "SURE?";
        btn.classList.add("warn");
        toast(`Click SURE? again to delete ${t.ticker} permanently.`, true);
        setTimeout(() => {
          delete btn.dataset.armed;
          btn.textContent = "✕";
          btn.classList.remove("warn");
        }, 3500);
      }
    } else if (act === "reopen") {
      await store.reopen(id);
      toast(t.ticker + " reopened — live ROI resumed.");
    } else if (act === "buy" || act === "sell" || act === "close") {
      openInlineForm(holder, t, act);
    } else if (act === "edit") {
      openEditForm(holder, t);
    }
  });
}

// ✎ Fix mistyped numbers without deleting the position.
function openEditForm(holder, t) {
  const box = holder.querySelector(".inline-form");
  if (!box) return;
  if (box.dataset.form === "edit" && !box.hidden) { box.hidden = true; box.dataset.form = ""; return; }
  box.dataset.form = "edit";
  box.hidden = false;
  const d = derive(t);
  if (t.status === "active") {
    box.innerHTML = `
      <span class="fl">Fix ${t.ticker} — sells stay intact · "% of pot" sizes it in the fund signal &amp; simulator</span>
      <input type="number" step="any" min="0" placeholder="total shares" data-in="sh" value="${d.boughtSh}">
      <input type="number" step="any" min="0" placeholder="avg price $" data-in="px" value="${d.avgCost ? d.avgCost.toFixed(2) : ""}">
      <input type="date" data-in="d" value="${t.opened}" style="width:135px">
      <input type="number" step="any" min="0" max="100" placeholder="% of pot" data-in="wt" value="${t.wt > 0 ? t.wt : ""}">
      <button class="mini" data-go>Save</button>
      <button class="mini ghost" data-cancel>Cancel</button>`;
  } else {
    const sellPx = t.closePx ?? (d.soldSh > 0 ? d.proceeds / d.soldSh : "");
    box.innerHTML = `
      <span class="fl">Fix ${t.ticker} closed call · "% of pot" sizes it inside its wave</span>
      <input type="number" step="any" min="0" placeholder="bought $" data-in="buy" value="${d.avgCost ? d.avgCost.toFixed(2) : ""}">
      <input type="number" step="any" min="0" placeholder="sold $" data-in="sell" value="${sellPx ? Number(sellPx).toFixed(2) : ""}">
      <input type="date" data-in="d1" value="${t.opened}" style="width:135px">
      <input type="date" data-in="d2" value="${t.closed || ""}" style="width:135px">
      <input type="number" step="any" min="0" max="100" placeholder="% of pot" data-in="wt" value="${t.wt > 0 ? t.wt : ""}">
      <button class="mini" data-go>Save</button>
      <button class="mini ghost" data-cancel>Cancel</button>`;
  }
  box.querySelector("[data-cancel]").addEventListener("click", () => { box.hidden = true; box.dataset.form = ""; });
  box.querySelectorAll("input").forEach(inp => inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); box.querySelector("[data-go]").click(); }
  }));
  box.querySelector("[data-go]").addEventListener("click", async () => {
    const wtv = parseFloat(box.querySelector('[data-in="wt"]').value);
    const wt = wtv > 0 ? Math.min(100, wtv) : null;
    if (t.status === "active") {
      const shares = parseFloat(box.querySelector('[data-in="sh"]').value);
      const price = parseFloat(box.querySelector('[data-in="px"]').value);
      const date = box.querySelector('[data-in="d"]').value || t.opened;
      if (!(shares > 0)) return toast("Enter total shares bought.", true);
      if (!(price > 0)) return toast("Enter the average buy price.", true);
      if (shares < d.soldSh) return toast(`You already sold ${d.soldSh} shares — total bought can't be less.`, true);
      await store.editActive(t.id, { shares, price, date, wt });
      toast(`${t.ticker} numbers fixed.`);
    } else {
      const buyPx = parseFloat(box.querySelector('[data-in="buy"]').value);
      const sellPx = parseFloat(box.querySelector('[data-in="sell"]').value);
      const opened = box.querySelector('[data-in="d1"]').value || t.opened;
      const closed = box.querySelector('[data-in="d2"]').value || t.closed;
      if (!(buyPx > 0) || !(sellPx > 0)) return toast("Enter both buy and sell prices.", true);
      if (opened && closed && closed < opened) return toast("Sell date is before the buy date.", true);
      await store.editClosed(t.id, { buyPx, sellPx, opened, closed, wt });
      toast(`${t.ticker} closed call fixed.`);
    }
    box.hidden = true;
  });
}

function openInlineForm(card, t, act) {
  const box = card.querySelector(".inline-form");
  if (!box) return;
  if (box.dataset.form === act && !box.hidden) { box.hidden = true; box.dataset.form = ""; return; }
  box.dataset.form = act;
  box.hidden = false;
  const q = quotes[t.ticker];
  const live = q ? q.c.toFixed(2) : "";
  const d = derive(t);
  const labels = {
    buy: `Buy more ${t.ticker} — average price updates automatically`,
    sell: `Sell part of ${t.ticker} (holding ${d.heldSh} shares)`,
    close: `Close ${t.ticker} — final ROI locks at this price`,
  };
  box.innerHTML = `
    <span class="fl">${labels[act]}</span>
    ${act !== "close" ? `<input type="number" step="any" min="0" placeholder="shares" data-in="sh">` : ""}
    <input type="number" step="any" min="0" placeholder="price $" data-in="px" value="${live}">
    <button class="mini" data-go>OK</button>
    <button class="mini ghost" data-cancel>Cancel</button>`;
  box.querySelector("[data-cancel]").addEventListener("click", () => { box.hidden = true; box.dataset.form = ""; });
  // Enter inside either field = OK
  box.querySelectorAll("input").forEach(inp => inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); box.querySelector("[data-go]").click(); }
  }));
  box.querySelector("[data-go]").addEventListener("click", async () => {
    const px = parseFloat(box.querySelector('[data-in="px"]').value);
    if (!(px > 0)) return toast("Enter a valid price.", true);
    if (act === "close") {
      await store.close(t.id, px);
      toast(`${t.ticker} closed at ${fmtMoney(px)} — ROI locked in.`);
    } else {
      const sh = parseFloat(box.querySelector('[data-in="sh"]').value);
      if (!(sh > 0)) return toast("Enter a number of shares.", true);
      if (act === "sell" && sh > d.heldSh)
        return toast(`You only hold ${d.heldSh} shares of ${t.ticker}.`, true);
      await store.addTxn(t.id, { t: act, sh, px, d: today() });
      toast(`${t.ticker}: ${act === "buy" ? "bought" : "sold"} ${sh} @ ${fmtMoney(px)}.`);
    }
    box.hidden = true;
  });
}
