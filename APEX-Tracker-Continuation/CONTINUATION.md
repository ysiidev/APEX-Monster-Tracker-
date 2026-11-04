# APEX Monster Sales Tracker — continuation notes

Last updated: 2026-11-04

## Current state

The original artifact-based Monster Energy sales tracker has been adapted into a 64-bit Windows desktop application intended to work offline. Both an EXE installer and an MSI installer have been created. **The Windows installers and complete desktop app have not been run or verified on Windows.** The app's browser-side logic was exercised in a simulated environment; Windows testing is the most important next step.

The offline app is a separate copy, not a live connection to the original published artifact. It initializes from the supplied November 4, 2026 JSON snapshot only when no local data file exists. Changes made later to either copy do not synchronize with the other. Do not replace an existing data file with the snapshot without the user's informed consent.

## Files in this package

- `original/monster-sales.html` — the original artifact HTML, unchanged; it expects the artifact host's `claude.use("db")` and `claude.use("downloads")` capabilities.
- `original/data-snapshot.json` — original November 4 snapshot.
- `original/CONTINUATION.md` — earlier notes about the app, collections, business rules, and possible improvements.
- `desktop/installers/APEX-Monster-Setup.exe` — NSIS per-user installer; creates Start menu and desktop shortcuts.
- `desktop/installers/APEX-Monster-Setup.msi` — WiX/wixl MSI installer; creates a Start menu shortcut. Choose one installer, not both.
- `desktop/installers/README.txt` — user-facing installation, requirements, and backup instructions.
- `desktop/app/` — desktop application's HTML, JavaScript bridge, snapshot, compiled application executable, and the required WebView2 DLLs.
- `desktop/Program.cs` — C# WinForms host and local data/backup implementation.
- `desktop/setup.nsi` and `desktop/setup.wxs` — installer definitions.
- `desktop/tests/` — JavaScript simulated-browser smoke tests.
- `desktop/third-party/` — license and notice shipped with the Microsoft WebView2 package.

## Desktop architecture

- WinForms hosts the application using Microsoft Edge WebView2. Bundled assemblies and native x64 loader came from `Microsoft.Web.WebView2` NuGet package **1.0.2903.40**, net462 assemblies and win-x64 loader.
- Requires 64-bit Windows, Microsoft Edge WebView2 Runtime, and .NET Framework 4.7.2 or later. The runtime is not bundled. App operation is offline after prerequisites are available.
- `app/index.html` adapts the original HTML: it removes the network font stylesheet, adds backup/restore controls, a content security policy, and loads `bridge.js`. The UI falls back to installed system fonts.
- `app/bridge.js` emulates the limited artifact database/download APIs the original app uses. It sends messages to the host, serializes mutations, then refreshes snapshot listeners. It implements the collections/documents and operations used by this version, not a general-purpose database SDK.
- `Program.cs` stores the whole snapshot-like JSON locally, validates collections and document shape, writes a temporary file and replaces the current file while retaining `data.json.previous`, and shows backup, restore and CSV save dialogs. A per-user mutex prevents two application instances from writing simultaneously.
- Data location: `%LOCALAPPDATA%\ApexMonsterTracker\data.json`; browser profile is in the same directory under `Browser`. Uninstall does not intentionally delete the data folder. Use the app's **Back up all data** control to keep a separate copy. Restore replaces current records after confirmation; back up first.
- Local data is not encrypted and is per Windows user. The `.previous` file is only the previous write, not a substitute for independent backups. Backups can contain names and financial information.
- Installers and executable are unsigned. Windows SmartScreen may display a warning.

## Data and business caveats

The snapshot now holds ten November sales — nine Cash and one GCash, ₱950 total — after the amendment described below, plus estimated October sales. It does not include starting account balances; verify these and the inventory before using the accounting figures. October case quantities in the earlier notes conflict with the JSON: each batch lists 10 cases, not 20. October's ₱1,365 figure subtracts the full cost of purchased stock and shipping, and is not necessarily profit on cans sold. See the original continuation notes for all collection fields and rules.

## Snapshot amendment (2026-11-04)

The exported snapshot held only four sales, all dated Nov 1–Nov 3, although it was labelled `taken: 2026-11-04`. Six recorded sales were missing from the export and have been added to **both** `original/data-snapshot.json` and `desktop/app/snapshot.json` (the two files are kept byte-identical):

