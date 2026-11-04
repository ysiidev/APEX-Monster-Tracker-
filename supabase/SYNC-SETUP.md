# Automatic sync to Supabase — setup

Your app stays offline. This makes a **separate** small script copy the app's data to Supabase
on its own, so you stop having to remember anything. If the sync ever fails, the app and your
local data are unaffected.

No software to install: everything below uses PowerShell, which is already on every Windows PC.

**The rule, stated plainly: this PC always wins.** Sync overwrites the cloud copy with whatever is
in your local file. Rows are never deleted unless you pass `-Prune`. So don't edit numbers directly
in Supabase — they'll be overwritten.

---

## Step 1 — Get your secret key

1. Open https://supabase.com/dashboard and sign in.
2. Open the project **apex-monster-tracker**.
3. **Project Settings** (gear, bottom left) → **API keys**.
4. Copy the key labelled **secret** (older projects call it **service_role**).
   It starts with `sb_secret_` or `eyJ`. **Not** the publishable/anon key — that one cannot write.

Treat this key like a password: it can read and change all your data.

## Step 2 — Store it once, encrypted

Open **PowerShell** (press Start, type `powershell`, Enter), then run — replacing the path with
wherever this repo lives on your PC:

```powershell
cd "$env:USERPROFILE\APEX-Monster-Tracker"
powershell -ExecutionPolicy Bypass -File tools\sync-to-supabase.ps1 -SetKey
```

Paste the key when asked (nothing shows as you paste — that's normal), press Enter.

It is saved **encrypted with Windows DPAPI**, readable only by your Windows user on this PC:

```
%LOCALAPPDATA%\ApexMonsterTracker\supabase.key
```

Copy that file to another computer and it is useless. The key is never written to the repo.

## Step 3 — Compare before you change anything

```powershell
powershell -ExecutionPolicy Bypass -File tools\sync-to-supabase.ps1 -Verify
```

This writes nothing. You should see your counts side by side:

```
  sales          local   10   cloud   10   ok
  restocks       local   14   cloud   14   ok
  revenue        local   950.00   cloud   950.00   ok
```

If it says `DIFFERS`, that's expected once you've used the app — the cloud is behind. Step 4 fixes it.

## Step 4 — Push once by hand

```powershell
powershell -ExecutionPolicy Bypass -File tools\sync-to-supabase.ps1
```

It pushes, then re-checks the cloud matches, and stops with an error if they disagree. On success
you get `Sync complete.`

## Step 5 — Let it run by itself

```powershell
powershell -ExecutionPolicy Bypass -File tools\install-sync-task.ps1
```

This registers a Windows scheduled task that runs silently **when you log on** and **every day at
21:00**. Pick a different time with `-Time "22:30"`.

Test it immediately instead of waiting:

```powershell
Start-ScheduledTask -TaskName "APEX Monster Tracker Sync"
```

## Step 6 — Check it worked

```powershell
notepad "$env:LOCALAPPDATA\ApexMonsterTracker\sync.log"
```

Every run writes a line like:

```
2026-11-04 21:00:04  INFO   Pushing C:\Users\you\AppData\Local\ApexMonsterTracker\data.json to https://...
2026-11-04 21:00:06  INFO   Pushed: sales=10 restocks=14 refmoves=7 money=0 oct_batches=2 app_documents=2
2026-11-04 21:00:07  INFO   Sync complete.
```

You can also confirm in the Supabase dashboard: **Table Editor → sales** should show the same rows.

---

## Changing or removing it

| Want to | Do this |
|---|---|
| Change the time | Re-run `install-sync-task.ps1 -Time "07:30"` — it replaces the old task |
| Turn automatic sync off | `install-sync-task.ps1 -Remove` |
| Replace the key (e.g. rotated it) | Run `-SetKey` again |
| Stop the cloud copy entirely | Remove the task, then delete rows in Supabase if you want them gone |

Removing the task never touches the app, `data.json`, or the cloud copy.

---

## What it will and won't do

- ✅ Keeps the cloud copy current — at most a day behind, usually minutes after you log on
- ✅ Skips the network entirely when nothing has changed
- ✅ Keeps working if you're offline; the next run catches up
- ✅ Writes a log every time, so silence means "nothing to do", not "broken"
- ❌ Does not bring cloud changes back down — restoring stays manual (`tools/supabase-sync.mjs pull`, needs Node)
- ❌ Does not run while the PC is off or asleep; `-StartWhenAvailable` catches up at next boot
- ❌ Does not protect against a mistake in the app: the cloud copy copies whatever is local

---

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| `No key stored yet` | Step 2 not done, or done as a different Windows user | Run `-SetKey` as the same user that runs the task |
| `Could not decrypt the stored key` | The key file came from another PC or user | Run `-SetKey` again on this PC |
| `Supabase rejected POST ... 401` | Wrong key, or the publishable key was pasted | Re-run `-SetKey` with the **secret** key |
| `Supabase rejected ... 403 / row-level security` | Same — publishable key cannot write | Same fix |
| `Supabase rejected ... 400` and mentions `check constraint` | A value the database rejects, e.g. `method` must be Cash/GCash/MariBank/Debt | Look at the log line naming the table; fix that record in the app |
| `Could not register the task` | Task Scheduler refused | Run the same command as your own user, not as administrator |
| Log shows nothing at 21:00 | PC asleep, or the task was replaced | Check `Get-ScheduledTask -TaskName "APEX Monster Tracker Sync"` |
| `Data unchanged ... nothing to do` | Working as intended | Nothing to fix |

---

## Honest status of this feature

The PowerShell scripts were written and reviewed on Linux, where PowerShell cannot be run.
Their structure (bracket balance, PS 5.1-only syntax, no PowerShell-7 features) was checked
mechanically, and the HTTP calls mirror `tools/supabase-sync.mjs`, which is tested against the
same Supabase schema. **They have not been executed.** Run `-Verify` first: it only reads, and it
is the safest way to find out whether the connection works before you let anything write.
