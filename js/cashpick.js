// ============================================================
// Sizing a buy from the cash that is left. Sits under a
// "% of pot" field: says how much of the pot is free, and its
// buttons (or your own number) set the field as a share of that
// cash. 38% free, "50%" tapped -> the buy is 19% of the pot.
// Used for a new call and for buying more of an open one.
// ============================================================

import { state } from "./live.js?v=40";
import { checkTicker, quotes } from "./prices.js?v=40";
import { cashPct, simulate } from "./roi.js?v=40";

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

// The whole pot in dollars: the starting pot plus every gain banked so
// far ($100K and +68.6% banked = $168.6K). Grows by itself as calls close.
// Every "% of pot" buy is sized on it: 1% of the pot = potUsd / 100.
export const potUsd = () => Math.round(state.pot * (1 + simulate(state.trades, {}, state.pot).realizedPct / 100));

// What share of the pot a buy of sh shares at px is (sized calls only).
export const addWt = (t, sh, px) => (t.wt > 0 && sh > 0 && px > 0 ? ((sh * px) / potUsd()) * 100 : null);

// "Pot size $" under the cash buttons: shows what 1% is. Changing it
// only sizes this one buy.
function potField(pick, onChange) {
  pick.box.insertAdjacentHTML("beforeend", `<label class="cp-own cp-pot"><span>Pot size $</span><input type="number" min="0" step="any" inputmode="decimal" aria-label="The whole pot in dollars"><span data-one></span></label>`);
  const potIn = pick.box.querySelector(".cp-pot input"), one = pick.box.querySelector("[data-one]");
  const pot = () => parseFloat(potIn.value) || potUsd();
  const paint = () => { one.textContent = `1% = $${Math.round(pot() / 100).toLocaleString("en-US")}`; };
  potIn.addEventListener("input", () => { paint(); onChange(); });
  const refresh = () => { if (document.activeElement !== potIn) potIn.value = potUsd(); paint(); };
  refresh();
  return { pot, refresh };
}

// Shares and "% of pot" move together through the price and the pot size.
// Whichever was typed last leads. Used by the new-call and buy-more forms.
function sizePick(shIn, pxIn, wtIn, lead) {
  const sync = () => {
    const px = parseFloat(pxIn.value), p = potF.pot();
    if (px > 0 && lead === "wt") { const w = parseFloat(wtIn.value); shIn.value = w > 0 ? +(((w / 100) * p) / px).toFixed(4) : ""; }
    else if (px > 0 && lead === "sh") { const sh = parseFloat(shIn.value); wtIn.value = sh > 0 ? +(((sh * px) / p) * 100).toFixed(2) : ""; }
    potF.refresh(); pick.refresh();
  };
  const pick = cashPick(wtIn, () => { lead = "wt"; sync(); });
  const potF = potField(pick, sync);
  wtIn.addEventListener("input", () => { lead = "wt"; sync(); });
  shIn.addEventListener("input", () => { lead = "sh"; sync(); });
  pxIn.addEventListener("input", sync);
  sync();
  return { sync, refresh: () => { potF.refresh(); sync(); } };
}

// Buying more of an open, sized call.
export const addPick = (t, shIn, pxIn, wtIn) => sizePick(shIn, pxIn, wtIn, "sh");

// A new call: picking a % of the pot fills Shares, and the price fills
// from the live quote once the ticker is in.
export function newPick(tkIn, shIn, pxIn, wtIn) {
  const p = sizePick(shIn, pxIn, wtIn, "wt");
  tkIn.addEventListener("change", async () => {
    const tk = tkIn.value.trim().toUpperCase();
    if (!tk || pxIn.value) return;
    if ((await checkTicker(tk)) && quotes[tk]?.c > 0 && !pxIn.value) { pxIn.value = +quotes[tk].c.toFixed(2); p.sync(); }
  });
  return p;
}

// Why a buy of this size cannot go through (or "" if it can).
export function cashProblem(wt) {
  const cash = cashPct(state.trades);
  return wt > cash + 0.005 ? `Only ${fmt(cash)} of the pot is free cash. Lower the size, or close a call first.` : "";
}
