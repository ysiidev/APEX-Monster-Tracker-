# Releasing

The Windows installers are built by GitHub, not on anyone's laptop. Push a `v`-tag and
[`.github/workflows/build-installers.yml`](.github/workflows/build-installers.yml) compiles the
app on a Windows runner and attaches three downloads plus checksums to the release.

## Making a release

1. Check `VERSION` at the repo root — it is the human reference for the current version.
2. Go to **Releases → Draft a new release**.
3. **Choose a tag** — type `v1.0.2` (the `v` matters; `1.0.2` or `official` will be rejected by the build).
   Pick "Create new tag on publish", target `main`.
4. Title: `APEX Monster Sales Tracker 1.0.2`. Leave the notes empty — the workflow writes them.
5. **Publish release**. The build starts; in roughly 3–4 minutes the assets appear on the page.

The version in Add/Remove Programs comes from the tag, stamped into `setup.nsi` and `setup.wxs`
during the build. The files in the repo keep saying `1.0.0` on purpose, so a local build without a
tag still works.

### If you need to re-run a build

**Actions → Build installers → Run workflow**, and enter the tag (e.g. `v1.0.2`). Use this when a
tag existed before the workflow file did, or after a failed run you have since fixed.

## What gets published

| File | What it is |
|---|---|
| `APEX-Monster-Setup.exe` | NSIS installer: Start menu and desktop shortcuts, per-user, no admin prompt |
| `APEX-Monster-Setup.msi` | WiX installer: Start menu shortcut only |
| `APEX-Monster-Portable.zip` | The app folder, no install — unzip and run |
| `SHA256SUMS.txt` | Checksums, so a download can be verified |

Install **one** of the .exe or .msi, never both. The portable zip can sit alongside either.

## Before announcing a release

The pipeline proves the installer *assembles*. It proves nothing about whether the app *runs*.
On a Windows PC:

- [ ] Install one installer; it opens without an error dialog
- [ ] **Sales history shows the expected number of sales** (10 as of this release, ₱950)
- [ ] The Daily log lists named buyers, oldest first, grouped by day
- [ ] Record a sale, close the app, reopen it — the sale is still there
- [ ] Money Manager accepts an entry; Accounting totals update
- [ ] History → **Export CSV** writes a file that opens in Excel
- [ ] **Back up all data** writes a `.json`; **Restore** reads it back
- [ ] Uninstall leaves `%LOCALAPPDATA%\ApexMonsterTracker\data.json` in place
- [ ] Version in **Settings → Apps** matches the tag

If any of those fail, delete the release rather than leave it up.

## Known limits of this pipeline

- The binaries are **unsigned**, so SmartScreen warns on every download. Removing that needs a code
  signing certificate (paid, and identity-verified) — not something a workflow can fix.
- Upgrades are untested: the MSI keeps the same `UpgradeCode`, so a v1.0.2 MSI over v1.0.1 should
  replace it, but nobody has tried. Installing v1.0.2 over v1.0.1 and then uninstalling is worth
  one test on Windows.
- The MSI has no `<Upgrade>` element, so an old and a new MSI can both appear in Add/Remove
  Programs. Fine for now; fix before a wide release.
- Installing both the NSIS and MSI installers at once is not supported.

## Troubleshooting a red run

| Failing step | Usual cause | Fix |
|---|---|---|
| Work out the version | Tag not shaped like `v1.2.3` | Delete the release, recreate with a proper tag |
| Check the workflow file is not empty | The file was committed blank | Re-paste the workflow, commit |
| Compile the tracker | C# error | Read the compiler line; fix `Program.cs` |
| Build the EXE installer | NSIS missing or `output\` absent | Usually resolves itself; check the choco step |
| Build the MSI | `$env:WIX` unset | The step searches `C:\Program Files (x86)\WiX Toolset v3*` as a fallback |
| Attach everything to the release | Token is read-only | Settings → Actions → General → Workflow permissions → **Read and write** |
