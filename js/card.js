// ============================================================
// Share card: one call as a 1080x1350 picture for WhatsApp.
// Drawn on a canvas in the site's own look (paper, ink, thin
// lines; red only for a loss), then offered through the phone's
// share sheet or as a download. Three kinds:
//   NEW CALL     opened today or yesterday: its share of the pot leads
//   OPEN CALL    still running: the return so far leads
//   CALL CLOSED  the final return leads
// Percent first; the stock's own price is the only dollar figure.
// ============================================================

import { state } from "./live.js?v=27";
import { blendedPct, derive, exitPx, simulate, today } from "./roi.js?v=27";
import { history } from "./history.js?v=27";
import { pct1, usd2, day, dayYear, daysBetween } from "./shell.js?v=27";

const W = 1080, H = 1350;
const INK = "#0B0B0C", PAPER = "#FFFFFF", CANVAS = "#DEDDD6", MUTED = "#585861", LOSS = "#D92D20", HAIR = "rgba(11,11,12,.16)";
const SANS = '"Geist",system-ui,sans-serif', MONO = '"Geist Mono",ui-monospace,monospace';
const SITE = "azezalbassam.github.io/albassam-fund";

const isOpen = (t) => t.status !== "closed";
const share = (t) => (t.wt > 0 ? +Number(t.wt).toFixed(1) + "%" : null);

// What the card says, separate from how it is drawn (and easy to check).
export function cardFacts(t, quotes = state.quotes, on = today()) {
  const open = isOpen(t), end = open ? on : t.closed || t.opened;
  const pct = open ? blendedPct(t, quotes[t.ticker]?.c ?? null) : t.finalPct ?? null;
  const held = daysBetween(t.opened, end);
  const kind = !open ? "closed" : held <= 1 ? "new" : "open";
  const d = derive(t), sell = open ? null : exitPx(t);
  return {
    kind, pct, held, end,
    chip: { new: "NEW CALL", open: "OPEN CALL", closed: "CALL CLOSED" }[kind],
    label: { new: "SHARE OF THE POT", open: "RETURN SO FAR", closed: "RETURN ON THIS CALL" }[kind],
    hero: kind === "new" ? share(t) ?? "NEW" : pct == null ? "…" : pct1(pct),
    loss: kind !== "new" && pct != null && pct < 0,
    note: t.pur > 0 ? (open ? `${+t.pur}% purification at close` : `after ${+t.pur}% purification`) : "",
    stats: [
      kind === "new" ? ["OPENED", day(t.opened)] : ["SHARE OF POT", share(t) ?? "Unsized"],
      open ? ["BOUGHT AT", d.avgCost > 0 ? usd2(d.avgCost) : "…"]
        : ["ADDED TO THE POT", t.wt > 0 && pct != null ? pct1((t.wt * pct) / 100) : sell != null ? usd2(sell) : "…"],
    ],
  };
}

async function fonts() {
  try {
    await Promise.race([
      Promise.all(['700 200px "Geist"', '600 40px "Geist"', '400 40px "Geist"', '500 24px "Geist Mono"'].map(f => document.fonts.load(f))),
      new Promise(r => setTimeout(r, 4000)),   // a slow font never blocks the card
    ]);
  } catch (e) { /* system fonts are fine */ }
}

// Daily closes across the hold, with the live price as today's point.
async function holdLine(t, f) {
  let h = { dates: [], closes: [] };
  try {
    h = await Promise.race([history(t.ticker, t.opened), new Promise(r => setTimeout(() => r(h), 7000))]);
  } catch (e) { /* drawn as "day one" */ }
  const pts = [];
  h.dates.forEach((d, i) => { if (d >= t.opened && d <= f.end && h.closes[i] != null) pts.push(h.closes[i]); });
  const live = isOpen(t) && state.quotes[t.ticker]?.c;
  if (live && h.dates.at(-1) !== f.end) pts.push(live);
  return pts;
}

