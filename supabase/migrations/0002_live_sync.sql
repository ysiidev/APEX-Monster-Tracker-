-- Live app state is separate from legacy backup/reporting tables.
create table public.tracker_live_state (
 id integer primary key check (id = 1),
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 revision bigint not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.tracker_live_state enable row level security;
create policy owner_read on public.tracker_live_state for select to authenticated
 using (lower(auth.jwt()->>'email') = 'mysidrareyes@gmail.com');
grant select on public.tracker_live_state to authenticated;
revoke insert, update, delete on public.tracker_live_state from anon, authenticated;
insert into public.tracker_live_state(id,payload)
 select 1,payload from public.snapshots order by created_at desc limit 1;
create function public.save_tracker_state(expected_revision bigint, new_payload jsonb)
returns setof public.tracker_live_state language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or lower(coalesce(auth.jwt()->>'email','')) <> 'mysidrareyes@gmail.com' then
  raise exception 'Owner access required' using errcode = '42501';
 end if;
 if jsonb_typeof(new_payload) <> 'object' or not (new_payload ?& array['sales','restocks','refmoves','money','oct_batches','settings/main','oct/config']) then
  raise exception 'Invalid tracker document';
 end if;
 return query update public.tracker_live_state set payload=new_payload, revision=revision+1, updated_at=now()
 where id=1 and revision=expected_revision returning *;
end; $$;
revoke all on function public.save_tracker_state(bigint,jsonb) from public, anon;
grant execute on function public.save_tracker_state(bigint,jsonb) to authenticated;
