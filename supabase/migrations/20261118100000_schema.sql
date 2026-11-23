-- =====================================================================
-- YouthConnect — migration 1/4 : schéma
-- Tables, contraintes, index et données de référence.
-- Aucune donnée personnelle ici.
-- =====================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Profils PUBLICS : ce qu'un visiteur peut voir ─────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  avatar_url  text,
  bio         text,
  location    text,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,30}$'),
  constraint profiles_status_valid check (status in ('active', 'suspended')),
  -- avatar : uniquement nos images Cloudinary (pas d'hébergeur tiers qui pourrait suivre les visiteurs)
  constraint profiles_avatar_cloudinary check (
    avatar_url is null or (
      char_length(avatar_url) <= 400
      and avatar_url ~ '^https://res\.cloudinary\.com/dyo3r3lph/image/upload/[A-Za-z0-9_./%-]+$'
    )
  ),
  constraint profiles_bio_len check (bio is null or char_length(bio) <= 300),
  constraint profiles_location_len check (location is null or char_length(location) <= 100)
);
-- Pseudo unique, sans tenir compte de la casse
create unique index profiles_username_key on public.profiles (lower(username));
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── Données PRIVÉES : jamais visibles publiquement ────────────────
create table public.account_details (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  first_name        text not null,
  last_name         text not null,
  phone             text,
  phone_verified_at timestamptz,
  terms_accepted_at timestamptz not null,
  terms_version     text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint account_first_name_len check (char_length(first_name) between 1 and 60),
  constraint account_last_name_len check (char_length(last_name) between 1 and 60),
  constraint account_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint account_verified_has_phone check (phone_verified_at is null or phone is not null)
);
-- Un numéro VÉRIFIÉ ne peut appartenir qu'à un seul compte
create unique index account_phone_verified_key on public.account_details (phone)
  where phone_verified_at is not null;
create trigger account_details_set_updated_at before update on public.account_details
  for each row execute function public.set_updated_at();

-- ── Catégories (gérées par les administrateurs) ───────────────────
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  slug        text not null unique,
  description text,
  icon        text,
  created_at  timestamptz not null default now(),
  constraint categories_name_len check (char_length(name) between 2 and 60),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- ── Rôles : référentiel et attribution ────────────────────────────
create table public.roles (
  id   smallint primary key,
  name text not null unique,
  constraint roles_name_valid check (name in ('member', 'moderator', 'admin'))
);

create table public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_id    smallint not null references public.roles(id) on delete restrict,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index user_roles_role_idx on public.user_roles (role_id);