export async function drawCard(t) {
  const f = cardFacts(t);
  const [pts] = await Promise.all([holdLine(t, f), fonts()]);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  const text = (s, x, y, font, fill = INK, align = "left", sp = "0px") => {
    c.font = font; c.fillStyle = fill; c.textAlign = align; c.letterSpacing = sp; c.fillText(s, x, y);
  };
  const line = (x1, y1, x2, y2, w = 2, col = HAIR, dash = []) => {
    c.beginPath(); c.setLineDash(dash); c.lineWidth = w; c.strokeStyle = col; c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.setLineDash([]);
  };

  // the desk: warm grey with a drafting grid
  c.fillStyle = CANVAS; c.fillRect(0, 0, W, H);
  for (let x = 0; x <= W; x += 54) line(x, 0, x, H, 1, "rgba(11,11,12,.05)");
  for (let y = 0; y <= H; y += 54) line(0, y, W, y, 1, "rgba(11,11,12,.05)");

  // the sheet of paper, with its shadow and drafting corner marks
  const X = 60, Y = 60, CW = W - 120, CH = H - 120, L = X + 56, R = X + CW - 56;
  c.save(); c.shadowColor = "rgba(20,20,22,.3)"; c.shadowBlur = 50; c.shadowOffsetY = 24;
  c.fillStyle = PAPER; c.beginPath(); c.roundRect(X, Y, CW, CH, 22); c.fill(); c.restore();
  c.lineWidth = 2; c.strokeStyle = INK; c.beginPath(); c.roundRect(X, Y, CW, CH, 22); c.stroke();
  for (const [cx, cy, sx, sy] of [[X, Y, -1, -1], [X + CW, Y, 1, -1], [X, Y + CH, -1, 1], [X + CW, Y + CH, 1, 1]]) {
    c.beginPath(); c.lineWidth = 3; c.strokeStyle = INK;
    c.moveTo(cx + sx * 22, cy - sy * 20); c.lineTo(cx + sx * 22, cy + sy * 22); c.lineTo(cx - sx * 20, cy + sy * 22); c.stroke();
  }

  // header: the mark, the name, what kind of card this is
  const my = Y + 50;
  c.fillStyle = INK; c.beginPath(); c.roundRect(L, my, 60, 60, 13); c.fill();
  c.save(); c.translate(L, my); c.scale(60 / 32, 60 / 32); c.strokeStyle = PAPER; c.lineCap = c.lineJoin = "round";
  c.lineWidth = 2.6; c.stroke(new Path2D("M8.5 24 16 8l7.5 16")); c.lineWidth = 2; c.stroke(new Path2D("M11.6 18.6l3-2.6 2.2 1.8 3.4-3.4")); c.restore();
  text("Albassam Fund", L + 80, my + 42, `600 36px ${SANS}`);
  c.font = `500 24px ${MONO}`; c.letterSpacing = "4px";
  const chipW = c.measureText(f.chip).width + 52;
  c.beginPath(); c.roundRect(R - chipW, my + 4, chipW, 52, 26);
  if (f.kind === "open") { c.lineWidth = 2; c.strokeStyle = INK; c.stroke(); } else { c.fillStyle = INK; c.fill(); }
  text(f.chip, R - chipW / 2 + 2, my + 39, `500 24px ${MONO}`, f.kind === "open" ? INK : PAPER, "center", "4px");
  line(L, my + 96, R, my + 96, 2, INK);

  // the call: ticker, company, dates
  text(t.ticker, L - 4, 372, `700 150px ${SANS}`, INK, "left", "-5px");
  c.font = `400 34px ${SANS}`; c.letterSpacing = "0px";
  let name = t.name || "";
  while (name && c.measureText(name).width > CW - 112) name = name.slice(0, -2).trimEnd() + "…";
  text(name, L, 428, `400 34px ${SANS}`, MUTED);
  const when = f.kind === "new" ? `Opened ${dayYear(t.opened)}` : `${day(t.opened)} → ${isOpen(t) ? "today" : day(f.end)}  ·  ${f.held === 0 ? "same day" : `held ${f.held} day${f.held === 1 ? "" : "s"}`}`;
  text(when.toUpperCase(), L, 488, `500 24px ${MONO}`, INK, "left", "3px");

  // the number
  text(f.label, L, 588, `500 24px ${MONO}`, MUTED, "left", "4px");
  let size = 250;
  do { c.font = `700 ${size}px ${SANS}`; c.letterSpacing = "-8px"; size -= 10; } while (c.measureText(f.hero).width > CW - 112 && size > 90);
  text(f.hero, L - 8, 596 + size * 0.86, c.font, f.loss ? LOSS : INK, "left", "-8px");
  if (f.note) text(f.note, L, 596 + size * 0.86 + 54, `400 28px ${SANS}`, MUTED);

  // the hold, drawn: a dashed line at the entry price, then every close
  const gx0 = L, gx1 = R, gy0 = 916, gy1 = 1044;
  if (pts.length >= 2) {
    const lo = Math.min(...pts), k = Math.max(...pts) - lo || 1;
    const xy = pts.map((v, i) => [gx0 + (i * (gx1 - gx0)) / (pts.length - 1), gy1 - ((v - lo) / k) * (gy1 - gy0)]);
    line(gx0, xy[0][1], gx1, xy[0][1], 2, MUTED, [4, 10]);
    c.beginPath(); c.lineWidth = 7; c.lineJoin = c.lineCap = "round"; c.strokeStyle = f.loss ? LOSS : INK;
    xy.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
    const [ex, ey] = xy.at(-1);
    c.fillStyle = PAPER; c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.arc(xy[0][0], xy[0][1], 11, 0, 7); c.fill(); c.stroke();
    c.fillStyle = f.loss ? "rgba(217,45,32,.18)" : "rgba(11,11,12,.12)"; c.beginPath(); c.arc(ex, ey, 30, 0, 7); c.fill();
    c.fillStyle = f.loss ? LOSS : INK; c.beginPath(); c.arc(ex, ey, 13, 0, 7); c.fill();
  } else {
    line(gx0, gy1 - 40, gx1, gy1 - 40, 2, MUTED, [4, 10]);
    c.fillStyle = PAPER; c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.arc(gx0 + 12, gy1 - 40, 11, 0, 7); c.fill(); c.stroke();
    const cap = f.kind === "new" ? "DAY ONE. THE LINE STARTS HERE." : f.held === 0 ? "OPENED AND CLOSED THE SAME DAY." : "";
    if (cap) text(cap, gx0 + 44, gy1 - 62, `500 22px ${MONO}`, MUTED, "left", "3px");
  }

  // three facts under a rule
  const fund = simulate(state.trades, state.quotes, state.pot).totalPct;
  const stats = [...f.stats, ["THE FUND OVERALL", pct1(fund)]];
  line(L, 1096, R, 1096, 2, INK);
  stats.forEach(([k, v], i) => {
    const x = L + (i * (R - L)) / 3 + (i ? 28 : 0);
    if (i) line(x - 28, 1116, x - 28, 1206, 2, HAIR);
    text(k, x, 1140, `500 19px ${MONO}`, MUTED, "left", "2px");
    text(v, x, 1200, `600 50px ${SANS}`, v.startsWith("-") ? LOSS : INK, "left", "-1.5px");
  });

  // the small print
  text("Not investment advice. Our own record.", L, Y + CH - 34, `400 21px ${SANS}`, MUTED);
  text(SITE, R, Y + CH - 34, `500 18px ${MONO}`, INK, "right");
  return cv;
}

