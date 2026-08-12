-- ============================================================
-- KICS Feature Map — схема базы данных Supabase (v2)
-- Выполни этот файл в Supabase Dashboard → SQL Editor → Run
-- Это ПЕРЕСОЗДАНИЕ таблиц после исправления рекурсии политик
-- ============================================================

create extension if not exists pgcrypto;

-- Сначала снести старые политики (иначе drop table ругнётся из-за зависимостей)
drop policy if exists "maps_owner_all" on public.maps;
drop policy if exists "maps_shared_select" on public.maps;
drop policy if exists "maps_shared_update" on public.maps;
drop policy if exists "shares_owner_all" on public.map_shares;

-- Удаляем таблицы вместе со всеми зависимыми объектами
drop table if exists public.map_shares cascade;
drop table if exists public.maps cascade;

-- Таблица карт
create table public.maps (
  id uuid primary key default extensions.uuid_generate_v4(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Моя карта фич',
  data jsonb not null default '{"columns":[],"nodes":[],"nextId":1}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Таблица доступов: owner_id продублировано, чтобы политики не ссылались на maps
-- (иначе возникает infinite recursion в RLS)
create table public.map_shares (
  id uuid primary key default extensions.uuid_generate_v4(),
  map_id uuid not null references public.maps(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('viewer','editor')),
  created_at timestamptz not null default now(),
  unique (map_id, email)
);

create index maps_owner_idx on public.maps (owner_id);
create index shares_map_idx on public.map_shares (map_id);
create index shares_email_idx on public.map_shares (email);

-- ============================================================
-- RLS
-- ============================================================
alter table public.maps enable row level security;
alter table public.map_shares enable row level security;

-- ── maps ──
drop policy if exists "maps_owner_all" on public.maps;
drop policy if exists "maps_shared_select" on public.maps;
drop policy if exists "maps_shared_update" on public.maps;

create policy "maps_owner_all" on public.maps
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "maps_shared_select" on public.maps
  for select
  using (
    exists (
      select 1 from public.map_shares s
      where s.map_id = maps.id
        and lower(s.email) = lower(auth.jwt() ->> 'email')
    )
  );

create policy "maps_shared_update" on public.maps
  for update
  using (
    exists (
      select 1 from public.map_shares s
      where s.map_id = maps.id
        and lower(s.email) = lower(auth.jwt() ->> 'email')
        and s.role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from public.map_shares s
      where s.map_id = maps.id
        and lower(s.email) = lower(auth.jwt() ->> 'email')
        and s.role = 'editor'
    )
  );

-- ── map_shares (без подзапросов к maps — нет рекурсии) ──
drop policy if exists "shares_owner_all" on public.map_shares;
drop policy if exists "shares_self_select" on public.map_shares;

-- Владелец может читать/создавать/удалять свои доступы
create policy "shares_owner_all" on public.map_shares
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Приглашённый может видеть свою запись доступа (чтобы сработал shared-доступ к maps)
create policy "shares_self_select" on public.map_shares
  for select
  using (lower(email) = lower(auth.jwt() ->> 'email'));