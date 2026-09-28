-- ============================================================
-- KICS — таблица для хранения API-ключей ИИ (режим «прокси»)
-- Выполни в Supabase → SQL Editor → Run.
-- Не пересоздаёт таблицы и не удаляет данные.
-- ============================================================

create table if not exists public.ai_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  api_key text not null,
  model text,
  base_url text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.ai_credentials enable row level security;

drop policy if exists ai_credentials_owner on public.ai_credentials;
create policy ai_credentials_owner on public.ai_credentials for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.ai_credentials to authenticated;

-- ВАЖНО (безопасность): ключ хранится открытым текстом и защищён только RLS.
-- Для продакшена используй Supabase Vault (select vault.create_secret(...))
-- и читай ключ через service_role в edge-функции ai-proxy.
