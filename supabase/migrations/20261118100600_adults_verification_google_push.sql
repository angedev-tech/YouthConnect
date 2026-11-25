-- =====================================================================
-- YouthConnect — migration 7/7 : décisions du 19 novembre 2026
--
--   D1  Âge minimum : 18 ans, contrôlé par la base (création et validation).
--   D2  Connexion Google : le profil est créé « en attente » et doit être complété.
--   D3  Téléphone obligatoire et vérifié, e-mail confirmé : le compte n'est
--       ACTIF que si les deux sont vérifiés (et les autres conditions remplies).
--   D4  Notifications push : abonnements protégés, préférences par type.
--       Les alertes de sécurité ne peuvent pas être désactivées.
--   D7  Anciens contenus : marqués « ancien membre », jamais liés à un compte.
-- =====================================================================

-- ── 1. Fonctions utilitaires ──────────────────────────────────────

-- Vrai si la personne a au moins 18 ans révolus à la date du jour.
create or replace function public.is_adult(birth date)
returns boolean
language sql
stable
set search_path = public
as $$
  select birth is not null and birth <= (current_date - interval '18 years')::date;
$$;

-- ── 2. Profils : statut « en attente » par défaut ─────────────────

alter table public.profiles drop constraint profiles_status_valid;
alter table public.profiles add constraint profiles_status_valid
  check (status in ('pending', 'active', 'suspended'));
alter table public.profiles alter column status set default 'pending';
alter table public.profiles add column username_chosen_at timestamptz;
update public.profiles set username_chosen_at = created_at where username_chosen_at is null;

-- ── 3. Données privées : date de naissance, champs optionnels à la création ──

alter table public.account_details alter column first_name drop not null;
alter table public.account_details alter column last_name drop not null;
alter table public.account_details alter column terms_accepted_at drop not null;
alter table public.account_details alter column terms_version drop not null;
alter table public.account_details add column birth_date date;

-- ── 4. Anciens contenus (D7) ──────────────────────────────────────

alter table public.questions
  add column is_legacy boolean not null default false,
  add column legacy_source_id text,
  add constraint questions_legacy_unlinked check (not is_legacy or user_id is null),
  add constraint questions_legacy_source_len check (legacy_source_id is null or char_length(legacy_source_id) between 1 and 100);
create unique index questions_legacy_source_key on public.questions (legacy_source_id) where legacy_source_id is not null;

alter table public.answers
  add column is_legacy boolean not null default false,
  add column legacy_source_id text,
  add constraint answers_legacy_unlinked check (not is_legacy or user_id is null),
  add constraint answers_legacy_source_len check (legacy_source_id is null or char_length(legacy_source_id) between 1 and 100);
create unique index answers_legacy_source_key on public.answers (legacy_source_id) where legacy_source_id is not null;

alter table public.comments
  add column is_legacy boolean not null default false,
  add column legacy_source_id text,
  add constraint comments_legacy_unlinked check (not is_legacy or user_id is null),
  add constraint comments_legacy_source_len check (legacy_source_id is null or char_length(legacy_source_id) between 1 and 100);
create unique index comments_legacy_source_key on public.comments (legacy_source_id) where legacy_source_id is not null;

-- ── 5. Notifications push (D4) ────────────────────────────────────

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth_secret     text not null,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count   integer not null default 0,
  constraint push_endpoint_https check (char_length(endpoint) <= 2048 and endpoint ~ '^https://[^/:[:space:]]+(/[^[:space:]]*)?$'),
  constraint push_keys_format check (p256dh ~ '^[A-Za-z0-9_-]{20,130}$' and auth_secret ~ '^[A-Za-z0-9_-]{10,40}$'),
  constraint push_failures_range check (failure_count between 0 and 100)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notification_preferences (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  answers    boolean not null default true,
  comments   boolean not null default true,
  reactions  boolean not null default true,
  moderation boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;

create policy push_subscriptions_read_own on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

create policy notification_preferences_read_own on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());
create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid() and public.is_active());
create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 6. Activation : e-mail ET téléphone vérifiés (D3) ─────────────

