# Albassam Fund — Live Trades Tracker

A private, live ROI tracker for the Albassam Fund WhatsApp stock calls.
Static site (GitHub Pages) + Firebase Firestore (realtime sync) + Finnhub
(live US stock prices and company logos).

## The two links

| Mode | URL | Who |
|------|-----|-----|
| **View** (read-only, live) | `https://<user>.github.io/albassam-fund/` | share with family |
| **Edit** (mission control) | `https://<user>.github.io/albassam-fund/edit.html` | you only — Google sign-in required |

View mode has no buttons or inputs at all, and Firestore security rules
(`firestore.rules`) additionally block every write that doesn't come from
the owner's signed-in Google account — so the view link is safe to share.

## How ROI works

Each position stores its transactions (buys and partial sells). The card
shows one **blended ROI**:

```
ROI % = (sell proceeds + shares still held × live price − total cost of all buys)
        ÷ total cost of all buys × 100
```

Buying more automatically lowers/raises your average cost; selling part
locks that part's profit into the same number. Closing a position locks
the final ROI at your close price. Prices refresh every 30 seconds.

## Data model (Firestore, collection `trades`)

```
ticker    "RKLB"
name      "Rocket Lab"        cached from Finnhub
logo      "https://…"         cached from Finnhub
status    "active" | "closed"
opened    "2026-07-04"
closed    "2026-08-01" | null
closePx   number | null       price used when closing
finalPct  number | null       ROI locked at close
txns      [{t:"buy"|"sell", sh:shares, px:price, d:"YYYY-MM-DD"}]
createdAt server timestamp
```

## Publishing a change (design tweak, new feature…)

```bash
cd ~/albassam-fund
git add -A
git commit -m "describe the change"
git push
```

GitHub Pages redeploys automatically in ~1 minute. Hard-refresh the page
(Cmd+Shift+R) to see it.

## Updating Firestore security rules

```bash
cd ~/albassam-fund
~/.local/bin/firebase deploy --only firestore:rules
```

## Configuration

All keys live in `js/config.js` (Firebase web config + Finnhub API key).
While placeholders are present the site runs in **demo mode** with sample
data — handy for previewing design changes locally:

```bash
cd ~/albassam-fund && python3 -m http.server 8080
# open http://localhost:8080
```
