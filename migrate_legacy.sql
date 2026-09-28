-- ============================================================
-- Миграция всех таблиц из старой версии (public.maps) в новую
-- (public.maps_next). Выполни в Supabase → SQL Editor → Run.
--
-- Идемпотентно: при совпадении id данные берутся из старой
-- версии (старые данные побеждают конфликты).
-- Не удаляет исходную таблицу public.maps.
-- share_token не переносится (общий доступ в новой версии отключён).
-- ============================================================

insert into public.maps_next (id, owner_id, title, data, created_at, updated_at)
select id, owner_id, title, data, created_at, updated_at
from public.maps
on conflict (id) do update set
  owner_id   = excluded.owner_id,
  title      = excluded.title,
  data       = excluded.data,
  updated_at = excluded.updated_at;
