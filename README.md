# APEX Monster Sales Tracker

Sales, stock and money tracker for a Monster Energy resale run out of APEX Sports Center
(Philippines). Started life as a single self-contained Claude artifact, was wrapped into an
offline Windows desktop app, and now has a Supabase backend for backup and reporting.

> **Status: not released.** The Windows installers and the desktop app have **never been run on
> Windows**. The browser layer is tested; WebView2 startup, native dialogs, installation and
> persistence on Windows are not. See [`CONTINUATION.md`](CONTINUATION.md) for the full handoff.

## What it does

Six views, hash-routed, dark Monster theme:

| View | What it holds |
|---|---|
| **Tracker** | Record a sale (buyer, flavor, qty, price, Cash/GCash/MariBank/Debt, paid); edit, delete; range tabs; prices and flavors; **Daily log** of named buyers grouped by day |
| **Statistics** | Daily / weekly / monthly cans, revenue and profit; flavor mix |
| **Accounting** | Money on hand per account, October capital and profit, starting amounts |
| **Money Manager** | Income, expense and transfer entries with category and account; auto rows for sales and restocks |
| **History** | Full sales list, edit/delete, CSV export |
| **Stock & Inventory** | In ref (fridge) and on hand lists, move to ref, restocks and adjustments, history |

Prices default to **₱95 per can, ₱54.17 cost**. Six flavors, from Original Green to Pipeline Punch.

## Repository layout

```
APEX-Tracker-Continuation/
├── CONTINUATION.md            handoff notes: state, architecture, caveats, next steps
├── original/                  the untouched artifact: monster-sales.html + data snapshot
└── desktop/                   the Windows port
    ├── Program.cs             C# WinForms + WebView2 host, local data + backup/restore
    ├── app/index.html         the app itself (markup, CSS, JS in one file)
    ├── app/bridge.js          emulates the artifact db/downloads APIs over postMessage
    ├── app/snapshot.json      seed data, used only when no local data.json exists
    ├── installers/            NSIS .exe and WiX .msi — pick one, not both
    ├── tests/                 jsdom smoke tests
    └── preview/               browser harness (not shipped): static server + checks
supabase/                      cloud schema, security model and sync docs
tools/                         two-way sync between data.json and Supabase
```

## Try it without Windows

The UI is plain HTML/JS, so it runs in any browser:

```sh
cd APEX-Tracker-Continuation/desktop
npm install                    # jsdom, only needed for the checks
node preview/server.js         # http://localhost:8080/ opens on the Tracker view
```

