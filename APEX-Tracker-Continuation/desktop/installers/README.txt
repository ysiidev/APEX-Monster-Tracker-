APEX MONSTER SALES TRACKER — WINDOWS OFFLINE EDITION

Choose ONE installer: APEX-Monster-Setup.exe OR APEX-Monster-Setup.msi.
Do not install both versions on the same PC. Both install the same app.

REQUIREMENTS
- 64-bit Windows 10 or 11.
- Microsoft Edge WebView2 Runtime and .NET Framework 4.7.2 or later. Many Windows PCs already have them. If missing, they must be installed before the app starts; obtaining them may require internet access. WebView2: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- The installer and app are unsigned, so Windows SmartScreen may display a warning. Only install a file you trust.

INSTALL AND USE
1. Download one installer to your Windows PC, then run it. The EXE installer creates desktop and Start menu shortcuts; the MSI creates a Start menu shortcut.
2. Open Monster Sales Tracker. On first launch it initializes a local copy of the supplied 2026-11-04 snapshot, provided no existing local data file exists.
3. It saves locally and does not sync with the original published artifact. Later changes made on that page are NOT included. The app works without internet once the required runtime is present.
4. Check your opening balances and inventory against your records before relying on financial figures. The snapshot did not include starting account amounts.

BACKUPS
Use "Back up all data" in the app to export a JSON backup. Keep a copy somewhere separate from the laptop. "Restore backup" replaces the current local records after confirmation. Back up current records first.
The local database is in %LOCALAPPDATA%\ApexMonsterTracker\data.json. A previous write is retained as data.json.previous. Uninstalling the app does not intentionally delete this data folder.

The application logic was tested in a simulated browser environment, but the installers and full app have NOT been run on Windows. Test them and confirm that data persists after closing and reopening before depending on them.
