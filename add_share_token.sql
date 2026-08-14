-- ============================================================
-- Добавление поля share_token для шаринга по ссылке
-- Выполни в Supabase → SQL Editor → Run
-- Это НЕ пересоздаёт таблицы и НЕ удаляет данные
-- ============================================================

alter table public.maps
  add column if not exists share_token text;

-- Индекс для быстрого поиска по токену
create index if not exists maps_share_token_idx on public.maps (share_token);

-- Политика: любой может читать таблицу по публичному токену
drop policy if exists "maps_shared_token_select" on public.maps;
create policy "maps_shared_token_select" on public.maps
  for select
  using (share_token is not null);