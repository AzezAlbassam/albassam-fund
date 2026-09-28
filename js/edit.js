// ============================================================
// Mission control (edit.html): the fund manager's desk.
// Google sign-in gate, owner check, every write action. Two
// render paths so typing in a form is never wiped by a tick:
//  * renderAll  rebuilds the lists (trade data changed)
//  * updateLive retouches only live numbers (prices, pot)
// Firestore rules enforce owner-only writes server-side too.
// ============================================================

import { DEMO, firebaseConfig, OWNER_EMAIL } from "./config.js?v=11";
import { store } from "./store.js?v=11";
import { live, state } from "./live.js?v=11";
import { quotes, fetchProfile, checkTicker } from "./prices.js?v=11";
import { watchNews } from "./news.js?v=11";
import { derive, blendedPct, simulate, computeStats, fmtPct, today, exitPx } from "./roi.js?v=11";
import { initShell, observeReveals, roll, countTo, esc, logoHtml, pctClass, usd0, usd2, signedUsd, pct1, shortUsd, day, dayYear, daysBetween } from "./shell.js?v=11";

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
function renderAll() {
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
      ${t.wt > 0 ? `<div><dt>Pot share</dt><dd>${esc(t.wt)}%</dd></div>
      <div><dt>On the pot</dt><dd data-f="onpot">${WAIT}</dd></div>` : ""}
      ${canWrite ? `<div><dt>Shares held</dt><dd>${sh(d.heldSh)}${d.soldSh ? ` <small>sold ${sh(d.soldSh)}</small>` : ""}</dd></div>` : ""}
    </dl>
    <div class="bar" aria-hidden="true"><i data-f="bar"></i></div>
    <p class="meta">Opened ${esc(dayYear(t.opened))} · ${daysBetween(t.opened, today()) ? heldFor(t.opened, today()).toLowerCase() : "new today"} · ${n} txn${n === 1 ? "" : "s"}</p>
    ${writable() ? `<div class="ctl" role="group" aria-label="Actions for ${tk}">
      <button class="act" type="button" data-act="buy">+ Buy</button>
      <button class="act" type="button" data-act="sell">− Sell</button>
      <button class="act" type="button" data-act="close">Close</button>
      <button class="act" type="button" data-act="edit" aria-label="Fix ${tk} numbers">✎ Fix</button>
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
        <p>${t.wt > 0 && p != null
          ? `<span>${esc(t.wt)}% of pot</span><span data-onpot="${t.wt * p}"></span>`
          : `<span class="muted">No pot size yet</span>`}</p>
      </div>
      ${writable() ? `<div class="crow-acts" role="group" aria-label="Actions for ${tk}">
        <button class="act" type="button" data-act="edit" aria-label="Fix ${tk} numbers">✎ Fix</button>
        <button class="act" type="button" data-act="reopen" aria-label="Reopen ${tk}">↩ Reopen</button>
        <button class="act del" type="button" data-act="del" aria-label="Delete ${tk}">✕</button>
      </div>` : ""}
    </div>
    ${writable() ? `<div class="inline-form" hidden></div>` : ""}
  </li>`;
}

/* ----------------------- render: live numbers only ----------------------- */
function setOnPot(el, wtTimesPct, suffix = "") {
  const v = wtTimesPct == null ? null : (wtTimesPct * state.pot) / 1e4;
  el.textContent = v == null ? WAIT : signedUsd(v) + suffix;
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
      ? `<span class="${pctClass(q.dp)}">${pct2(q.dp)}</span> today` : "Waiting for price";
    const bar = f("bar");
    bar.className = p < 0 ? "neg" : "";
    bar.style.transform = `scaleX(${p == null ? 0 : Math.min(Math.abs(p), 100) / 100})`;
    const op = f("onpot");
    if (op) setOnPot(op, p == null ? null : t.wt * p);
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
  const unsized = state.trades.filter(t => !(t.wt > 0)).length;
  $("#kMeta").textContent = `Banked ${signedUsd(sim.realizedDollars)} · open ${pct1(sim.openPct)}` +
    (unsized ? ` · ${unsized} call${unsized > 1 ? "s" : ""} with no pot size yet` : "");
  roll($("#kOpen"), String(st.nOpen));
  roll($("#kClosed"), String(st.nClosed));
  roll($("#kWin"), st.winRate == null ? "n/a" : st.winRate + "%");
  $("#kWinTile").style.setProperty("--p", st.winRate ?? 0);
}

/* ----------------------- inline form plumbing ----------------------- */
const fld = (label, attrs) => `<label class="fld"><span>${label}</span><input ${attrs}></label>`;
const num = (label, key, val = "") =>
  fld(label, `type="number" step="any" min="0" inputmode="decimal" data-in="${key}" value="${esc(val)}"`);
const date = (label, key, val = "") => fld(label, `type="date" data-in="${key}" value="${esc(val)}"`);
const val = (box, k) => box.querySelector(`[data-in="${k}"]`).value;

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
  const titles = {
    buy: `Buy more ${tk}. The average price updates on its own.`,
    sell: `Sell part of ${tk}. Holding ${sh(d.heldSh)} shares.`,
    close: `Close ${tk}. The final result locks at this price.`,
  };
  box.innerHTML = formBody(titles[act],
    (act !== "close" ? num("Shares", "sh") : "") + num("Price $", "px", q ? q.c.toFixed(2) : ""),
    act === "close" ? "Close call" : "OK");
  wireForm(box, async () => {
    const px = parseFloat(val(box, "px"));
    if (!(px > 0)) return fail("Enter a valid price.");
    if (act === "close") {
      await store.close(t.id, px);
      toast(`${t.ticker} closed at ${usd2(px)}. ROI locked in.`);
      return;
    }
    const n = parseFloat(val(box, "sh"));
    if (!(n > 0)) return fail("Enter a number of shares.");
    if (act === "sell" && n > d.heldSh) return fail(`You only hold ${sh(d.heldSh)} shares of ${t.ticker}.`);
    await store.addTxn(t.id, { t: act, sh: n, px, d: today() });
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
  const wtIn = fld("% of pot", `type="number" step="any" min="0" max="100" inputmode="decimal" data-in="wt" value="${t.wt > 0 ? esc(t.wt) : ""}"`);
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
    const wtv = parseFloat(val(box, "wt"));
    const wt = wtv > 0 ? Math.min(100, wtv) : null;
    if (t.status === "active") {
      const shares = parseFloat(val(box, "sh"));
      const price = parseFloat(val(box, "px"));
      const dt = val(box, "d") || t.opened;
      if (!(shares > 0)) return fail("Enter total shares bought.");
      if (!(price > 0)) return fail("Enter the average buy price.");
      if (shares < d.soldSh) return fail(`You already sold ${sh(d.soldSh)} shares. Total bought can't be less.`);
      await store.editActive(t.id, { shares, price, date: dt, wt });
      toast(`${t.ticker} numbers fixed.`);
    } else {
      const buyPx = parseFloat(val(box, "buy"));
      const sellPx = parseFloat(val(box, "sell"));
      const opened = val(box, "d1") || t.opened;
      const closed = val(box, "d2") || t.closed;
      if (!(buyPx > 0) || !(sellPx > 0)) return fail("Enter both buy and sell prices.");
      if (opened && closed && closed < opened) return fail("Sell date is before the buy date.");
      await store.editClosed(t.id, { buyPx, sellPx, opened, closed, wt });
      toast(`${t.ticker} closed call fixed.`);
    }
  }, holder.querySelector('[data-act="edit"]'));
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
    if (act === "del" || act === "reopen") {
      // two-step: the first click arms the button, a second one at least
      // half a second later confirms (a double-click can never do both)
      const isDel = act === "del";
      if (btn.dataset.armed) {
        if (Date.now() - +btn.dataset.armed < 500) return;
        if (isDel) { await store.remove(t.id); toast(t.ticker + " deleted."); }
        else { await store.reopen(t.id); toast(t.ticker + " reopened. Live ROI resumed."); }
      } else {
        const label = btn.textContent, aria = btn.getAttribute("aria-label");
        btn.dataset.armed = String(Date.now());
        btn.textContent = "SURE?";
        btn.classList.add("warn");
        btn.setAttribute("aria-label", isDel ? `SURE? Confirm: delete ${t.ticker} permanently` : `SURE? Confirm: reopen ${t.ticker} and clear its sale`);
        toast(isDel ? `Click SURE? again to delete ${t.ticker} permanently.`
                    : `Click SURE? again to reopen ${t.ticker}. Its sale price and result will be cleared.`, true);
        setTimeout(() => {
          if (!btn.isConnected) return;
          delete btn.dataset.armed;
          btn.textContent = label;
          btn.classList.remove("warn");
          btn.setAttribute("aria-label", aria);
        }, 3500);
      }
    } else if (act === "edit") {
      openEditForm(holder, t);
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
    fld("Pot $", `type="number" step="any" min="1" inputmode="decimal" placeholder="e.g. 10000" data-in="amt" value="${esc(state.pot)}"`), "Save");
  wireForm(box, async () => {
    const v = parseFloat(val(box, "amt"));
    if (!(v > 0)) return fail("Enter a starting amount.");
    await store.setSimStart(v);
    toast(`The pot now starts from $${v.toLocaleString("en-US")}.`);
  }, $("#potEdit"));
});