-- ── Questions ─────────────────────────────────────────────────────
create table public.questions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete set null,
  category_id   uuid not null references public.categories(id) on delete restrict,
  title         text not null,
  content       text not null,
  status        text not null default 'open',
  is_hidden     boolean not null default false,
  search_vector tsvector generated always as (
    to_tsvector('french', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint questions_title_len check (char_length(title) between 10 and 120),
  constraint questions_content_len check (char_length(content) between 30 and 5000),
  constraint questions_status_valid check (status in ('open', 'closed'))
);
create index questions_category_created_idx on public.questions (category_id, created_at desc);
create index questions_user_created_idx on public.questions (user_id, created_at desc);
create index questions_created_idx on public.questions (created_at desc);
create index questions_search_idx on public.questions using gin (search_vector);
create trigger questions_set_updated_at before update on public.questions
  for each row execute function public.set_updated_at();

-- ── Réponses (« comments » de l'ancienne version Firestore) ───────
create table public.answers (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  content     text not null,
  image_url   text,
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint answers_content_len check (char_length(content) between 10 and 5000),
  constraint answers_image_cloudinary check (
    image_url is null or (
      char_length(image_url) <= 500
      and image_url ~ '^https://res\.cloudinary\.com/dyo3r3lph/image/upload/[A-Za-z0-9_./%-]+$'
    )
  )
);
create index answers_question_created_idx on public.answers (question_id, created_at);
create index answers_user_created_idx on public.answers (user_id, created_at desc);
create trigger answers_set_updated_at before update on public.answers
  for each row execute function public.set_updated_at();

-- ── Commentaires sur les réponses ─────────────────────────────────
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  answer_id  uuid not null references public.answers(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  content    text not null,
  is_hidden  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_content_len check (char_length(content) between 2 and 1000)
);
create index comments_answer_created_idx on public.comments (answer_id, created_at);
create index comments_user_created_idx on public.comments (user_id, created_at desc);
create trigger comments_set_updated_at before update on public.comments
  for each row execute function public.set_updated_at();

-- ── Réactions : une par membre, par cible et par type ─────────────
create table public.reactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  question_id   uuid references public.questions(id) on delete cascade,
  answer_id     uuid references public.answers(id) on delete cascade,
  reaction_type text not null,
  created_at    timestamptz not null default now(),
  constraint reactions_type_valid check (reaction_type in ('like', 'helpful', 'thanks')),
  -- exactement UNE cible : une question OU une réponse
  constraint reactions_one_target check ((question_id is null) <> (answer_id is null))
);
create unique index reactions_question_once on public.reactions (user_id, question_id, reaction_type)
  where question_id is not null;
create unique index reactions_answer_once on public.reactions (user_id, answer_id, reaction_type)
  where answer_id is not null;
create index reactions_question_idx on public.reactions (question_id) where question_id is not null;
create index reactions_answer_idx on public.reactions (answer_id) where answer_id is not null;

-- ── Notifications : créées par la base ou le serveur uniquement ──
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  message    text not null,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notifications_type_valid check (
    type in ('answer', 'comment', 'reaction', 'report', 'security', 'system')
  ),
  constraint notifications_title_len check (char_length(title) between 1 and 120),
  constraint notifications_message_len check (char_length(message) between 1 and 500),
  -- lien INTERNE uniquement : jamais d'adresse externe ni de « //domaine »
  constraint notifications_link_internal check (
    link is null or (char_length(link) <= 300 and (link = '/' or link ~ '^/[^/[:space:]]'))
  )
);
create index notifications_user_idx on public.notifications (user_id, is_read, created_at desc);

-- ── Signalements ──────────────────────────────────────────────────
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  target_type      text not null,
  target_id        uuid not null,
  reason           text not null,
  status           text not null default 'pending',
  handled_by       uuid references public.profiles(id) on delete set null,
  handled_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint reports_target_valid check (target_type in ('question', 'answer', 'comment', 'profile')),
  constraint reports_reason_len check (char_length(reason) between 5 and 500),
  constraint reports_status_valid check (status in ('pending', 'resolved', 'dismissed')),
  constraint reports_handled_coherent check ((status = 'pending') = (handled_at is null))
);
-- Un membre ne signale pas deux fois le même contenu
create unique index reports_once_key on public.reports (reporter_id, target_type, target_id);
create index reports_status_idx on public.reports (status, created_at desc);

-- ── Journal de sécurité (lisible par les administrateurs) ─────────
create table public.security_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  event_type text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index security_events_created_idx on public.security_events (created_at desc);

-- ── Traces anti-spam : non modifiables par les membres ────────────
create table public.rate_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  action     text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup_idx on public.rate_events (user_id, action, created_at desc);

-- ── Paramètres de la plateforme ───────────────────────────────────
create table public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- ── Données de référence ──────────────────────────────────────────
insert into public.roles (id, name) values (1, 'member'), (2, 'moderator'), (3, 'admin')
  on conflict do nothing;

insert into public.categories (name, slug) values
  ('Études', 'etudes'),
  ('Informatique', 'informatique'),
  ('Développement Web', 'developpement-web'),
  ('Entrepreneuriat', 'entrepreneuriat'),
  ('Emploi', 'emploi'),
  ('Marketing Digital', 'marketing-digital'),
  ('Intelligence Artificielle', 'intelligence-artificielle'),
  ('Motivation', 'motivation'),
  ('Bourses d''études', 'bourses-etudes'),
  ('Vie Étudiante', 'vie-etudiante')
on conflict do nothing;

-- Version des CGU acceptée à l'inscription (publique, modifiable par un administrateur)
insert into public.platform_settings (key, value, is_public)
  values ('terms_version', '"2026-11-18"', true)
  on conflict do nothing;
