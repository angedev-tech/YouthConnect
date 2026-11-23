-- =====================================================================
-- YouthConnect — migration 3/4 : règles métier
-- Inscription, garde-fous, limites anti-spam, notifications automatiques,
-- signalements, modération et administration.
-- Tout ce qui change un statut ou un rôle passe par ces fonctions contrôlées.
-- =====================================================================

-- ── 1. Inscription : profil public + détails privés + rôle « member » ──
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  uname text := nullif(btrim(meta ->> 'username'), '');
  fname text := nullif(btrim(meta ->> 'first_name'), '');
  lname text := nullif(btrim(meta ->> 'last_name'), '');
  terms text := nullif(btrim(meta ->> 'terms_version'), '');
  phone_value text := nullif(btrim(coalesce(new.phone, meta ->> 'phone')), '');
  current_terms text;
begin
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

  select btrim(ps.value #>> '{}') into current_terms
    from public.platform_settings ps where ps.key = 'terms_version';
  if terms is null or terms is distinct from current_terms then
    raise exception 'Tu dois accepter la version actuelle des conditions d''utilisation.' using errcode = '22023';
  end if;

  insert into public.profiles (id, username) values (new.id, uname);
  insert into public.account_details (user_id, first_name, last_name, phone, terms_accepted_at, terms_version)
    values (new.id, fname, lname, phone_value, now(), terms);
  insert into public.user_roles (user_id, role_id)
    values (new.id, (select r.id from public.roles r where r.name = 'member'));
  insert into public.security_events (user_id, event_type, details)
    values (new.id, 'account_created', '{}'::jsonb);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. Garde-fous sur les profils ─────────────────────────────────
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status and not public.is_admin() then
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

create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ── 3. Garde-fous sur le contenu : seule l'équipe masque ──────────
create or replace function public.content_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_hidden is distinct from old.is_hidden and not public.is_staff() then
    raise exception 'Seule l''équipe de modération peut masquer un contenu.' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'L''auteur d''un contenu ne peut pas être modifié.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger questions_guard before update on public.questions
  for each row execute function public.content_guard();
create trigger answers_guard before update on public.answers
  for each row execute function public.content_guard();
create trigger comments_guard before update on public.comments
  for each row execute function public.content_guard();

-- ── 4. Limites anti-spam, dans la base (impossibles à contourner depuis le navigateur) ──
-- Argument 1 : nom de l'action ; argument 2 : nombre maximum par heure.
create or replace function public.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  action_name text := tg_argv[0];
  max_allowed integer := tg_argv[1]::integer;
  used integer;
begin
  if new.user_id is null then
    return new;
  end if;

  select count(*) into used
  from public.rate_events e
  where e.user_id = new.user_id
    and e.action = action_name
    and e.created_at > now() - interval '1 hour';

  if used >= max_allowed then
    raise exception 'Tu vas un peu vite ! Réessaie dans un moment.' using errcode = 'P0001';
  end if;

  insert into public.rate_events (user_id, action) values (new.user_id, action_name);
  return new;
end;
$$;

create trigger questions_rate_limit before insert on public.questions
  for each row execute function public.enforce_rate_limit('question', '5');
create trigger answers_rate_limit before insert on public.answers
  for each row execute function public.enforce_rate_limit('answer', '30');
create trigger comments_rate_limit before insert on public.comments
  for each row execute function public.enforce_rate_limit('comment', '60');

-- ── 5. Notifications automatiques (jamais écrites par le navigateur) ──
create or replace function public.notify_on_answer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  q_title text;
  who text;
begin
  select q.user_id, q.title into owner_id, q_title
    from public.questions q where q.id = new.question_id;

  if owner_id is not null and owner_id is distinct from new.user_id then
    select p.username into who from public.profiles p where p.id = new.user_id;
    insert into public.notifications (user_id, type, title, message, link)
    values (
      owner_id,
      'answer',
      'Nouvelle réponse à ta question',
      coalesce(who, 'Un membre') || ' a répondu : « ' || left(q_title, 80) || ' »',
      '/?post=' || new.question_id::text
    );
  end if;
  return new;
end;
$$;

create trigger answers_notify after insert on public.answers
  for each row execute function public.notify_on_answer();

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  question_ref uuid;
  who text;
begin
  select a.user_id, a.question_id into owner_id, question_ref
    from public.answers a where a.id = new.answer_id;

  if owner_id is not null and owner_id is distinct from new.user_id then
    select p.username into who from public.profiles p where p.id = new.user_id;
    insert into public.notifications (user_id, type, title, message, link)
    values (
      owner_id,
      'comment',
      'Nouveau commentaire sur ta réponse',
      coalesce(who, 'Un membre') || ' a commenté ta réponse',
      '/?post=' || question_ref::text
    );
  end if;
  return new;
end;
$$;

create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_on_comment();

create or replace function public.notify_on_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  question_ref uuid;
  who text;
  label text;
begin
  if new.question_id is not null then
    select q.user_id, q.id into owner_id, question_ref from public.questions q where q.id = new.question_id;
  else
    select a.user_id, a.question_id into owner_id, question_ref from public.answers a where a.id = new.answer_id;
  end if;

  if owner_id is not null and owner_id is distinct from new.user_id then
    select p.username into who from public.profiles p where p.id = new.user_id;
    label := case new.reaction_type
      when 'like' then 'a aimé'
      when 'helpful' then 'a trouvé utile'
      else 'te remercie pour'
    end;
    insert into public.notifications (user_id, type, title, message, link)
    values (
      owner_id,
      'reaction',
      'Nouvelle réaction',
      coalesce(who, 'Un membre') || ' ' || label || ' ta contribution',
      '/?post=' || question_ref::text
    );
  end if;
  return new;
end;
$$;

create trigger reactions_notify after insert on public.reactions
  for each row execute function public.notify_on_reaction();

-- ── 6. Signalements : règles appliquées par la base ───────────────
create or replace function public.reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  used integer;
begin
  select count(*) into used
  from public.rate_events e
  where e.user_id = new.reporter_id and e.action = 'report' and e.created_at > now() - interval '1 hour';
  if used >= 10 then
    raise exception 'Tu vas un peu vite ! Réessaie dans un moment.' using errcode = 'P0001';
  end if;
  insert into public.rate_events (user_id, action) values (new.reporter_id, 'report');

  if new.target_type = 'question' then
    select q.user_id into owner_id from public.questions q where q.id = new.target_id;
    if not found then raise exception 'Ce contenu n''existe plus.' using errcode = 'P0002'; end if;
  elsif new.target_type = 'answer' then
    select a.user_id into owner_id from public.answers a where a.id = new.target_id;
    if not found then raise exception 'Ce contenu n''existe plus.' using errcode = 'P0002'; end if;
  elsif new.target_type = 'comment' then
    select c.user_id into owner_id from public.comments c where c.id = new.target_id;
    if not found then raise exception 'Ce contenu n''existe plus.' using errcode = 'P0002'; end if;
  elsif new.target_type = 'profile' then
    select p.id into owner_id from public.profiles p where p.id = new.target_id;
    if not found then raise exception 'Ce profil n''existe plus.' using errcode = 'P0002'; end if;
  else
    raise exception 'Type de signalement invalide.' using errcode = '22023';
  end if;

  if owner_id is not null and owner_id = new.reporter_id then
    raise exception 'Tu ne peux pas signaler ton propre contenu.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.reports r
    where r.reporter_id = new.reporter_id and r.target_type = new.target_type and r.target_id = new.target_id
  ) then
    raise exception 'Tu as déjà signalé ce contenu.' using errcode = '23505';
  end if;

  new.reported_user_id := owner_id;
  return new;
