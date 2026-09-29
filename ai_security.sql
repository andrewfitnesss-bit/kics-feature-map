-- Run after ai_schema.sql. Transactional migration; do not reapply old schema afterwards.
begin;
create extension if not exists supabase_vault with schema vault;
create table if not exists public.ai_secret_refs (
 user_id uuid references auth.users(id) on delete cascade,
 provider text not null, secret_id uuid not null, primary key(user_id, provider)
);
alter table public.ai_secret_refs enable row level security;
revoke all on public.ai_secret_refs from anon, authenticated;

create or replace function public.save_ai_credential(p_provider text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid; uid uuid := auth.uid();
begin
 if uid is null or p_provider not in ('openai','anthropic','deepseek','openrouter','custom') or length(p_key) not between 10 and 4096 then raise exception 'Invalid credential'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text || p_provider, 0));
 select secret_id into sid from public.ai_secret_refs where user_id=uid and provider=p_provider;
 if sid is null then
   sid := vault.create_secret(p_key);
   insert into public.ai_secret_refs values(uid,p_provider,sid);
 else perform vault.update_secret(sid,p_key); end if;
end $$;
revoke all on function public.save_ai_credential(text,text) from public, anon;
grant execute on function public.save_ai_credential(text,text) to authenticated;

create or replace function public.read_ai_credential(p_user uuid, p_provider text) returns text
language sql security definer set search_path = '' as $$
 select s.decrypted_secret from public.ai_secret_refs r join vault.decrypted_secrets s on s.id=r.secret_id
 where r.user_id=p_user and r.provider=p_provider;
$$;
revoke all on function public.read_ai_credential(uuid,text) from public, anon, authenticated;
grant execute on function public.read_ai_credential(uuid,text) to service_role;

do $$ declare r record; sid uuid; begin
 for r in select * from public.ai_credentials where api_key <> '' loop
  if not exists(select 1 from public.ai_secret_refs where user_id=r.user_id and provider=r.provider) then
   sid := vault.create_secret(r.api_key);
   insert into public.ai_secret_refs values(r.user_id,r.provider,sid);
  end if;
 end loop;
 delete from public.ai_credentials;
end $$;
revoke all on public.ai_credentials from authenticated, anon;
drop policy if exists ai_credentials_owner on public.ai_credentials;

create table if not exists public.ai_rate_limits(user_id uuid primary key references auth.users(id) on delete cascade, bucket timestamptz not null, requests integer not null);
alter table public.ai_rate_limits enable row level security;
revoke all on public.ai_rate_limits from anon, authenticated;
create or replace function public.consume_ai_quota(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer; b timestamptz := date_trunc('minute',now());
begin
 insert into public.ai_rate_limits values(p_user,b,1)
 on conflict(user_id) do update set bucket=b, requests=case when public.ai_rate_limits.bucket=b then public.ai_rate_limits.requests+1 else 1 end
 returning requests into n;
 return n <= 30;
end $$;
revoke all on function public.consume_ai_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid) to service_role;
commit;