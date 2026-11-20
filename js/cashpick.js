// ============================================================
// Sizing a buy from the cash that is left. Sits under a
// "% of pot" field: says how much of the pot is free, and its
// buttons (or your own number) set the field as a share of that
// cash. 38% free, "50%" tapped -> the buy is 19% of the pot.
// Used for a new call and for buying more of an open one.
// ============================================================

import { state } from "./live.js?v=34";
import { cashPct, derive } from "./roi.js?v=34";

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
  return { refresh: paint };
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

// Why a buy of this size cannot go through (or "" if it can).
export function cashProblem(wt) {
  const cash = cashPct(state.trades);
  return wt > cash + 0.005 ? `Only ${fmt(cash)} of the pot is free cash. Lower the size, or close a call first.` : "";
}