| Day | Buyer | Flavor | Method | Time (PHT, reconstructed) |
|---|---|---|---|---|
| Nov 3 | Lou | Ultra White (White) | Cash | 15:41 |
| Nov 3 | Jester | Original Green (Black) | Cash | 17:52 |
| Nov 4 | Rebecca | Ultra Paradise (Green) | Cash | 09:12 |
| Nov 4 | Ash | Ultra Violet (Purple) | GCash | 11:35 |
| Nov 4 | JV | Original Green (Black) | Cash | 16:48 |
| Nov 4 | JV | Ultra White (White) | Cash | 16:52 |

Each added row uses `qty: 1`, `price: 95`, `cost: 54.17`, `paid: true`, and a synthetic 20-character `id` in the original style. **The times of day are invented** — the source list gave dates only — and they only affect ordering inside the Daily log and the date bucketing, not any total. Amounts, flavors, methods and buyers come from the supplied list. Existing records were not altered or removed.

Consequences worth knowing: November revenue is now ₱950 rather than ₱380, stock on hand drops by six cans, and the GCash balance rises by ₱95 (Ash). Because these are inserted into the snapshot, they seed a *fresh* install only; an existing `data.json` on a Windows machine is untouched and must not be replaced with this snapshot without the user's informed consent (see *Current state*).

## Validation completed

Using jsdom and a mocked WebView message host, tests checked that the snapshot loaded, the six app views appeared, a sale and restock could be entered, a money entry could be entered, a mocked backup and restore worked, and changed data persisted across a simulated browser restart. `tests/test-dailylog.js` additionally asserts that the Daily log renders every named-buyer sale exactly once, in ascending day groups, oldest first, and that rows under each day heading match the snapshot for that day. The three tests now derive record counts from the snapshot instead of asserting fixed numbers, so they keep working as data is added. All three passed on 2026-11-04 after the amendment. The resulting Windows PE and MSI installer formats were inspected on Linux. **This does not validate native WebView2 startup, dialogs, installation/uninstallation, data persistence on Windows, runtime prerequisites, MSI shortcuts, or all app workflows.**

## Priority next steps

1. On a 64-bit Windows PC with WebView2 Runtime and .NET Framework installed, test one installer and confirm the app opens with the original snapshot. Test in a disposable Windows profile or back up the real data first.
2. Verify all six views, dates, sales/add/edit/delete, debt payments, stock moves and adjustments, restocks, accounting, Money Manager, CSV export, settings, backup/restore, and closing/reopening the app. Test failures and ensure records are not lost.
3. Test each installer separately, including shortcuts and uninstall; uninstall should preserve user data. Check how Windows handles the unsigned files. Avoid installing both variants simultaneously.
4. Verify how starting balances and the October figures should be represented with the user. Consider clearer language for October cash vs. profit and add robust backup/import validation.
5. For distribution, consider code signing, prerequisite detection/installation, automatic backup strategy, and an upgrade path before claiming production readiness.

## Rebuilding on Linux

These commands describe the environment used for this package. From the `desktop` directory, install Mono's C# compiler and WinForms/System.Web.Extensions dependencies, NSIS (`makensis`), and `wixl`/msitools. The needed WebView2 DLLs are already under `app/`.

```sh
mkdir -p output
mcs -target:winexe -out:'app/Monster Sales Tracker.exe' \
  -r:System.Windows.Forms -r:System.Drawing -r:System.Web.Extensions \
  -r:app/Microsoft.Web.WebView2.Core.dll \
  -r:app/Microsoft.Web.WebView2.WinForms.dll Program.cs
makensis setup.nsi
wixl -o output/APEX-Monster-Setup.msi setup.wxs
```

The installer scripts write to `output/`, not the included `installers/` folder. Builds are unsigned. The MSI authoring is basic; validate installer upgrade behavior before releasing future versions. Do not assume that rebuilding alone proves Windows compatibility.

For the simulated JavaScript tests, install Node.js and `jsdom@24` in `desktop/` (`npm install` reads the included `package.json`), then run `node tests/test.js`, `node tests/test-more.js` and `node tests/test-dailylog.js` from `desktop/`. Run the daily-log test with `TZ=Asia/Manila` so calendar-day grouping matches the user's locale. These tests mock the native host and are not Windows integration tests.
