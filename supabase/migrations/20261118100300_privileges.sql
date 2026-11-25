-- =====================================================================
-- YouthConnect — migration 4/4 : droits explicites (moindre privilège)
-- Supabase accorde par défaut de nombreux droits aux rôles anon et
-- authenticated sur le schéma public. On repart de zéro, puis on n'ajoute
-- que ce qui est nécessaire, colonne par colonne.
-- =====================================================================

-- Droits PAR DÉFAUT : toute table ou fonction créée plus tard par une migration
-- démarre sans droit pour les visiteurs et les membres. Il faut les accorder explicitement.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

-- ── Lecture publique (la RLS limite encore les lignes) ────────────
grant select on public.profiles, public.categories, public.roles, public.questions,
                public.answers, public.comments, public.platform_settings,
                public.question_stats, public.answer_stats
  to anon, authenticated;

-- ── Lecture pour membres connectés (la RLS limite aux lignes permises) ──
grant select on public.account_details, public.user_roles, public.reactions,
                public.notifications, public.reports, public.security_events
  to authenticated;

-- ── Modifications : seules les colonnes prévues ───────────────────
-- Jamais : status (profiles), phone (account_details), is_hidden, user_id,
-- ni aucune écriture directe sur notifications, rôles, journal ou traces anti-spam.
grant update (username, avatar_url, bio, location) on public.profiles to authenticated;
grant update (first_name, last_name) on public.account_details to authenticated;

grant insert (user_id, category_id, title, content) on public.questions to authenticated;
grant update (title, content, category_id, status) on public.questions to authenticated;
grant delete on public.questions to authenticated;

grant insert (question_id, user_id, content, image_url) on public.answers to authenticated;
grant update (content) on public.answers to authenticated;
grant delete on public.answers to authenticated;

grant insert (answer_id, user_id, content) on public.comments to authenticated;
grant update (content) on public.comments to authenticated;
grant delete on public.comments to authenticated;

grant insert (user_id, question_id, answer_id, reaction_type) on public.reactions to authenticated;
grant delete on public.reactions to authenticated;

grant update (is_read) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;

grant insert (reporter_id, target_type, target_id, reason) on public.reports to authenticated;

grant insert, update, delete on public.categories to authenticated;
grant insert, update, delete on public.platform_settings to authenticated;

-- ── Fonctions appelées par les règles RLS et par les déclencheurs ──
grant execute on function
  public.is_active(),
  public.is_admin(),
  public.is_staff(),
  public.has_role(text),
  public.is_author_active(uuid),
  public.username_is_valid(text),
  public.set_updated_at(),
  public.profiles_guard(),
  public.content_guard(),
  public.enforce_rate_limit()
  to authenticated;

grant execute on function public.is_active(), public.is_admin(), public.is_staff(),
  public.has_role(text), public.is_author_active(uuid), public.username_is_valid(text)
  to anon;

-- ── Fonctions appelables directement (RPC) ────────────────────────
grant execute on function public.username_available(text), public.public_stats()
  to anon, authenticated;

grant execute on function
  public.admin_stats(),
  public.staff_set_hidden(text, uuid, boolean),
  public.staff_resolve_report(uuid, text),
  public.admin_set_account_status(uuid, text, text),
  public.admin_set_role(uuid, text, boolean)
  to authenticated;

-- Le déclencheur d'inscription n'est jamais appelé directement par un client.
revoke all on function public.handle_new_user() from public, anon, authenticated;
