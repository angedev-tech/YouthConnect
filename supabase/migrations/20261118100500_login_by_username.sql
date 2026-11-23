-- =====================================================================
-- YouthConnect — migration 6/6 : connexion par pseudo
--
-- Le serveur retrouve l'adresse e-mail d'un pseudo ACTIF. Cette fonction n'est
-- appelable que par le serveur (clé secrète) : le navigateur ne peut jamais
-- obtenir l'adresse e-mail liée à un pseudo.
-- =====================================================================

create or replace function public.resolve_login_email(candidate text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(candidate)
    and p.status = 'active'
  limit 1;
$$;

revoke all on function public.resolve_login_email(text) from public, anon, authenticated;
grant execute on function public.resolve_login_email(text) to service_role;