-- Recalcule le statut du profil à partir des preuves tenues par Supabase Auth.
-- Un compte suspendu n'est jamais modifié ici.
create or replace function public.refresh_profile_activation(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  is_ready boolean;
begin
  select coalesce(
    u.email_confirmed_at is not null
    and u.phone is not null
    and u.phone_confirmed_at is not null
    and d.phone = u.phone
    and d.phone_verified_at is not null
    and public.is_adult(d.birth_date)
    and d.terms_accepted_at is not null
    and d.first_name is not null
    and d.last_name is not null
    and p.username_chosen_at is not null,
    false)
  into is_ready
  from auth.users u
  join public.profiles p on p.id = u.id
  join public.account_details d on d.user_id = u.id
  where u.id = p_user;

  if not found then
    return;
  end if;

  update public.profiles
     set status = case when is_ready then 'active' else 'pending' end
   where id = p_user
     and status in ('pending', 'active')
     and status is distinct from (case when is_ready then 'active' else 'pending' end);
end;
$$;

-- Quand Supabase Auth change une preuve (e-mail confirmé, numéro saisi ou vérifié),
-- on copie le numéro vérifié dans le profil privé et on recalcule l'activation.
create or replace function public.on_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is not null and new.phone_confirmed_at is not null then
    update public.account_details
       set phone = new.phone, phone_verified_at = new.phone_confirmed_at
     where user_id = new.id
       and (phone is distinct from new.phone or phone_verified_at is distinct from new.phone_confirmed_at);
  elsif new.phone is not null then
    -- Numéro saisi mais non vérifié : il n'est plus considéré comme vérifié
    update public.account_details
       set phone = new.phone, phone_verified_at = null
     where user_id = new.id
       and (phone is distinct from new.phone or phone_verified_at is not null);
  end if;
  perform public.refresh_profile_activation(new.id);
  return new;
end;
$$;

create trigger on_auth_user_contact_changed
  after update on auth.users
  for each row
  when (old.email_confirmed_at is distinct from new.email_confirmed_at
     or old.phone is distinct from new.phone
     or old.phone_confirmed_at is distinct from new.phone_confirmed_at)
  execute function public.on_auth_user_updated();

-- ── 7. Création du compte : e-mail (D1, D3) ou fournisseur (D2) ───

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  uname text := nullif(btrim(meta ->> 'username'), '');
  fname text := nullif(btrim(meta ->> 'first_name'), '');
  lname text := nullif(btrim(meta ->> 'last_name'), '');
  terms text := nullif(btrim(meta ->> 'terms_version'), '');
  birth_text text := nullif(btrim(meta ->> 'birth_date'), '');
  birth date;
  phone_value text := nullif(btrim(coalesce(new.phone, meta ->> 'phone')), '');
  current_terms text;
  placeholder text := 'membre_' || substr(md5(new.id::text), 1, 12);
begin
  -- D2 : connexion par fournisseur (Google). Profil « en attente », complété ensuite.
  -- Aucune date de naissance ni téléphone n'est inventé ici.
  if provider <> 'email' then
    insert into public.profiles (id, username, status) values (new.id, placeholder, 'pending');
    insert into public.account_details (user_id, first_name, last_name)
      values (new.id, nullif(btrim(meta ->> 'given_name'), ''), nullif(btrim(meta ->> 'family_name'), ''));
    insert into public.user_roles (user_id, role_id)
      values (new.id, (select r.id from public.roles r where r.name = 'member'));
    insert into public.security_events (user_id, event_type, details)
      values (new.id, 'account_created', jsonb_build_object('provider', provider));
    perform public.refresh_profile_activation(new.id);
    return new;
  end if;

  -- Inscription par e-mail : toutes les informations sont exigées (D1, D3)
  if not public.username_is_valid(uname) then
    raise exception 'Pseudo invalide : 3 à 30 caractères (lettres, chiffres, tiret bas), sans mot réservé.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where lower(p.username) = lower(uname)) then
    raise exception 'Ce pseudo est déjà pris.' using errcode = '23505';
  end if;
  if fname is null or lname is null then
    raise exception 'Le prénom et le nom sont obligatoires.' using errcode = '22023';
  end if;
  if phone_value is null or phone_value !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Numéro de téléphone invalide : utilise le format international, par exemple +228 suivi du numéro.'
      using errcode = '22023';
  end if;
  if birth_text is null or birth_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'La date de naissance est obligatoire.' using errcode = '22023';
  end if;
  begin
    birth := birth_text::date;
  exception when others then
    raise exception 'Date de naissance invalide.' using errcode = '22007';
  end;
  if not public.is_adult(birth) then
    raise exception 'Inscription réservée aux personnes âgées de 18 ans ou plus.' using errcode = '22023';
  end if;
  select btrim(ps.value #>> '{}') into current_terms
    from public.platform_settings ps where ps.key = 'terms_version';
  if terms is null or terms is distinct from current_terms then
    raise exception 'Tu dois accepter la version actuelle des conditions d''utilisation.' using errcode = '22023';
  end if;

  insert into public.profiles (id, username, status, username_chosen_at)
    values (new.id, uname, 'pending', now());
  insert into public.account_details
    (user_id, first_name, last_name, phone, phone_verified_at, birth_date, terms_accepted_at, terms_version)
  values (
    new.id, fname, lname, phone_value,
    case when new.phone_confirmed_at is not null and phone_value = new.phone then new.phone_confirmed_at end,
    birth, now(), terms
  );
  insert into public.user_roles (user_id, role_id)
    values (new.id, (select r.id from public.roles r where r.name = 'member'));
  insert into public.security_events (user_id, event_type, details)
    values (new.id, 'account_created', jsonb_build_object('provider', 'email'));
  perform public.refresh_profile_activation(new.id);
  return new;
end;
$$;

-- ── 8. Garde-fous du profil : transitions automatiques autorisées ─

create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Statut : seul un administrateur suspend ou réactive. Le passage automatique
  -- entre « en attente » et « active » est décidé par la base (refresh_profile_activation).
  if new.status is distinct from old.status
     and not public.is_admin()
     and not (old.status in ('pending', 'active') and new.status in ('pending', 'active')) then
    raise exception 'Seul un administrateur peut suspendre ou réactiver un compte.' using errcode = '42501';
  end if;
  if new.username is distinct from old.username then
    if not public.username_is_valid(new.username) then
      raise exception 'Pseudo invalide : 3 à 30 caractères (lettres, chiffres, tiret bas), sans mot réservé.'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.profiles p where lower(p.username) = lower(new.username) and p.id <> old.id) then
      raise exception 'Ce pseudo est déjà pris.' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

-- ── 9. Complétion du profil après connexion Google (D2) ───────────

create or replace function public.complete_onboarding(
  p_username text,
  p_birth_date date,
  p_terms_version text,
  p_first_name text default null,
  p_last_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_terms text;
  first_value text;
  last_value text;
begin
  if uid is null then
    raise exception 'Connecte-toi pour continuer.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = uid and p.status <> 'suspended') then
    raise exception 'Ce compte ne peut pas être complété.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = uid and p.username_chosen_at is not null) then
    raise exception 'Ce profil est déjà complété.' using errcode = '22023';
  end if;
  -- La date n'est vérifiée puis rejetée qu'ici : un mineur n'est jamais enregistré
  if not public.is_adult(p_birth_date) then
    raise exception 'Inscription réservée aux personnes âgées de 18 ans ou plus.' using errcode = '22023';
  end if;
  if not public.username_is_valid(p_username) then
    raise exception 'Pseudo invalide : 3 à 30 caractères (lettres, chiffres, tiret bas), sans mot réservé.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where lower(p.username) = lower(p_username) and p.id <> uid) then
    raise exception 'Ce pseudo est déjà pris.' using errcode = '23505';
  end if;
  select btrim(ps.value #>> '{}') into current_terms
    from public.platform_settings ps where ps.key = 'terms_version';
  if p_terms_version is null or p_terms_version is distinct from current_terms then
    raise exception 'Tu dois accepter la version actuelle des conditions d''utilisation.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p_first_name), ''), d.first_name),
         coalesce(nullif(btrim(p_last_name), ''), d.last_name)
    into first_value, last_value
    from public.account_details d where d.user_id = uid;
  if first_value is null or last_value is null
     or char_length(first_value) > 60 or char_length(last_value) > 60 then
    raise exception 'Le prénom et le nom sont obligatoires (60 caractères maximum).' using errcode = '22023';
  end if;

  update public.profiles
     set username = p_username, username_chosen_at = now()
   where id = uid;
  update public.account_details
     set birth_date = p_birth_date,
         terms_accepted_at = now(),
         terms_version = p_terms_version,
         first_name = first_value,
         last_name = last_value
   where user_id = uid;

  perform public.refresh_profile_activation(uid);
end;
$$;

-- ── 10. Abonnements push (D4) ─────────────────────────────────────

-- Enregistre l'abonnement du membre actif. Un endpoint déjà lié à un autre compte
-- est refusé ; son transfert exige la désinscription par le compte propriétaire.
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  host text;
  device_count integer;
  affected integer;
begin
  if uid is null then
    raise exception 'Connecte-toi pour activer les notifications.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = uid and p.status = 'active') then
    raise exception 'Compte non actif : les notifications sont réservées aux comptes vérifiés.' using errcode = '42501';
  end if;
  if p_endpoint is null or char_length(p_endpoint) > 2048
     or p_endpoint !~ '^https://[^/:[:space:]]+(/[^[:space:]]*)?$' then
    raise exception 'Abonnement invalide.' using errcode = '22023';
  end if;
  host := substring(p_endpoint from '^https://([^/]+)');
  if host !~ '^[a-z0-9.-]+$' or host !~ '[.]' or host ~ '^[0-9.]+$'
     or host like '%.local' or host like '%.internal' or host = 'localhost' then
    raise exception 'Abonnement invalide.' using errcode = '22023';
  end if;
  if p_p256dh !~ '^[A-Za-z0-9_-]{20,130}$' or p_auth !~ '^[A-Za-z0-9_-]{10,40}$' then
    raise exception 'Abonnement invalide.' using errcode = '22023';
  end if;

  select count(*) into device_count from public.push_subscriptions s where s.user_id = uid;
  if device_count >= 10 and not exists (
    select 1 from public.push_subscriptions s where s.user_id = uid and s.endpoint = p_endpoint
  ) then
    raise exception 'Trop d''appareils abonnés à ce compte (10 maximum).' using errcode = 'P0001';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
    values (uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        failure_count = 0
    where push_subscriptions.user_id = excluded.user_id;

  get diagnostics affected = row_count;

  if affected = 0 then
    raise exception 'Cet abonnement est déjà associé à un autre compte.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Connecte-toi.' using errcode = '42501';
  end if;
  delete from public.push_subscriptions s
   where s.endpoint = p_endpoint and s.user_id = auth.uid();
end;
$$;

-- ── 11. Réactivation : ne contourne jamais les vérifications ──────

create or replace function public.admin_set_account_status(p_target uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Statut invalide.' using errcode = '22023';
  end if;
  if p_target = auth.uid() then
    raise exception 'Tu ne peux pas modifier ton propre statut.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_target) then
    raise exception 'Compte introuvable.' using errcode = 'P0002';
  end if;

  if p_status = 'suspended' then
    update public.profiles set status = 'suspended' where id = p_target;
  else
    -- La réactivation remet le compte « en attente » : il redevient actif seulement
    -- si son e-mail et son téléphone sont toujours vérifiés.
    update public.profiles set status = 'pending' where id = p_target and status = 'suspended';
    perform public.refresh_profile_activation(p_target);
  end if;

  insert into public.notifications (user_id, type, title, message)
  values (
    p_target,
    'security',
    case when p_status = 'suspended' then 'Ton compte a été suspendu' else 'Ton compte a été réactivé' end,
    case when p_status = 'suspended'
      then 'Contacte l''équipe YouthConnect pour en savoir plus.'
      else 'Si une vérification est en attente, complète-la pour retrouver l''accès.'
    end
  );
  insert into public.security_events (user_id, event_type, details)
  values (auth.uid(), 'account_status_changed',
          jsonb_build_object('target', p_target, 'status', p_status, 'reason', p_reason));
end;
$$;

-- ── 12. Droits (moindre privilège) ────────────────────────────────

-- Les nouvelles fonctions ne sont appelables que par le rôle prévu.
revoke all on function public.is_adult(date) from public, anon, authenticated;
revoke all on function public.refresh_profile_activation(uuid) from public, anon, authenticated;
revoke all on function public.on_auth_user_updated() from public, anon, authenticated;
revoke all on function public.complete_onboarding(text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.register_push_subscription(text, text, text) from public, anon, authenticated;
revoke all on function public.remove_push_subscription(text) from public, anon, authenticated;
grant execute on function public.complete_onboarding(text, date, text, text, text) to authenticated;
grant execute on function public.register_push_subscription(text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- Abonnements : le membre voit ses appareils, sans l'adresse secrète ni les clés.
grant select (id, created_at, last_success_at, failure_count) on public.push_subscriptions to authenticated;
-- Préférences : lecture, création et modification de ses propres choix.
grant select on public.notification_preferences to authenticated;
grant insert (user_id, answers, comments, reactions, moderation) on public.notification_preferences to authenticated;
grant update (answers, comments, reactions, moderation, updated_at) on public.notification_preferences to authenticated;
