// ============================================================
// Sizing a new call from the cash that is left. Sits under a
// "% of pot" field: says how much of the pot is free, and its
// buttons (or your own number) set the field as a share of that
// cash. 38% free, "50%" tapped -> the call is 19% of the pot.
// ============================================================

import { state } from "./live.js?v=29";
import { cashPct } from "./roi.js?v=29";

const fmt = (v) => +(+v).toFixed(1) + "%";

export function cashPick(wtInput) {
  const box = document.createElement("div");
  box.className = "cashpick";
  box.innerHTML = `<p class="cp-line"><b data-cash></b><span data-eq></span></p>
    <div class="cp-row" role="group" aria-label="How much of the remaining cash to use">
      ${[25, 50, 75, 100].map(p => `<button type="button" class="cp-btn" data-cp="${p}">${p === 100 ? "All" : p + "%"}</button>`).join("")}
      <label class="cp-own"><input type="number" min="0" max="100" step="any" inputmode="decimal" placeholder="…" aria-label="Your own % of the remaining cash"><span>% of the cash</span></label>
    </div>`;
  wtInput.closest("label").after(box);   // inside the form grid, on a row of its own
  const own = box.querySelector(".cp-own input");
  const paint = () => {
    const cash = cashPct(state.trades), w = parseFloat(wtInput.value);
    const used = w > 0 && cash > 0 ? (w / cash) * 100 : null;
    box.querySelector("[data-cash]").textContent = cash > 0 ? `Remaining cash: ${fmt(cash)} of the pot.` : "No cash left: the pot is fully invested.";
    box.querySelector("[data-eq]").textContent = used == null ? "" : used > 100.05 ? ` This call needs more than that.` : ` This call uses ${fmt(used)} of it.`;
    box.classList.toggle("over", used > 100.05);
    for (const b of box.querySelectorAll(".cp-btn")) { b.disabled = !(cash > 0); b.setAttribute("aria-pressed", used != null && Math.abs(used - +b.dataset.cp) < 0.05); }
    own.disabled = !(cash > 0);
  };
  const use = (p) => {   // p% of the cash, written into the "% of pot" field
    const cash = cashPct(state.trades);
    if (!(p > 0) || !(cash > 0)) return;
    wtInput.value = +((cash * Math.min(p, 100)) / 100).toFixed(2);
    paint();
  };
  box.addEventListener("click", (e) => { const b = e.target.closest(".cp-btn"); if (b) { own.value = ""; use(+b.dataset.cp); } });
  own.addEventListener("input", () => use(parseFloat(own.value)));
  wtInput.addEventListener("input", () => { own.value = ""; paint(); });
  paint();
  return { refresh: paint };
}

// Why a new call of this size cannot open (or "" if it can).
export function cashProblem(wt) {
  const cash = cashPct(state.trades);
  return wt > cash + 0.005 ? `Only ${fmt(cash)} of the pot is free cash. Lower the size, or close a call first.` : "";
}
