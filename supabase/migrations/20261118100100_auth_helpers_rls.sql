-- =====================================================================
-- YouthConnect — migration 2/4 : fonctions d'autorisation et RLS
-- Principe : tout est fermé par défaut. RLS et droits de colonnes
-- n'ouvrent que ce qui est nécessaire (voir migration 4 pour les droits).
-- =====================================================================

-- ── Règles de pseudo (inscription, modification, base) ────────────
create or replace function public.username_is_valid(candidate text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select candidate is not null
     and candidate ~ '^[A-Za-z0-9_]{3,30}$'
     and lower(candidate) <> all (array['admin', 'administrateur', 'support', 'moderateur', 'youthconnect', 'system', 'root']);
$$;

-- ── Fonctions d'autorisation ──────────────────────────────────────
-- « security definer » : elles lisent les tables protégées sans boucler dans RLS.
create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

create or replace function public.has_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.name = role_name
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin');
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin') or public.has_role('moderator');
$$;

-- Le contenu d'un compte SUSPENDU reste invisible. Un compte supprimé (auteur nul) ne bloque pas.
create or replace function public.is_author_active(author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.status = 'active' from public.profiles p where p.id = author), true);
$$;

-- ── Activation de RLS sur toutes les tables ───────────────────────
alter table public.profiles enable row level security;
alter table public.account_details enable row level security;
alter table public.categories enable row level security;
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.security_events enable row level security;
alter table public.platform_settings enable row level security;
alter table public.rate_events enable row level security;

-- ── profiles : public, mais seulement pour les comptes actifs ─────
create policy profiles_read on public.profiles for select
  using (status = 'active' or id = auth.uid() or public.is_staff());

create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active())
  with check (id = auth.uid() and public.is_active());

-- ── account_details : privé, propriétaire uniquement ──────────────
create policy account_details_read_own on public.account_details for select to authenticated
  using (user_id = auth.uid());

create policy account_details_update_own on public.account_details for update to authenticated
  using (user_id = auth.uid() and public.is_active())
  with check (user_id = auth.uid() and public.is_active());

-- ── categories : lecture publique, écriture administrateur ────────
create policy categories_read on public.categories for select using (true);

create policy categories_admin_write on public.categories for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── roles (référentiel public) ────────────────────────────────────
create policy roles_read on public.roles for select using (true);

-- ── user_roles : chacun voit les siens ; l'équipe voit tout ───────
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- ── questions ─────────────────────────────────────────────────────
create policy questions_read on public.questions for select
  using (
    (not is_hidden and public.is_author_active(user_id))
    or user_id = auth.uid()
    or public.is_staff()
  );

create policy questions_insert_own on public.questions for insert to authenticated
  with check (user_id = auth.uid() and public.is_active());

create policy questions_update_own on public.questions for update to authenticated
  using (user_id = auth.uid() and public.is_active() and not is_hidden)
  with check (user_id = auth.uid() and public.is_active());

create policy questions_delete on public.questions for delete to authenticated
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin());

-- ── answers : visibles si la question l'est ───────────────────────
create policy answers_read on public.answers for select
  using (
    (
      not is_hidden
      and public.is_author_active(user_id)
      and exists (select 1 from public.questions q where q.id = answers.question_id)
    )
    or user_id = auth.uid()
    or public.is_staff()
  );

create policy answers_insert_own on public.answers for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active()
    and exists (
      select 1 from public.questions q
      where q.id = answers.question_id and q.status = 'open' and not q.is_hidden
    )
  );

create policy answers_update_own on public.answers for update to authenticated
  using (user_id = auth.uid() and public.is_active() and not is_hidden)
  with check (user_id = auth.uid() and public.is_active());

create policy answers_delete on public.answers for delete to authenticated
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin());

-- ── comments : visibles si la réponse l'est ───────────────────────
create policy comments_read on public.comments for select
  using (
    (
      not is_hidden
      and public.is_author_active(user_id)
      and exists (select 1 from public.answers a where a.id = comments.answer_id and not a.is_hidden)
    )
    or user_id = auth.uid()
    or public.is_staff()
  );

create policy comments_insert_own on public.comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active()
    and exists (select 1 from public.answers a where a.id = comments.answer_id and not a.is_hidden)
  );

create policy comments_update_own on public.comments for update to authenticated
  using (user_id = auth.uid() and public.is_active() and not is_hidden)
  with check (user_id = auth.uid() and public.is_active());

create policy comments_delete on public.comments for delete to authenticated
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin());

-- ── reactions : chacun ne voit que les siennes (les compteurs sont dans des vues) ──
create policy reactions_read_own on public.reactions for select to authenticated
  using (user_id = auth.uid());

-- On ne réagit pas à son propre contenu, ni à un contenu invisible
create policy reactions_insert_own on public.reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active()
    and (
      (reactions.question_id is not null and exists (
        select 1 from public.questions q
        where q.id = reactions.question_id and q.user_id is distinct from auth.uid()
      ))
      or
      (reactions.answer_id is not null and exists (
        select 1 from public.answers a
        where a.id = reactions.answer_id and a.user_id is distinct from auth.uid()
      ))
    )
  );

create policy reactions_delete_own on public.reactions for delete to authenticated
  using (user_id = auth.uid());

-- ── notifications : chacun ne voit que les siennes ────────────────
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- ── reports : le signalant voit les siens ; l'équipe voit tout ────
create policy reports_read on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_staff());

create policy reports_insert_own on public.reports for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_active());

-- ── security_events : administrateurs seulement ───────────────────
create policy security_events_read_admin on public.security_events for select to authenticated
  using (public.is_admin());

-- ── platform_settings : publics ou réservés à l'équipe ────────────
create policy platform_settings_read on public.platform_settings for select
  using (is_public or public.is_staff());

create policy platform_settings_admin_write on public.platform_settings for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- rate_events : aucune politique → personne ne peut la lire ni l'écrire, sauf le serveur.

-- ── Compteurs publics (vues) : agrégats uniquement, sans identité ─
-- Une vue ignore RLS (elle appartient au propriétaire), donc elle reproduit
-- elle-même les règles de visibilité : contenu masqué ou compte suspendu exclus.
create view public.question_stats as
select
  q.id as question_id,
  (select count(*) from public.reactions r where r.question_id = q.id and r.reaction_type = 'like')    as likes,
  (select count(*) from public.reactions r where r.question_id = q.id and r.reaction_type = 'helpful') as helpful,
  (select count(*) from public.reactions r where r.question_id = q.id and r.reaction_type = 'thanks')  as thanks,
  (select count(*) from public.answers a where a.question_id = q.id and not a.is_hidden)               as answers_count
from public.questions q
where not q.is_hidden and public.is_author_active(q.user_id);

create view public.answer_stats as
select
  a.id as answer_id,
  (select count(*) from public.reactions r where r.answer_id = a.id and r.reaction_type = 'like')    as likes,
  (select count(*) from public.reactions r where r.answer_id = a.id and r.reaction_type = 'helpful') as helpful,
  (select count(*) from public.reactions r where r.answer_id = a.id and r.reaction_type = 'thanks')  as thanks,
  (select count(*) from public.comments c where c.answer_id = a.id and not c.is_hidden)              as comments_count
from public.answers a
join public.questions q on q.id = a.question_id
where not a.is_hidden and not q.is_hidden and public.is_author_active(a.user_id);
