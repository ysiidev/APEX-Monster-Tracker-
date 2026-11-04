# Supabase backend for the APEX Monster Sales Tracker

Cloud copy of the tracker's data, plus an archive bucket. This is a **backup and reporting
layer**, not a live sync — the Windows app still writes only to its local `data.json`.

| | |
|---|---|
| Project | `apex-monster-tracker` (ref `qbhigtwejckzvocrwaqb`) |
| Organisation | `ysiidev` |
| Region | `ap-southeast-1` (Singapore) |
| API URL | `https://qbhigtwejckzvocrwaqb.supabase.co` |
| Bucket | `monster-tracker-backups` (private, 10 MB per file) |

## What is in it

Tables mirror the app's collections 1:1, so a push or pull is a straight mapping:

| Table | From the app | Notes |
|---|---|---|
| `sales` | `sales` | `paidMethod` → `paid_method` |
| `restocks` | `restocks` | `paidFrom` → `paid_from` |
| `refmoves` | `refmoves` | |
| `money` | `money` | `to` → `to_account` |
| `oct_batches` | `oct_batches` | `order` → `ord` (reserved word) |
| `app_documents` | `settings/main`, `oct/config` | singleton docs keyed by path |
| `snapshots` | — | whole-file archives, one JSONB row per snapshot |

Views (all `security_invoker`, so they cannot be used to read around RLS):

- `v_sales_readable` — sales with Manila-local time, revenue, profit, cost
- `v_daily_log` — the app's Daily log (named buyers, oldest first)
- `v_daily_totals` — cans, revenue and profit per day
- `v_flavor_mix` — cans, revenue and profit per flavor
- `v_monthly_summary` — per month
- `v_stock_on_hand` — `on_hand` and `in_ref` per flavor, same arithmetic as the app
- `v_account_movements` / `v_account_balances` — Cash / GCash / MariBank balances

Seeded with the 2026-11-04 snapshot: 10 sales (₱950), 14 restocks, 7 refmoves, 2 October
batches, 2 documents, 1 snapshot archive.

## Security model — read this before connecting anything

- **RLS is enabled on every table with zero policies.** Anyone holding the publishable/anon
  key can read *nothing*. There is no "public personal data" gap.
- **All access goes through the secret `service_role` key**, which bypasses RLS. Keep it on
  your own machine, in `supabase/.env` (git-ignored) or an environment variable. Never ship
  it inside `app/`, never commit it.
- The bucket `monster-tracker-backups` is private and has no policies, for the same reason.
- This design assumes one operator. If you ever add sign-in, the commented policies at the
  bottom of `migrations/0001_init_tracker_schema.sql` are the starting point.
- Data is personal financial information. Supabase encrypts at rest and in transit, but the
  service role key is a full-database credential: treat it like the data file itself.

## Sync commands

`tools/supabase-sync.mjs` is dependency-free (Node 18+, uses `fetch`). Run from the repo root.
It reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the environment or `supabase/.env`.

```sh
# compare local file with the cloud (counts per table + revenue)
node tools/supabase-sync.mjs verify

# push local rows up (upsert; existing ids updated, nothing deleted)
node tools/supabase-sync.mjs push

# push and also delete cloud rows whose ids are not in the local file (destructive)
node tools/supabase-sync.mjs push --prune

# rebuild a data.json from the cloud (refuses to overwrite unless --force)
node tools/supabase-sync.mjs pull --out ~/restored-data.json

# archive the whole file to public.snapshots AND the storage bucket
node tools/supabase-sync.mjs snapshot
```

Useful flags: `--data <path>` (default `%LOCALAPPDATA%\ApexMonsterTracker\data.json`, or
`$APEX_DATA_FILE`), `--out`, `--force`, `--prune`, `--dry-run`.

`node tools/sync-selftest.mjs` round-trips a data file through the mapping functions offline
and asserts every record and total survives — no Supabase needed. Run it after changing the
mapping code.

## Reporting queries

```sql
select * from v_daily_log;                      -- what the app's Daily log shows
select * from v_daily_totals;                   -- cans / revenue / profit per day
select * from v_stock_on_hand order by flavor;  -- stock and fridge counts
select * from v_account_balances;               -- Cash / GCash / MariBank
select * from v_sales_readable where buyer = 'JV';
```

## Limits and honest caveats

- **Not a live sync.** The desktop app has no network code; changes made in the app are only
  in `data.json` until you run `push`. Changes made in the cloud do not reach the app until
  you run `pull`. Do not run both directions blindly on two diverged copies.
- `pull` writes `data.json.before-pull` next to the target as a safety copy, but treat the
  cloud as a backup, not the source of truth, until you decide which one wins.
- `push` defaults to upsert-only. `--prune` deletes cloud rows, so back up first.
- The `money` collection is still empty in the source data; Money Manager rows will sync once
  the app records them.
- Times of day for the six sales added on 2026-11-04 are reconstructed, not recorded — the
  same caveat as `CONTINUATION.md`.
- Free plan: projects pause after a period of inactivity. If queries stop working, restore the
  project in the Supabase dashboard first.
- Nothing here has been exercised against the live REST API from this environment (the
  sandbox cannot reach supabase.co). The schema, seed and views were applied and queried
  through the Supabase API; the `push`/`pull`/`snapshot` HTTP paths are unit-tested only
  through their offline mapping layer.