end;
$$;

create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

-- ── 7. Modération : fonctions contrôlées (vérifient le rôle elles-mêmes) ──
create or replace function public.staff_set_hidden(target_type text, target_id uuid, hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Réservé à l''équipe de modération.' using errcode = '42501';
  end if;

  if target_type = 'question' then
    update public.questions set is_hidden = hidden where id = target_id;
  elsif target_type = 'answer' then
    update public.answers set is_hidden = hidden where id = target_id;
  elsif target_type = 'comment' then
    update public.comments set is_hidden = hidden where id = target_id;
  else
    raise exception 'Seuls une question, une réponse ou un commentaire peuvent être masqués.' using errcode = '22023';
  end if;

  if not found then
    raise exception 'Contenu introuvable.' using errcode = 'P0002';
  end if;

  insert into public.security_events (user_id, event_type, details)
  values (auth.uid(), 'content_visibility_changed',
          jsonb_build_object('target_type', target_type, 'target_id', target_id, 'hidden', hidden));
end;
$$;

create or replace function public.staff_resolve_report(p_report_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reports%rowtype;
begin
  if not public.is_staff() then
    raise exception 'Réservé à l''équipe de modération.' using errcode = '42501';
  end if;
  if p_decision not in ('dismiss', 'hide') then
    raise exception 'Décision invalide.' using errcode = '22023';
  end if;

  select * into r from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Signalement introuvable.' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'Ce signalement a déjà été traité.' using errcode = 'P0001';
  end if;

  if p_decision = 'hide' then
    if r.target_type = 'profile' then
      raise exception 'Pour un profil, suspends le compte au lieu de masquer.' using errcode = '22023';
    end if;
    perform public.staff_set_hidden(r.target_type, r.target_id, true);
  end if;

  update public.reports
     set status = case when p_decision = 'hide' then 'resolved' else 'dismissed' end,
         handled_by = auth.uid(),
         handled_at = now()
   where id = p_report_id;

  insert into public.notifications (user_id, type, title, message)
  values (r.reporter_id, 'report', 'Ton signalement a été traité',
          'Merci de contribuer à la sécurité de la communauté.');

  insert into public.security_events (user_id, event_type, details)
  values (auth.uid(), 'report_resolved',
          jsonb_build_object('report_id', p_report_id, 'decision', p_decision, 'target_type', r.target_type));
end;
$$;

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

  update public.profiles set status = p_status where id = p_target;
  if not found then
    raise exception 'Compte introuvable.' using errcode = 'P0002';
  end if;

  insert into public.notifications (user_id, type, title, message)
  values (
    p_target,
    'security',
    case when p_status = 'suspended' then 'Ton compte a été suspendu' else 'Ton compte a été réactivé' end,
    case when p_status = 'suspended'
      then 'Contacte l''équipe YouthConnect pour en savoir plus.'
      else 'Tu peux à nouveau participer à la communauté.'
    end
  );

  insert into public.security_events (user_id, event_type, details)
  values (auth.uid(), 'account_status_changed',
          jsonb_build_object('target', p_target, 'status', p_status, 'reason', p_reason));
end;
$$;

create or replace function public.admin_set_role(p_target uuid, p_role text, p_grant boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rid smallint;
  admins_count integer;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if p_role not in ('moderator', 'admin') then
    raise exception 'Seuls les rôles moderator et admin s''attribuent manuellement.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_target) then
    raise exception 'Compte introuvable.' using errcode = 'P0002';
  end if;

  select r.id into rid from public.roles r where r.name = p_role;

  if p_grant then
    insert into public.user_roles (user_id, role_id, granted_by)
    values (p_target, rid, auth.uid())
    on conflict do nothing;
  else
    if p_role = 'admin' then
      select count(*) into admins_count from public.user_roles ur where ur.role_id = rid;
      if admins_count <= 1 and exists (
        select 1 from public.user_roles ur where ur.user_id = p_target and ur.role_id = rid
      ) then
        raise exception 'Impossible de retirer le dernier administrateur.' using errcode = '22023';
      end if;
    end if;
    delete from public.user_roles where user_id = p_target and role_id = rid;
  end if;

  insert into public.security_events (user_id, event_type, details)
  values (auth.uid(), 'role_changed',
          jsonb_build_object('target', p_target, 'role', p_role, 'granted', p_grant));
end;
$$;

-- ── 8. Fonctions de lecture : compteurs publics et tableau de bord ─
create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.username_is_valid(candidate)
     and not exists (select 1 from public.profiles p where lower(p.username) = lower(candidate));
$$;

-- Chiffres RÉELS pour la page d'accueil (plus de « +100 »)
create or replace function public.public_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'members', (select count(*) from public.profiles p where p.status = 'active'),
    'questions', (select count(*) from public.questions q where not q.is_hidden and public.is_author_active(q.user_id)),
    'answers', (select count(*) from public.answers a where not a.is_hidden),
    'categories', (select count(*) from public.categories)
  );
$$;

create or replace function public.admin_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Réservé à l''équipe de modération.' using errcode = '42501';
  end if;
  return json_build_object(
    'members_active', (select count(*) from public.profiles where status = 'active'),
    'members_suspended', (select count(*) from public.profiles where status = 'suspended'),
    'members_new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'questions_total', (select count(*) from public.questions),
    'questions_hidden', (select count(*) from public.questions where is_hidden),
    'answers_total', (select count(*) from public.answers),
    'answers_hidden', (select count(*) from public.answers where is_hidden),
    'reports_pending', (select count(*) from public.reports where status = 'pending'),
    'reports_resolved', (select count(*) from public.reports where status = 'resolved')
  );
end;
$$;
