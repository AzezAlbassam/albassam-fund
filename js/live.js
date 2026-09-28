// ============================================================
// One live feed for every page: trades (Firestore realtime),
// the pot size (meta/settings) and live quotes for open calls.
//   live(what => render(state))   what: "trades" | "settings" | "quotes"
// ============================================================

import { initStore } from "./store.js?v=10";
import { startPrices, watchTickers, quotes } from "./prices.js?v=10";
import { DEMO } from "./config.js?v=10";

export const state = { trades: [], pot: 100000, quotes, ready: false, cached: false };

// The last snapshot is kept on the device so a returning visitor sees
// numbers at once; the live Firestore feed replaces it within seconds.
const CACHE = "af:snap:v1";

export function live(onChange) {
  startPrices(() => onChange("quotes"));
  try {
    const c = JSON.parse(localStorage.getItem(CACHE));
    if (c?.trades?.length && !DEMO) {
      Object.assign(state, { trades: c.trades, pot: c.pot || state.pot, ready: true, cached: true });
      watchTickers(c.trades.filter(t => t.status === "active").map(t => t.ticker));
      onChange("trades");
    }
  } catch (e) { console.error(e); /* no storage or a bad snapshot: wait for the live feed */ }
  const save = () => {
    if (DEMO) return;   // practice data must never replace the family's record on this device
    try { localStorage.setItem(CACHE, JSON.stringify({ trades: state.trades, pot: state.pot })); } catch (e) {}
  };
  return initStore((trades) => {
    state.trades = trades.map(({ createdAt, ...t }) => t);
    state.ready = true;
    state.cached = false;
    save();
    watchTickers(trades.filter(t => t.status === "active").map(t => t.ticker));
    onChange("trades");
  }, (settings) => {
    if (settings.simStart > 0) state.pot = settings.simStart;
    save();
    onChange("settings");
  });
}
