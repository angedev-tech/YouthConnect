-- =====================================================================
-- YouthConnect — migration 5/5 : limitation de débit côté serveur
--
-- Les compteurs vivent dans Postgres : ils sont partagés entre toutes les
-- instances des fonctions Vercel et ne peuvent pas être réinitialisés depuis
-- le navigateur. Seul le serveur (rôle service_role) peut les lire ou les modifier.
-- =====================================================================

create table public.rate_limits (
  key               text primary key,
  window_started_at timestamptz not null default now(),
  hits              integer not null default 0,
  constraint rate_limits_hits_positive check (hits >= 0),
  constraint rate_limits_key_length check (char_length(key) between 1 and 200)
);

-- Aucune politique RLS : ni le visiteur ni le membre ne peut lire cette table.
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

-- Incrémente le compteur de la fenêtre en cours et dit si l'appel est autorisé.
-- L'opération est atomique (INSERT … ON CONFLICT) : deux appels simultanés ne se perdent pas.
create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if p_key is null or char_length(p_key) < 1 or char_length(p_key) > 200
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'Paramètres de limitation invalides.' using errcode = '22023';
  end if;

  insert into public.rate_limits as r (key, window_started_at, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_started_at = case
      when r.window_started_at < now() - make_interval(secs => p_window_seconds) then now()
      else r.window_started_at end,
    hits = case
      when r.window_started_at < now() - make_interval(secs => p_window_seconds) then 1
      else r.hits + 1 end
  returning hits <= p_limit into allowed;

  return allowed;
end;
$$;

-- Nettoyage : supprime les compteurs de plus de 24 h (à appeler périodiquement côté serveur).
create or replace function public.purge_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Accès : serveur uniquement.
grant usage on schema public to service_role;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
revoke all on function public.purge_rate_limits() from public, anon, authenticated;
grant execute on function public.purge_rate_limits() to service_role;

-- La vérification de pseudo n'est plus appelable par le navigateur :
-- elle passe par /api/username-available, qui applique une limite par adresse IP.
revoke all on function public.username_available(text) from public, anon, authenticated;
grant execute on function public.username_available(text) to service_role;