/* ----------------------- the two big forms ----------------------- */
async function busy(form, fn) {
  const b = form.querySelector('[type="submit"]');
  b.disabled = true;
  try { await fn(); }
  catch (err) { console.error(err); fail(err.message || "Could not save. Try again."); }
  finally { b.disabled = false; }
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
  const shares = parseFloat($("#adShares").value);
  const price = parseFloat($("#adPrice").value);
  const date = $("#adDate").value || today();
  const wtv = parseFloat($("#adWt").value);
  if (!ticker) return fail("Enter a ticker symbol.");
  if (!(shares > 0)) return fail("Enter how many shares you bought.");
  if (!(price > 0)) return fail("Enter your average buy price.");
  if (state.trades.some(t => t.ticker === ticker && t.status === "active"))
    return fail(ticker + " is already an active position.");
  busy(form, async () => {
    toast("Checking " + ticker + "…");
    if (!(await checkTicker(ticker))) return fail(ticker + " not found. Is it a US-listed symbol?");
    const profile = await fetchProfile(ticker);
    await store.add({ ticker, shares, price, date, wt: wtv > 0 ? wtv : null, ...profile });
    form.reset();
    $("#adDate").value = today();
    toast(ticker + " added. Live ROI is now tracking.");
  });
});

// A past (already sold) call goes straight into Closed.
$("#pastForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const ticker = $("#pcTicker").value.trim().toUpperCase();
  const buyPx = parseFloat($("#pcBuy").value);
  const sellPx = parseFloat($("#pcSell").value);
  const opened = $("#pcOpened").value || today();   // the dates that will actually be stored
  const closed = $("#pcClosed").value || today();
  const wtv = parseFloat($("#pcWt").value);
  if (!ticker) return fail("Enter a ticker symbol.");
  if (!(buyPx > 0)) return fail("Enter the buy price.");
  if (!(sellPx > 0)) return fail("Enter the sell price.");
  if (closed < opened) return fail("Sell date is before the buy date.");
  busy(form, async () => {
    const profile = await fetchProfile(ticker);
    await store.addClosed({ ticker, buyPx, sellPx, opened, closed, wt: wtv > 0 ? wtv : null, ...profile });
    form.reset();
    const pct = ((sellPx - buyPx) / buyPx) * 100;
    toast(`${ticker} logged: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% locked in.`);
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
      renderAll();
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
    updateLive();
  }
}).catch(err => {
  console.error(err);
  toast("Could not connect to the database.", true);
  offline();
});
setTimeout(offline, 15000);