`preview/server.js` is a dependency-free static server. It injects `app/snapshot.json` as the
seed (the page's CSP blocks `fetch`), and `bridge.js` falls back to `localStorage` when WebView2
isn't there. Add `?reset=1` to wipe the preview data and reload the seed. Nothing on disk in
`app/` is modified, and `preview/` is never packaged by either installer.

## Tests

```sh
cd APEX-Tracker-Continuation/desktop
TZ=Asia/Manila node tests/test.js            # load, six views, record a sale, backup
TZ=Asia/Manila node tests/test-more.js       # restock, money entry, restart, restore
TZ=Asia/Manila node tests/test-dailylog.js   # Daily log: every named sale once, oldest first
node preview/check.js                        # preview server renders the same log
node preview/check-backup.js                 # Back up / Restore rolls back exactly
cd ../.. && node tools/sync-selftest.mjs     # Supabase mapping round-trips a data file
powershell -ExecutionPolicy Bypass -File tools/test/run-sync-test.ps1   # PowerShell sync, against a mock server
```

All of the above pass as of 2026-11-04. They exercise the HTML/JS/Node code, **not** the Windows
build: no test here proves WebView2 startup, native file dialogs, the installers or MSI shortcuts.

## Data

`%LOCALAPPDATA%\ApexMonsterTracker\data.json` holds everything; writes are atomic
(`.tmp` → `File.Replace`) and keep one `.previous` generation. Collections:

| Collection | Fields |
|---|---|
| `sales` | buyer, flavor, qty, price, cost, method, paid, paidMethod, ts |
| `restocks` | flavor, qty, cost, expense, paidFrom, type (`restock`/`adjust`), ts |
| `refmoves` | flavor, qty, type (`move`/`adjust`), ts |
| `money` | type, amount, category, account, to, note, ts |
| `oct_batches` | label, order, capital, shipping, items |
| `settings/main`, `oct/config` | price, cost, flavors, starting amounts; October figures |

Rules the code follows:

- **Stock on hand** = all restock rows (including adjust) − all sales
- **In ref** = all refmove rows (including adjust) − all sales
- **Account balance** = starting amounts + paid sales (Debt uses `paidMethod`) − restock spend
  by `paidFrom` ± Money Manager entries

Current snapshot: **10 sales, ₱950**, 14 restocks, 7 fridge moves, 2 October batches, no Money
Manager entries yet.

## Supabase backend

A cloud mirror plus a private archive bucket, with `push`/`pull`/`snapshot`/`verify` tooling.
It is a **backup and reporting layer, not live sync** — the app still writes only locally.

On a Windows PC with nothing installed — PowerShell only:

```powershell
powershell -ExecutionPolicy Bypass -File tools\sync-to-supabase.ps1 -SetKey   # once
powershell -ExecutionPolicy Bypass -File tools\sync-to-supabase.ps1 -Verify   # compare, write nothing
powershell -ExecutionPolicy Bypass -File tools\sync-to-supabase.ps1           # push
powershell -ExecutionPolicy Bypass -File tools\install-sync-task.ps1          # run it daily, by itself
```

See [`supabase/SYNC-SETUP.md`](supabase/SYNC-SETUP.md). Or with Node installed:

```sh
node tools/supabase-sync.mjs verify    # local vs cloud counts and revenue
node tools/supabase-sync.mjs push      # upsert local rows into the cloud
node tools/supabase-sync.mjs pull --out ~/restored.json
```

RLS is enabled on every table with **no policies**: the publishable key reads nothing, and all
access needs the secret `service_role` key, kept in `supabase/.env` (git-ignored). Full detail,
including the security model and the honest caveats: [`supabase/README.md`](supabase/README.md).

## Windows build

Requires 64-bit Windows, Microsoft Edge **WebView2 Runtime** and **.NET Framework 4.7.2+**.
Neither runtime is bundled and both binaries are unsigned, so SmartScreen will warn.

**Installers are built by GitHub, not by hand.** Push a `v`-tag and
[`build-installers.yml`](.github/workflows/build-installers.yml) compiles the app on a Windows
runner, stamps the version from the tag, and attaches `APEX-Monster-Setup.exe`,
`APEX-Monster-Setup.msi`, `APEX-Monster-Portable.zip` and `SHA256SUMS.txt` to the release. The full
process, the pre-release test checklist and the troubleshooting table are in
[`RELEASE.md`](RELEASE.md).

Rebuilding locally instead (this is the toolchain the original package was built with):

```sh
cd APEX-Tracker-Continuation/desktop
mkdir -p output
mcs -target:winexe -out:'app/Monster Sales Tracker.exe' \
  -r:System.Windows.Forms -r:System.Drawing -r:System.Web.Extensions \
  -r:app/Microsoft.Web.WebView2.Core.dll \
  -r:app/Microsoft.Web.WebView2.WinForms.dll Program.cs
makensis setup.nsi          # -> output/APEX-Monster-Setup.exe
wixl -o output/APEX-Monster-Setup.msi setup.wxs
```

Installing both the EXE and the MSI side by side is not supported — choose one. Uninstalling
does not delete `%LOCALAPPDATA%\ApexMonsterTracker`; use **Back up all data** before relying on
that folder alone.

## Releases

Latest: see the **Releases** page. The pipeline is tag-driven and the version in Add/Remove Programs
comes from the tag, so `v1.0.2` produces a build that reports 1.0.2 everywhere.

```sh
git tag v1.0.2 && git push origin v1.0.2     # or draft a release in the GitHub UI
```

## Known issues

- **Windows packaging and runtime are unverified** — the top priority before calling this ready.
- **Backup validation is shallow.** A restored file only has to contain the five collections,
  unique string ids and the two documents. Wrong field *types* pass: a backup with
  `qty: "abc"` restores silently and the Statistics view then reads `0 cans · ₱0`, with no error.
- Six sales added on 2026-11-04 have **reconstructed times of day** — the source list gave dates
  only. Amounts, buyers, flavors and methods are as recorded.
- Starting account balances are absent from the snapshot, so Accounting figures are unverified
  as a true cash balance.
- October's ₱1,365 is cash left after buying stock and shipping, **not** profit on cans sold; the
  October case counts in the older notes (20 per batch) disagree with the data (10 per batch).
- `money` is empty, so Money Manager and the cloud mirror have no income/expense history yet.

## Documentation

- [`CONTINUATION.md`](CONTINUATION.md) — state of play, architecture, validation done and next steps
- [`APEX-Tracker-Continuation/CONTINUATION.md`](APEX-Tracker-Continuation/CONTINUATION.md) — desktop-specific notes
- [`APEX-Tracker-Continuation/original/CONTINUATION.md`](APEX-Tracker-Continuation/original/CONTINUATION.md) — original artifact notes, schema and business rules
- [`supabase/README.md`](supabase/README.md) — cloud schema, security model, sync commands
- [`APEX-Tracker-Continuation/desktop/installers/README.txt`](APEX-Tracker-Continuation/desktop/installers/README.txt) — end-user install guide
