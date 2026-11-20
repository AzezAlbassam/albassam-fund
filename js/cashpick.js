// ============================================================
// Sizing a buy from the cash that is left. Sits under a
// "% of pot" field: says how much of the pot is free, and its
// buttons (or your own number) set the field as a share of that
// cash. 38% free, "50%" tapped -> the buy is 19% of the pot.
// Used for a new call and for buying more of an open one.
// ============================================================

import { state } from "./live.js?v=36";
import { checkTicker, quotes } from "./prices.js?v=36";
import { cashPct, derive } from "./roi.js?v=36";

const fmt = (v) => +(+v).toFixed(1) + "%";

export function cashPick(wtInput, onPick) {
  const box = document.createElement("div");
  box.className = "cashpick";
  box.innerHTML = `<p class="cp-line"><b data-cash></b><span data-eq></span></p>
    <div class="cp-row" role="group" aria-label="How much of the remaining cash to use">
      ${[12.5, 25, 50, 75, 100].map(p => `<button type="button" class="cp-btn" data-cp="${p}">${p === 100 ? "All" : p + "%"}</button>`).join("")}
      <label class="cp-own"><input type="number" min="0" max="100" step="any" inputmode="decimal" placeholder="…" aria-label="Your own % of the remaining cash"><span>% of the cash</span></label>
    </div>`;
  wtInput.closest("label").after(box);   // inside the form grid, on a row of its own
  const own = box.querySelector(".cp-own input");
  const paint = () => {
    const cash = cashPct(state.trades), w = parseFloat(wtInput.value);
    const used = w > 0 && cash > 0 ? (w / cash) * 100 : null;
    box.querySelector("[data-cash]").textContent = cash > 0 ? `Remaining cash: ${fmt(cash)} of the pot.` : "No cash left: the pot is fully invested.";
    box.querySelector("[data-eq]").textContent = used == null ? "" : used > 100.05 ? ` This needs more than that.` : ` This uses ${fmt(used)} of it.`;
    box.classList.toggle("over", used > 100.05);
    for (const b of box.querySelectorAll(".cp-btn")) { b.disabled = !(cash > 0); b.setAttribute("aria-pressed", used != null && Math.abs(used - +b.dataset.cp) < 0.05); }
    own.disabled = !(cash > 0);
  };
  const use = (p) => {   // p% of the cash, written into the "% of pot" field
    const cash = cashPct(state.trades);
    if (!(p > 0) || !(cash > 0)) return;
    wtInput.value = +((cash * Math.min(p, 100)) / 100).toFixed(2);
    paint();
    onPick?.();
  };
  box.addEventListener("click", (e) => { const b = e.target.closest(".cp-btn"); if (b) { own.value = ""; use(+b.dataset.cp); } });
  own.addEventListener("input", () => use(parseFloat(own.value)));
  wtInput.addEventListener("input", () => { own.value = ""; paint(); });
  paint();
  return { refresh: paint, box };
}

// Buying more of a sized call. Its "% of pot" stands for all the money
// put into it, so a buy adds pot share in step with its cost: twice the
// cost so far = twice the size. addWt gives that share for a buy.
export const addWt = (t, sh, px) => {
  const cost = derive(t).costBasis;
  return t.wt > 0 && cost > 0 && sh > 0 && px > 0 ? (sh * px * t.wt) / cost : null;
};

// The buy-more form: "Adds % of pot" (with the cash picker under it) and
// Shares move together through the price. Whichever was typed last leads.
export function addPick(t, shIn, pxIn, wtIn) {
  const perPct = derive(t).costBasis / t.wt;   // cost of 1% of the pot in this call
  let lead = "sh";
  const sync = () => {
    const px = parseFloat(pxIn.value);
    if (px > 0 && lead === "wt") { const w = parseFloat(wtIn.value); shIn.value = w > 0 ? +((w * perPct) / px).toFixed(4) : ""; }
    else if (px > 0) { const w = addWt(t, parseFloat(shIn.value), px); wtIn.value = w ? +w.toFixed(2) : ""; }
    pick.refresh();
  };
  const pick = cashPick(wtIn, () => { lead = "wt"; sync(); });
  wtIn.addEventListener("input", () => { lead = "wt"; sync(); });
  shIn.addEventListener("input", () => { lead = "sh"; sync(); });
  pxIn.addEventListener("input", sync);
  sync();
}

// The pot in dollars, so a new call's "% of pot" can become shares.
// The site only stores percents, so it is read off the open sized calls
// (money in them / their % of pot) unless the owner typed it on this
// device. ponytail: an estimate; the owner's own number wins.
const POT = "af:potUsd";
export function potUsd() {
  try { const v = +localStorage.getItem(POT); if (v > 0) return v; } catch (e) {}
  let cost = 0, wt = 0;
  for (const t of state.trades) if (t.status === "active" && t.wt > 0) { cost += derive(t).costBasis; wt += t.wt; }
  return wt > 0 && cost > 0 ? Math.round((cost / wt) * 100) : state.pot;
}

// The new-call form: picking a % of the pot fills Shares from the
// price, and the price fills from the live quote once the ticker is in.
export function newPick(tkIn, shIn, pxIn, wtIn) {
  let lead = "wt";
  const pick = cashPick(wtIn, () => { lead = "wt"; sync(); });
  pick.box.insertAdjacentHTML("beforeend", `<label class="cp-own cp-pot"><span>Pot size $</span><input type="number" min="0" step="any" inputmode="decimal" aria-label="The whole pot in dollars"><span data-one></span></label>`);
  const potIn = pick.box.querySelector(".cp-pot input"), one = pick.box.querySelector("[data-one]");
  const sync = () => {
    const pot = parseFloat(potIn.value) || potUsd(), px = parseFloat(pxIn.value), w = parseFloat(wtIn.value);
    one.textContent = `1% = $${Math.round(pot / 100).toLocaleString("en-US")}`;
    if (lead === "wt" && px > 0 && w > 0) shIn.value = +(((w / 100) * pot) / px).toFixed(4);
    pick.refresh();
  };
  const fillPx = async () => {
    const tk = tkIn.value.trim().toUpperCase();
    if (!tk || pxIn.value) return;
    if ((await checkTicker(tk)) && quotes[tk]?.c > 0 && !pxIn.value) { pxIn.value = +quotes[tk].c.toFixed(2); sync(); }
  };
  potIn.addEventListener("input", () => {
    const v = parseFloat(potIn.value);
    try { localStorage.setItem(POT, v > 0 ? v : ""); } catch (e) {}
    sync();
  });
  tkIn.addEventListener("change", fillPx);
  wtIn.addEventListener("input", () => { lead = "wt"; sync(); });
  shIn.addEventListener("input", () => { lead = "sh"; });
  pxIn.addEventListener("input", sync);
  const refresh = () => { if (document.activeElement !== potIn) potIn.value = potUsd(); sync(); };
  refresh();
  return { refresh };
}

// Why a buy of this size cannot go through (or "" if it can).
export function cashProblem(wt) {
  const cash = cashPct(state.trades);
  return wt > cash + 0.005 ? `Only ${fmt(cash)} of the pot is free cash. Lower the size, or close a call first.` : "";
}
