-- Run separately in Supabase SQL Editor. Does not modify legacy maps.
create table if not exists public.maps_next (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  data jsonb not null default '{}',
  share_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.maps_next enable row level security;
drop policy if exists next_owner on public.maps_next;
create policy next_owner on public.maps_next for all to authenticated
using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
grant select, insert, update, delete on public.maps_next to authenticated;