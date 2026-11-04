# APEX Sports Center · Monster Sales Tracker — Continuation Notes

Last updated: 2026-11-04. Published page: https://claude.ai/artifact/7v1mio6kLvGN2YCd2Nn9ui (version 13).

## What is in this zip
| File | What it is |
|---|---|
| `monster-sales.html` | The whole app: one self-contained HTML file (markup, CSS and JavaScript together). |
| `data-snapshot.json` | A copy of the database as of 2026-11-04 (sales, restocks, ref moves, October batches, settings). |
| `CONTINUATION.md` | This file. |

**Important:** the HTML file contains no data. Opened alone it is empty and cannot save. Records are stored in the artifact's built-in database (the `db` capability), which belongs to the published page. The snapshot is a backup, not a live link.

## What the app does
Dark Monster theme (black, neon green), Barlow / Barlow Condensed fonts. Hash-routed views, opened from a one-column home menu with hover effects:
- **Tracker** – record a sale (buyer, flavor, qty, price, method Cash/GCash/MariBank/Debt, paid or unpaid, date/time); edit and delete; range tabs; prices and flavors settings with starting account amounts; **Daily log** (sales that have a buyer, grouped by date like "Nov. 3, 2026", oldest first).
- **Statistics** – November summary: daily, weekly, monthly; flavor mix. October is kept separate.
- **Accounting** – money on hand per account (Cash, GCash, MariBank), October capital/profit, cash-on-hand split input, price and cost settings.
- **Money Manager** – income, expense and transfer entries with category, account, date/time, note; edit/delete; month navigator; summary tiles; by-category bars. Monster sales, restocks and October batches appear automatically as read-only "Auto" rows. Entries change account balances.
- **History** – sales history list, edit/delete, Export CSV.
- **Stock & Inventory** – "In ref" (fridge) list and "Stock on hand" (overall) list, both editable; Move to ref; restock form with expense and "paid from"; restock/ref history.

## Database collections
| Collection / doc | Fields |
|---|---|
| `sales` | buyer, flavor, qty, price, cost, method, paid, paidMethod (Debt once paid), ts (ms) |
| `restocks` | flavor, qty, cost, expense, paidFrom, type (`restock` or `adjust`), ts. Adjust rows have qty +/- and no expense |
| `refmoves` | flavor, qty, type (`move` or `adjust`), ts |
| `money` | type (income/expense/transfer), amount, category, account, to, note, ts |
| `oct_batches` | label, order, capital, shipping, items [{flavor, cases}] |
| `oct/config` | price, cost, perCase, estimated, sold [{flavor, qty}] |
| `settings/main` | price, cost, flavors[], optional open {cash, gcash, maribank} |

## Rules the code follows
- Stock on hand (overall) = all restock rows (including adjust) minus all sales. Ref = refmoves minus sales.
- Restock expense: 0 for adjust; else `expense` if set; else qty × cost.
- Account balance = starting amounts + paid sales (Debt uses paidMethod) − restock expenses by paidFrom ± Money Manager entries.
- Flavors: Original Green (Black), Ultra Violet (Purple), Ultra White (White), Mango Loco (Blue), Ultra Paradise (Green), Pipeline Punch (Pink).
- Price ₱95, cost ₱54.17 per can.

## Business facts recorded
- October capital: 2 batches of 20 cases × 12 cans (₱6,500 each) plus shipping ₱250 and ₱300. October sold figures are estimates (`estimated: true`).
- Expected cash at Oct 31: ₱1,365 (157 cans × 95 − 13,550).
- As of 2026-11-03: four November sales (Rebecca, Dave, Jhon Carlo, Sherwin), all Cash, ₱95 each.

## Known quirks and fixes
- Version 12 had a bug (a function calling itself) that blanked the lists; fixed in version 13. Data was never lost.
- The page forces dark mode; `[hidden]` is also set in CSS so views switch correctly outside the host.

## How to continue
1. Open a new chat and attach `monster-sales.html` (and the snapshot if you want data restored).
2. Ask for the change you want. Keep the same db collections so existing records still show.
3. To restore data in a new publish, the records in `data-snapshot.json` must be written back into the new artifact's database.
4. After each change, reload the page and check every tab (Tracker, Statistics, Accounting, Money Manager, History, Stock).

## Ideas not done yet
- List no-buyer sales in the Daily log as "No buyer".
- Show Money Manager entries inside History, or one list across all months.
- A downloadable PC app version (an installable wrapper), and a spreadsheet export of all records.