// The sheet: the card, then Share (the phone's own share sheet) or Save.
export async function shareCall(t) {
  let d = document.querySelector(".share-sheet");
  if (!d) {
    d = document.createElement("dialog");
    d.className = "share-sheet";
    d.setAttribute("aria-label", "Share card");
    d.innerHTML = `<div class="ss-pic"><p class="ss-note">Drawing the card…</p></div>
      <div class="ss-acts"><button class="btn ss-share" type="button" hidden>Share</button><a class="btn ghost ss-save" hidden>Save image</a>
      <button class="ss-x" type="button" aria-label="Close">×</button></div>`;
    d.querySelector(".ss-x").addEventListener("click", () => d.close());
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    document.body.appendChild(d);
  }
  const pic = d.querySelector(".ss-pic"), shareBtn = d.querySelector(".ss-share"), save = d.querySelector(".ss-save");
  pic.innerHTML = `<p class="ss-note">Drawing the card…</p>`;
  shareBtn.hidden = save.hidden = true;
  d.showModal();
  try {
    const cv = await drawCard(t);
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    const file = new File([blob], `albassam-fund-${t.ticker}.png`, { type: "image/png" });
    const url = URL.createObjectURL(blob);
    d.addEventListener("close", () => URL.revokeObjectURL(url), { once: true });
    pic.innerHTML = `<img alt="Share card for ${t.ticker.replace(/[^\w.^-]/g, "")}" src="${url}">`;
    save.href = url; save.download = file.name; save.hidden = false;
    if (navigator.canShare?.({ files: [file] })) {
      shareBtn.hidden = false;
      shareBtn.onclick = () => navigator.share({ files: [file] }).catch(() => {});   // closing the share sheet is not an error
    }
  } catch (err) {
    console.error(err);
    pic.innerHTML = `<p class="ss-note">The card could not be drawn. Try again.</p>`;
  }
}
