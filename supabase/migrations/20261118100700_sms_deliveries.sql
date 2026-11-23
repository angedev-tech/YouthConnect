-- =====================================================================
-- YouthConnect — migration 8/8 : dédoublonnage des SMS
--
-- Supabase peut réessayer un appel du hook SMS. Twilio n'offre pas de clé d'idempotence :
-- on note donc chaque appel (identifiant webhook-id) avant l'envoi. Un second appel
-- avec le même identifiant ne renvoie pas de SMS. En cas d'échec, la trace est retirée
-- pour permettre un nouvel essai.
-- Table et fonctions réservées au serveur (clé secrète).
-- =====================================================================

create table public.sms_deliveries (
  id         text primary key,
  created_at timestamptz not null default now(),
  constraint sms_deliveries_id_length check (char_length(id) between 1 and 200)
);

alter table public.sms_deliveries enable row level security;
-- Aucune politique : ni le visiteur ni le membre ne lisent cette table.
revoke all on public.sms_deliveries from public, anon, authenticated;

-- Enregistre l'appel. Renvoie vrai seulement pour le premier appel avec cet identifiant.
create or replace function public.claim_sms_delivery(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if p_id is null or char_length(p_id) < 1 or char_length(p_id) > 200 then
    raise exception 'Identifiant invalide.' using errcode = '22023';
  end if;
  insert into public.sms_deliveries (id) values (p_id) on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;

-- Retire la trace après un échec d'envoi, pour qu'un nouvel essai soit possible.
create or replace function public.release_sms_delivery(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sms_deliveries where id = p_id;
end;
$$;

-- Nettoyage : supprime les traces de plus de 7 jours.
create or replace function public.purge_sms_deliveries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.sms_deliveries where created_at < now() - interval '7 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.claim_sms_delivery(text) from public, anon, authenticated;
revoke all on function public.release_sms_delivery(text) from public, anon, authenticated;
revoke all on function public.purge_sms_deliveries() from public, anon, authenticated;
grant execute on function public.claim_sms_delivery(text) to service_role;
grant execute on function public.release_sms_delivery(text) to service_role;
grant execute on function public.purge_sms_deliveries() to service_role;
