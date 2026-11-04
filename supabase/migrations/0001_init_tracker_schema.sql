-- APEX Monster Sales Tracker — cloud schema mirrored from the desktop app's local JSON.
-- Applied to project qbhigtwejckzvocrwaqb (apex-monster-tracker, ap-southeast-1) on 2026-11-04.
-- Idempotent: safe to re-run on an existing project.
--
-- Collections mirror data.json keys 1:1 so push/pull via tools/supabase-sync.mjs is a
-- straight mapping. Column names only change where SQL forces it:
--   oct_batches.order  -> ord          (ORDER is reserved)
--   money.to           -> to_account   ("to" is awkward to quote everywhere)

create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ---------- collections ----------

create table if not exists public.sales (
  id          text primary key,
  buyer       text,
  flavor      text not null,
  qty         integer not null default 1 check (qty > 0),
  price       numeric(10,2) not null default 95 check (price >= 0),
  cost        numeric(10,2) not null default 54.17 check (cost >= 0),
  method      text not null default 'Cash' check (method in ('Cash','GCash','MariBank','Debt')),
  paid        boolean not null default true,
  paid_method text check (paid_method is null or paid_method in ('Cash','GCash','MariBank')),
  ts          bigint not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.sales is 'One row per can (or group of cans) sold. ts is epoch ms, as stored by the app.';
comment on column public.sales.paid_method is 'Settlement account once a Debt sale is paid.';

create table if not exists public.restocks (
  id        text primary key,
  flavor    text not null,
  qty       integer not null,
  cost      numeric(10,2) not null default 54.17 check (cost >= 0),
  expense   numeric(10,2) not null default 0 check (expense >= 0),
  paid_from text check (paid_from is null or paid_from in ('Cash','GCash','MariBank')),
  type      text not null default 'restock' check (type in ('restock','adjust')),
  ts        bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restock_qty_sign check (type = 'adjust' or qty > 0)
);
comment on table public.restocks is 'Stock coming in, plus adjust rows used to correct the count (qty may be negative, expense is 0).';

create table if not exists public.refmoves (
  id     text primary key,
  flavor text not null,
  qty    integer not null,
  type   text not null default 'move' check (type in ('move','adjust')),
  ts     bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.refmoves is 'Cans moved into the fridge (ref), plus adjust rows. Ref stock = sum(refmoves) - cans sold.';

create table if not exists public.money (
  id         text primary key,
  type       text not null check (type in ('income','expense','transfer')),
  amount     numeric(10,2) not null check (amount >= 0),
  category   text,
  account    text not null check (account in ('Cash','GCash','MariBank')),
  to_account text check (to_account is null or to_account in ('Cash','GCash','MariBank')),
  note       text,
  ts         bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transfer_needs_target check (type <> 'transfer' or (to_account is not null and to_account <> account))
);
comment on table public.money is 'Money Manager entries. The app calls the target column "to"; it is to_account here because "to" is awkward in SQL.';

create table if not exists public.oct_batches (
  id       text primary key,
  label    text not null,
  ord      integer not null default 1,
  capital  numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  items    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.oct_batches is 'October capital purchases. The app calls the sort field "order", renamed ord because ORDER is reserved.';

create table if not exists public.app_documents (
  path       text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
comment on table public.app_documents is 'Singleton documents keyed by the app path, e.g. settings/main and oct/config.';

create table if not exists public.snapshots (
  id         uuid primary key default gen_random_uuid(),
  taken      date not null default current_date,
  source     text not null default 'desktop',
  note       text,
  sales_count integer,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
comment on table public.snapshots is 'Whole-file copies of the app data, so a bad edit can be traced or rolled back.';

-- ---------- indexes ----------
create index if not exists sales_ts_idx        on public.sales (ts desc);
create index if not exists sales_buyer_idx     on public.sales (buyer) where buyer is not null;
create index if not exists sales_flavor_idx    on public.sales (flavor);
create index if not exists restocks_ts_idx     on public.restocks (ts desc);
create index if not exists restocks_flavor_idx on public.restocks (flavor);
create index if not exists refmoves_ts_idx     on public.refmoves (ts desc);
create index if not exists money_ts_idx        on public.money (ts desc);
create index if not exists snapshots_taken_idx on public.snapshots (taken desc);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['sales','restocks','refmoves','money','oct_batches','app_documents'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------- row level security ----------
-- RLS is on with NO policies for anon/authenticated: the public (publishable/anon) key can
-- read nothing. Server-side tooling uses the secret service_role key, which bypasses RLS.
-- If you later add sign-in, see the commented policy at the bottom.
alter table public.sales          enable row level security;
alter table public.restocks       enable row level security;
alter table public.refmoves       enable row level security;
alter table public.money          enable row level security;
alter table public.oct_batches    enable row level security;
alter table public.app_documents   enable row level security;
alter table public.snapshots       enable row level security;

-- ---------- views ----------
-- security_invoker so a view cannot be used to read around RLS.

create or replace view public.v_sales_readable with (security_invoker = true) as
select s.id, s.buyer, s.flavor, s.qty, s.price, s.cost, s.method, s.paid, s.paid_method, s.ts,
       to_char(to_timestamp(s.ts / 1000.0) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as at_manila,
       to_timestamp(s.ts / 1000.0) at time zone 'Asia/Manila' as at_manila_ts,
       s.qty * s.price            as revenue,
       s.qty * (s.price - s.cost) as profit,
       s.qty * s.cost             as cost_total
from public.sales s;
comment on view public.v_sales_readable is 'Sales with Manila-local timestamps, revenue and profit worked out.';

create or replace view public.v_daily_log with (security_invoker = true) as
select to_timestamp(s.ts / 1000.0) at time zone 'Asia/Manila' as at_manila_ts,
       s.buyer, s.flavor, s.qty, s.price, s.method, s.paid, s.ts, s.id
from public.sales s
where nullif(btrim(coalesce(s.buyer,'')), '') is not null
order by s.ts;
comment on view public.v_daily_log is 'The Daily log: named buyers only, oldest first (same rule as the app).';

create or replace view public.v_daily_totals with (security_invoker = true) as
select (to_timestamp(s.ts / 1000.0) at time zone 'Asia/Manila')::date as day,
       count(*) as rows, sum(s.qty) as cans,
       sum(s.qty * s.price) as revenue,
       sum(s.qty * (s.price - s.cost)) as profit
from public.sales s
group by 1 order by 1;

create or replace view public.v_flavor_mix with (security_invoker = true) as
select s.flavor, sum(s.qty) as cans, sum(s.qty * s.price) as revenue,
       sum(s.qty * (s.price - s.cost)) as profit
from public.sales s group by 1 order by cans desc;

create or replace view public.v_monthly_summary with (security_invoker = true) as
select date_trunc('month', to_timestamp(s.ts / 1000.0) at time zone 'Asia/Manila')::date as month,
       sum(s.qty) as cans, sum(s.qty * s.price) as revenue,
       sum(s.qty * (s.price - s.cost)) as profit
from public.sales s group by 1 order by 1;

-- stock rules copied from the app:
--   on hand = all restock rows (including adjust) - all sales
--   in ref  = all refmove rows (including adjust) - all sales
create or replace view public.v_stock_on_hand with (security_invoker = true) as
with flavors as (
  select flavor from public.restocks union select flavor from public.refmoves union select flavor from public.sales
), restocked as (
  select flavor, sum(qty) qty from public.restocks group by 1
), sold as (
  select flavor, sum(qty) qty from public.sales group by 1
), in_ref as (
  select flavor, sum(qty) qty from public.refmoves group by 1
)
select f.flavor,
       coalesce(r.qty, 0) as restocked,
       coalesce(s.qty, 0) as sold,
       coalesce(r.qty, 0) - coalesce(s.qty, 0) as on_hand,
       coalesce(i.qty, 0) as moved_to_ref,
       coalesce(i.qty, 0) - coalesce(s.qty, 0) as in_ref
from flavors f
left join restocked r on r.flavor = f.flavor
left join sold s      on s.flavor = f.flavor
left join in_ref i    on i.flavor = f.flavor
order by f.flavor;
comment on view public.v_stock_on_hand is 'Overall stock and fridge stock per flavor, using the same arithmetic as the app.';

create or replace view public.v_account_movements with (security_invoker = true) as
select account, kind, amount, ts, ref from (
  select v.account, 'starting'::text as kind, v.amount, null::bigint as ts, 'settings/main'::text as ref
  from public.app_documents d
  cross join lateral (values
    ('Cash',     coalesce((d.data->'open'->>'cash')::numeric, 0)),
    ('GCash',    coalesce((d.data->'open'->>'gcash')::numeric, 0)),
    ('MariBank', coalesce((d.data->'open'->>'maribank')::numeric, 0))
  ) v(account, amount)
  where d.path = 'settings/main'
  union all
  select coalesce(nullif(case when method = 'Debt' then paid_method else method end, ''), 'Cash'),
         'sale', qty * price, ts, id
  from public.sales where paid
  union all
  select coalesce(paid_from, 'Cash'), 'restock', -expense, ts, id
  from public.restocks where type <> 'adjust' and expense > 0
  union all
  select account, type, case when type = 'transfer' then -amount else amount end, ts, id
  from public.money where type in ('income','transfer')
  union all
  select account, type, -amount, ts, id
  from public.money where type = 'expense'
  union all
  select to_account, 'transfer_in', amount, ts, id
  from public.money where type = 'transfer' and to_account is not null
) m;

create or replace view public.v_account_balances with (security_invoker = true) as
select account, sum(amount) as balance from public.v_account_movements group by account order by account;
comment on view public.v_account_balances is 'Cash / GCash / MariBank balances: starting amounts + paid sales - restock spend +/- Money Manager entries.';

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('monster-tracker-backups', 'monster-tracker-backups', false, 10485760,
        array['application/json','text/csv','application/zip'])
on conflict (id) do nothing;

-- no policies on storage.objects: the bucket is private and only reachable with the secret key.

-- ---------- optional: policies for a signed-in single user ----------
-- create policy "owner reads"  on public.sales for select to authenticated using (true);
-- create policy "owner writes" on public.sales for all    to authenticated using (true) with check (true);
