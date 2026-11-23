/* ═══════════════════════════════════════════════════════════════
   Tests de la base : RLS, droits de colonnes, règles métier.
   Lancés par « npm run test:db » sur un PostgreSQL LOCAL recréé à chaque fois.
   Chaque test s'exécute dans une transaction annulée à la fin : aucune donnée n'est gardée.
═══════════════════════════════════════════════════════════════ */
import pg from 'pg';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { Client } = pg;

const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error('TEST_DATABASE_URL manquant : lance les tests avec « npm run test:db ».');

const c = new Client({ connectionString: URL });

// Comptes de test (identifiants fixes)
const U = {
  alice: '11111111-1111-4111-8111-111111111111', // administratrice
  bob: '22222222-2222-4222-8222-222222222222',   // membre, auteur de la question de départ
  carol: '33333333-3333-4333-8333-333333333333', // modératrice
  dave: '44444444-4444-4444-8444-444444444444',  // membre (suspension, limites)
  eve: '55555555-5555-4555-8555-555555555555',   // membre (réactions, signalements)
};
const F = {};       // contenus de départ : F.Q1 (question de Bob), F.A1 (réponse d'Alice)
let ETUDES = null;  // identifiant de la catégorie « Études »

const SIGNUP = 'insert into auth.users (id, email, phone, raw_user_meta_data) values ($1, $2, $3, $4::jsonb)';
// Compte entièrement vérifié (e-mail et téléphone) : créé directement actif pour les fixtures
const VERIFIED = 'insert into auth.users (id, email, phone, raw_user_meta_data, email_confirmed_at, phone_confirmed_at) values ($1, $2, $3, $4::jsonb, now(), now())';
const ADULT = '1990-05-12';
let seq = 0;

function freshUser({ phone, meta = {} } = {}) {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    email: `nouveau${seq}@test.local`,
    phone: phone ?? `+22899${String(100000 + seq)}`,
    meta: {
      username: `nouveau_${seq}`,
      first_name: 'Nouveau',
      last_name: 'Membre',
      terms_version: '2026-11-18',
      birth_date: ADULT,
      ...meta,
    },
  };
}
const signupParams = (u) => [u.id, u.email, u.phone, JSON.stringify(u.meta)];

/* ── Aides ─────────────────────────────────────────────────────── */

async function tx(fn) {
  await c.query('begin');
  try {
    await fn();
  } finally {
    await c.query('rollback');
  }
}

async function superuser() {
  await c.query('reset role');
}

/** Change d'identité : « anon » (visiteur) ou le nom d'un compte de test. */
async function as(who) {
  await c.query('reset role');
  if (who === 'service') {
    await c.query('set local role service_role');
    return;
  }
  if (who === 'anon') {
    await c.query("select set_config('request.jwt.claims', '', true)");
    await c.query('set local role anon');
    return;
  }
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: U[who], role: 'authenticated' }),
  ]);
  await c.query('set local role authenticated');
}

const sql = (text, params = []) => c.query(text, params);

/** Vérifie que la requête est REFUSÉE avec un message correspondant au motif. */
async function failure(text, params, pattern) {
  await c.query('savepoint probe');
  try {
    await c.query(text, params);
  } catch (err) {
    await c.query('rollback to savepoint probe');
    assert.match(err.message, pattern);
    return err;
  }
  assert.fail(`la requête aurait dû être refusée : ${text.slice(0, 100)}`);
}

async function createAccount(u) {
  await c.query(VERIFIED, signupParams(u));
}

const countOf = async (text, params = []) => Number((await c.query(text, params)).rows[0].n);

/* ── Données de départ (validées, puis conservées pour tous les tests) ── */

before(async () => {
  await c.connect();

  const accounts = [
    ['alice', 'alice_admin', '+22890000001'],
    ['bob', 'bob_mensah', '+22890000002'],
    ['carol', 'carol_modo', '+22890000003'],
    ['dave', 'dave_test', '+22890000004'],
    ['eve', 'eve_reporter', '+22890000005'],
  ];
  for (const [key, username, phone] of accounts) {
    await createAccount({
      id: U[key],
      email: `${key}@test.local`,
      phone,
      meta: { username, first_name: key, last_name: 'Test', terms_version: '2026-11-18', birth_date: ADULT },
    });
  }

  // Attribution des rôles de départ (ids : member=1, moderator=2, admin=3)
  await c.query('insert into user_roles (user_id, role_id) values ($1, 3), ($2, 2)', [U.alice, U.carol]);

  ETUDES = (await c.query("select id from categories where slug = 'etudes'")).rows[0].id;

  const q = await c.query(
    'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4) returning id',
    [U.bob, ETUDES, "Comment choisir une bourse d'études ?",
      "Je cherche des conseils pour trouver une bourse d'études au Togo, merci d'avance."],
  );
  F.Q1 = q.rows[0].id;

  const a = await c.query(
    'insert into answers (question_id, user_id, content) values ($1, $2, $3) returning id',
    [F.Q1, U.alice, 'Commence par les sites officiels des universités et des fondations partenaires.'],
  );
  F.A1 = a.rows[0].id;
});

after(async () => {
  await c.end();
});

/* ══════════════════ 1. Inscription et profils ══════════════════ */

test('inscription : compte créé EN ATTENTE tant que l\'e-mail et le téléphone ne sont pas vérifiés', () => tx(async () => {
  const u = freshUser();
  await c.query(SIGNUP, signupParams(u));
  const p = await sql('select username, status from profiles where id = $1', [u.id]);
  assert.equal(p.rows[0].username, u.meta.username);
  assert.equal(p.rows[0].status, 'pending');
  const d = await sql('select phone, phone_verified_at from account_details where user_id = $1', [u.id]);
  assert.equal(d.rows[0].phone, u.phone);
  assert.equal(d.rows[0].phone_verified_at, null, 'le numéro n\'est vérifié qu\'après le code SMS');
  const r = await sql(
    'select r.name from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1', [u.id],
  );
  assert.deepEqual(r.rows.map((x) => x.name), ['member']);
}));

test('pseudo déjà pris, même avec une autre casse : inscription refusée', () => tx(async () => {
  const u = freshUser({ meta: { username: 'BOB_MENSAH' } });
  await failure(SIGNUP, signupParams(u), /Ce pseudo est déjà pris/);
}));

test('pseudo réservé ou trop court : inscription refusée', () => tx(async () => {
  await failure(SIGNUP, signupParams(freshUser({ meta: { username: 'admin' } })), /Pseudo invalide/);
  await failure(SIGNUP, signupParams(freshUser({ meta: { username: 'ab' } })), /Pseudo invalide/);
}));

test('numéro de téléphone sans indicatif : inscription refusée', () => tx(async () => {
  await failure(SIGNUP, signupParams(freshUser({ phone: '90123456' })), /Numéro de téléphone invalide/);
}));

test('conditions d\'utilisation : ancienne version ou absente → inscription refusée', () => tx(async () => {
  await failure(SIGNUP, signupParams(freshUser({ meta: { terms_version: '2020-01-01' } })), /version actuelle/);
  await failure(SIGNUP, signupParams(freshUser({ meta: { terms_version: '' } })), /version actuelle/);
}));

test('prénom ou nom manquant : inscription refusée', () => tx(async () => {
  await failure(SIGNUP, signupParams(freshUser({ meta: { first_name: '' } })), /obligatoires/);
}));

test('un numéro VÉRIFIÉ ne peut appartenir qu\'à un seul compte', () => tx(async () => {
  await sql('update account_details set phone_verified_at = now() where user_id = $1', [U.bob]);
  const u = freshUser();
  await createAccount(u);
  await failure(
    'update account_details set phone = $2, phone_verified_at = now() where user_id = $1',
    [u.id, '+22890000002'],
    /account_phone_verified_key|duplicate key/,
  );
}));

test('visiteur : profils publics lisibles, détails privés inaccessibles', () => tx(async () => {
  await as('anon');
  const p = await sql('select username from profiles where id = $1', [U.bob]);
  assert.equal(p.rows[0].username, 'bob_mensah');
  await failure('select phone from account_details', [], /permission denied/);
}));

test('membre : voit ses propres détails, jamais ceux d\'un autre', () => tx(async () => {
  await as('bob');
  assert.equal(await countOf('select count(*)::int as n from account_details where user_id = $1', [U.alice]), 0);
  assert.equal(await countOf('select count(*)::int as n from account_details where user_id = $1', [U.bob]), 1);
}));

test('membre : ne peut ni changer son statut, ni son téléphone', () => tx(async () => {
  await as('bob');
  await failure('update profiles set status = $2 where id = $1', [U.bob, 'suspended'], /permission denied/);
  await failure('update account_details set phone = $2 where user_id = $1', [U.bob, '+22899999999'], /permission denied/);
}));

test('membre : modifie sa bio, mais pas celle d\'un autre', () => tx(async () => {
  await as('bob');
  const own = await sql('update profiles set bio = $2 where id = $1', [U.bob, 'Étudiant en informatique']);
  assert.equal(own.rowCount, 1);
  const other = await sql('update profiles set bio = $2 where id = $1', [U.alice, 'modification pirate']);
  assert.equal(other.rowCount, 0);
}));

test('modification du pseudo : réservé ou déjà pris → refusé (casse ignorée)', () => tx(async () => {
  await as('bob');
  await failure('update profiles set username = $2 where id = $1', [U.bob, 'support'], /Pseudo invalide/);
  await failure('update profiles set username = $2 where id = $1', [U.bob, 'ALICE_ADMIN'], /déjà pris/);
}));

test('vérification du pseudo : disponible, pris, réservé (serveur uniquement)', () => tx(async () => {
  await as('anon');
  await failure('select username_available($1)', ['nouveau_pseudo'], /permission denied/);
  await as('service');
  assert.equal((await sql('select username_available($1) as ok', ['nouveau_pseudo'])).rows[0].ok, true);
  assert.equal((await sql('select username_available($1) as ok', ['BOB_MENSAH'])).rows[0].ok, false);
  assert.equal((await sql('select username_available($1) as ok', ['admin'])).rows[0].ok, false);
}));

/* ══════════════════ 2. Questions ══════════════════ */

test('visiteur : lit les questions, n\'en publie pas', () => tx(async () => {
  await as('anon');
  assert.equal(await countOf('select count(*)::int as n from questions where id = $1', [F.Q1]), 1);
  await failure(
    'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4)',
    [U.bob, ETUDES, 'Titre de test valide', 'Contenu suffisamment long pour passer la règle.'],
    /permission denied/,
  );
}));

test('membre : publie une question à son nom, avec le statut « ouverte »', () => tx(async () => {
  await as('bob');
  const r = await sql(
    'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4) returning user_id, status',
    [U.bob, ETUDES, 'Quelle formation choisir en informatique ?',
      'Je termine le lycée et je voudrais savoir quelle formation suivre pour devenir développeur.'],
  );
  assert.equal(r.rows[0].user_id, U.bob);
  assert.equal(r.rows[0].status, 'open');
}));

test('membre : impossible de publier au nom d\'un autre', () => tx(async () => {
  await as('bob');
  await failure(
    'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4)',
    [U.alice, ETUDES, 'Titre usurpé de test', 'Contenu usurpé suffisamment long pour passer.'],
    /row-level security/,
  );
}));

test('membre : ne peut pas masquer une question elle-même', () => tx(async () => {
  await as('bob');
  await failure('update questions set is_hidden = true where id = $1', [F.Q1], /permission denied/);
}));

test('membre : ne modifie pas la question d\'un autre (aucune ligne touchée)', () => tx(async () => {
  await as('eve');
  const r = await sql('update questions set title = $2 where id = $1', [F.Q1, 'Titre modifié par Eve']);
  assert.equal(r.rowCount, 0);
  await superuser();
  const now = await sql('select title from questions where id = $1', [F.Q1]);
  assert.equal(now.rows[0].title, "Comment choisir une bourse d'études ?");
}));

test('auteur : modifie sa question, mais ne peut pas en changer l\'auteur', () => tx(async () => {
  await as('bob');
  const r = await sql('update questions set title = $2 where id = $1',
    [F.Q1, "Comment choisir une bourse d'études au Togo ?"]);
  assert.equal(r.rowCount, 1);
  await failure('update questions set user_id = $2 where id = $1', [F.Q1, U.eve], /permission denied/);
}));

test('titre trop court : refusé par la base', () => tx(async () => {
  await as('bob');
  await failure(
    'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4)',
    [U.bob, ETUDES, 'Court', 'Contenu suffisamment long pour passer la règle.'],
    /questions_title_len/,
  );
}));

test('limite anti-spam : 5 questions par heure, la sixième est refusée', () => tx(async () => {
  await as('dave');
  for (let i = 0; i < 5; i++) {
    await sql('insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4)',
      [U.dave, ETUDES, `Question de test numéro ${i + 1}`, 'Contenu suffisamment long pour passer la règle de longueur.']);
  }
  await failure(
    'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4)',
    [U.dave, ETUDES, 'Sixième question de test', 'Contenu suffisamment long pour passer la règle de longueur.'],
    /Tu vas un peu vite/,
  );
}));

test('question masquée par l\'équipe : invisible du public, visible de l\'auteur et du staff', () => tx(async () => {
  await as('alice');
  await sql('select staff_set_hidden($1, $2, true)', ['question', F.Q1]);

  await as('anon');
  assert.equal(await countOf('select count(*)::int as n from questions where id = $1', [F.Q1]), 0);
  await as('bob');
  assert.equal(await countOf('select count(*)::int as n from questions where id = $1', [F.Q1]), 1);
  await as('carol');
  assert.equal(await countOf('select count(*)::int as n from questions where id = $1', [F.Q1]), 1);
}));

test('compte suspendu : contenu invisible du public, plus aucune publication', () => tx(async () => {
  await superuser();
  const dq = await sql(
    'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4) returning id',
    [U.dave, ETUDES, 'Question de Dave avant suspension', 'Contenu suffisamment long pour passer la règle.'],
  );
  await as('alice');
  await sql('select admin_set_account_status($1, $2, $3)', [U.dave, 'suspended', 'test automatisé']);

  await as('anon');
  assert.equal(await countOf('select count(*)::int as n from questions where id = $1', [dq.rows[0].id]), 0);

  await as('dave');
  await failure(
    'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4)',
    [U.dave, ETUDES, 'Question après suspension', 'Contenu suffisamment long pour passer la règle.'],
    /row-level security/,
  );
  const bio = await sql('update profiles set bio = $2 where id = $1', [U.dave, 'Toujours là']);
  assert.equal(bio.rowCount, 0);
}));

test('contenu masqué : son auteur ne peut plus le modifier (aucune ligne touchée)', () => tx(async () => {
  await as('carol');
  await sql('select staff_set_hidden($1, $2, true)', ['question', F.Q1]);
  await as('bob');
  const r = await sql('update questions set title = $2 where id = $1', [F.Q1, 'Titre ajouté après masquage']);
  assert.equal(r.rowCount, 0);
}));

test('suppression : la question emporte réponses, commentaires et réactions', () => tx(async () => {
  await as('bob');
  await sql('delete from questions where id = $1', [F.Q1]);
  await superuser();
  assert.equal(await countOf('select count(*)::int as n from answers where question_id = $1', [F.Q1]), 0);
}));

test('recherche plein texte en français', () => tx(async () => {
  await as('anon');
  const hit = await sql("select id from questions where search_vector @@ websearch_to_tsquery('french', $1)", ['bourse']);
  assert.ok(hit.rows.some((r) => r.id === F.Q1));
  const miss = await sql("select id from questions where search_vector @@ websearch_to_tsquery('french', $1)", ['licorne']);
  assert.equal(miss.rowCount, 0);
}));

/* ══════════════════ 3. Réponses et commentaires ══════════════════ */

test('réponse : possible sur une question ouverte, refusée sur une question fermée', () => tx(async () => {
  await as('eve');
  await sql('insert into answers (question_id, user_id, content) values ($1, $2, $3)',
    [F.Q1, U.eve, 'Regarde les bourses proposées par les fondations universitaires.']);
  await as('bob');
  assert.equal((await sql("update questions set status = 'closed' where id = $1", [F.Q1])).rowCount, 1);
  await as('eve');
  await failure(
    'insert into answers (question_id, user_id, content) values ($1, $2, $3)',
    [F.Q1, U.eve, 'Réponse tardive sur une question fermée.'],
    /row-level security/,
  );
}));

test('image de réponse : seules nos images Cloudinary sont acceptées', () => tx(async () => {
  await as('eve');
  await failure(
    'insert into answers (question_id, user_id, content, image_url) values ($1, $2, $3, $4)',
    [F.Q1, U.eve, 'Une capture utile pour la question.', 'https://evil.example/pixel.png'],
    /answers_image_cloudinary/,
  );
  await sql(
    'insert into answers (question_id, user_id, content, image_url) values ($1, $2, $3, $4)',
    [F.Q1, U.eve, 'Une capture utile pour la question.',
      'https://res.cloudinary.com/dyo3r3lph/image/upload/v1700000000/capture.jpg'],
  );
}));

test('répondre à sa propre question : aucune notification', () => tx(async () => {
  await superuser();
  const before = await countOf('select count(*)::int as n from notifications where user_id = $1', [U.bob]);
  await as('bob');
  await sql('insert into answers (question_id, user_id, content) values ($1, $2, $3)',
    [F.Q1, U.bob, 'Je précise ma question avec un détail utile.']);
  await superuser();
  const after = await countOf('select count(*)::int as n from notifications where user_id = $1', [U.bob]);
  assert.equal(after, before);
}));

test('réponse d\'un autre membre : l\'auteur de la question est notifié', () => tx(async () => {
  await superuser();
  const before = await countOf("select count(*)::int as n from notifications where user_id = $1 and type = 'answer'", [U.bob]);
  await as('eve');
  await sql('insert into answers (question_id, user_id, content) values ($1, $2, $3)',
    [F.Q1, U.eve, 'Regarde les bourses proposées par les universités partenaires.']);
  await superuser();
  const after = await countOf("select count(*)::int as n from notifications where user_id = $1 and type = 'answer'", [U.bob]);
  assert.equal(after - before, 1);
  const link = await sql("select link from notifications where user_id = $1 and type = 'answer' order by created_at desc limit 1", [U.bob]);
  assert.equal(link.rows[0].link, `/?post=${F.Q1}`);
}));

test('réponse : impossible de répondre au nom d\'un autre', () => tx(async () => {
  await as('eve');
  await failure(
    'insert into answers (question_id, user_id, content) values ($1, $2, $3)',
    [F.Q1, U.alice, 'Réponse usurpée à la question.'],
    /row-level security/,
  );
}));

test('commentaire : notifie l\'auteur de la réponse', () => tx(async () => {
  await superuser();
  const before = await countOf("select count(*)::int as n from notifications where user_id = $1 and type = 'comment'", [U.alice]);
  await as('eve');
  await sql('insert into comments (answer_id, user_id, content) values ($1, $2, $3)',
    [F.A1, U.eve, 'Merci pour cette piste utile !']);
  await superuser();
  const after = await countOf("select count(*)::int as n from notifications where user_id = $1 and type = 'comment'", [U.alice]);
  assert.equal(after - before, 1);
}));

test('commentaire : refusé sur une réponse masquée par l\'équipe', () => tx(async () => {
  await as('carol');
  await sql('select staff_set_hidden($1, $2, true)', ['answer', F.A1]);
  await as('eve');
  await failure(
    'insert into comments (answer_id, user_id, content) values ($1, $2, $3)',
    [F.A1, U.eve, 'Commentaire sur une réponse masquée.'],
    /row-level security/,
  );
}));

/* ══════════════════ 4. Réactions ══════════════════ */

test('réaction : possible sur le contenu d\'un autre, refusée sur le sien', () => tx(async () => {
  await as('eve');
  await sql("insert into reactions (user_id, question_id, reaction_type) values ($1, $2, 'like')", [U.eve, F.Q1]);
  await as('bob');
  await failure(
    "insert into reactions (user_id, question_id, reaction_type) values ($1, $2, 'like')",
    [U.bob, F.Q1],
    /row-level security/,
  );
}));

test('réaction : un seul « like » par cible ; une cible exactement', () => tx(async () => {
  await as('eve');
  await sql("insert into reactions (user_id, question_id, reaction_type) values ($1, $2, 'like')", [U.eve, F.Q1]);
  await failure(
    "insert into reactions (user_id, question_id, reaction_type) values ($1, $2, 'like')",
    [U.eve, F.Q1],
    /reactions_question_once/,
  );
  // un autre type sur la même question reste permis
  await sql("insert into reactions (user_id, question_id, reaction_type) values ($1, $2, 'helpful')", [U.eve, F.Q1]);
  await failure(
    "insert into reactions (user_id, question_id, answer_id, reaction_type) values ($1, $2, $3, 'thanks')",
    [U.eve, F.Q1, F.A1],
    /reactions_one_target/,
  );
  await failure(
    "insert into reactions (user_id, reaction_type) values ($1, 'thanks')",
    [U.eve],
    /reactions_one_target|row-level security/,
  );
}));

test('réactions : privées (chacun voit les siennes) ; compteurs publics agrégés', () => tx(async () => {
  // Bob réagit à la réponse d'Alice : une réaction existante, appartenant à un autre membre
  await superuser();
  await sql("insert into reactions (user_id, answer_id, reaction_type) values ($1, $2, 'like')", [U.bob, F.A1]);

  await as('eve');
  await sql("insert into reactions (user_id, question_id, reaction_type) values ($1, $2, 'like')", [U.eve, F.Q1]);
  assert.equal(await countOf('select count(*)::int as n from reactions where user_id = $1', [U.bob]), 0);
  assert.equal(await countOf('select count(*)::int as n from reactions where user_id <> $1', [U.eve]), 0,
    'Eve ne voit aucune réaction des autres membres');

  await as('anon');
  const stats = await sql('select likes from question_stats where question_id = $1', [F.Q1]);
  assert.equal(Number(stats.rows[0].likes), 1);
  await failure('select id from reactions', [], /permission denied/);
}));

test('réaction : l\'auteur du contenu est notifié', () => tx(async () => {
  await superuser();
  const before = await countOf("select count(*)::int as n from notifications where user_id = $1 and type = 'reaction'", [U.bob]);
  await as('eve');
  await sql("insert into reactions (user_id, question_id, reaction_type) values ($1, $2, 'like')", [U.eve, F.Q1]);
  await superuser();
  const after = await countOf("select count(*)::int as n from notifications where user_id = $1 and type = 'reaction'", [U.bob]);
  assert.equal(after - before, 1);
}));

/* ══════════════════ 5. Notifications ══════════════════ */

test('notifications : chacun lit les siennes, n\'en crée pas, ne réécrit que « lue »', () => tx(async () => {
  await as('eve');
  const mine = await sql('select user_id from notifications');
  assert.ok(mine.rows.every((r) => r.user_id === U.eve));
  await failure(
    'insert into notifications (user_id, type, title, message) values ($1, $2, $3, $4)',
    [U.eve, 'system', 'Faux message', 'Contenu'],
    /permission denied/,
  );
  await failure('update notifications set title = $1', ['Titre piraté'], /permission denied/);
}));

test('notifications : marquer comme lue, uniquement les siennes', () => tx(async () => {
  await as('bob');
  const own = await sql('update notifications set is_read = true where user_id = $1', [U.bob]);
  assert.ok(own.rowCount >= 1);
  await as('eve');
  const other = await sql('update notifications set is_read = true where user_id = $1', [U.bob]);
  assert.equal(other.rowCount, 0);
}));

test('notification : lien externe ou protocole relatif refusé', () => tx(async () => {
  await failure(
    'insert into notifications (user_id, type, title, message, link) values ($1, $2, $3, $4, $5)',
    [U.bob, 'system', 'Test', 'Message', 'https://evil.example'],
    /notifications_link_internal/,
  );
  await failure(
    'insert into notifications (user_id, type, title, message, link) values ($1, $2, $3, $4, $5)',
    [U.bob, 'system', 'Test', 'Message', '//evil.example'],
    /notifications_link_internal/,
  );
}));

/* ══════════════════ 6. Signalements et modération ══════════════════ */

test('signalement : auteur signalé déduit par la base ; ni propre contenu, ni doublon', () => tx(async () => {
  await as('eve');
  await sql('insert into reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4)',
    [U.eve, 'question', F.Q1, 'Contenu hors sujet pour le forum']);
  await superuser();
  const r = await sql('select reported_user_id from reports where reporter_id = $1 and target_id = $2', [U.eve, F.Q1]);
  assert.equal(r.rows[0].reported_user_id, U.bob);

  await as('bob');
  await failure(
    'insert into reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4)',
    [U.bob, 'question', F.Q1, 'Je signale mon propre contenu'],
    /propre contenu/,
  );
  await as('eve');
  await failure(
    'insert into reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4)',
    [U.eve, 'question', F.Q1, 'Encore le même contenu'],
    /déjà signalé/,
  );
}));

test('signalements : visibles du signalant et de l\'équipe ; traitement réservé à l\'équipe', () => tx(async () => {
  await as('eve');
  const rep = await sql(
    'insert into reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4) returning id',
    [U.eve, 'question', F.Q1, 'Contenu hors sujet pour le forum'],
  );
  await as('bob');
  assert.equal((await sql('select id from reports')).rowCount, 0);
  await as('carol');
  assert.ok((await sql('select id from reports')).rowCount >= 1);
  await as('eve');
  await failure('select staff_resolve_report($1, $2)', [rep.rows[0].id, 'hide'], /Réservé/);
}));

test('modératrice : masque le contenu, clôt le signalement, prévient le signalant', () => tx(async () => {
  await as('eve');
  const rep = await sql(
    'insert into reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4) returning id',
    [U.eve, 'question', F.Q1, 'Contenu hors sujet pour le forum'],
  );
  await as('carol');
  await sql('select staff_resolve_report($1, $2)', [rep.rows[0].id, 'hide']);

  await as('anon');
  assert.equal(await countOf('select count(*)::int as n from questions where id = $1', [F.Q1]), 0);

  await superuser();
  const st = await sql('select status, handled_by from reports where id = $1', [rep.rows[0].id]);
  assert.equal(st.rows[0].status, 'resolved');
  assert.equal(st.rows[0].handled_by, U.carol);
  assert.equal(await countOf("select count(*)::int as n from notifications where user_id = $1 and type = 'report'", [U.eve]), 1);

  await as('carol');
  await failure('select staff_resolve_report($1, $2)', [rep.rows[0].id, 'dismiss'], /déjà été traité/);
}));

test('limite anti-spam : 10 signalements par heure, le onzième est refusé', () => tx(async () => {
  await superuser();
  // Données de test : on désactive temporairement les déclencheurs pour créer 11 questions d'un coup
  await c.query('set local session_replication_role = replica');
  const ids = [];
  for (let i = 0; i < 11; i++) {
    const q = await sql(
      'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4) returning id',
      [U.bob, ETUDES, `Question à signaler numéro ${i + 1}`, 'Contenu suffisamment long pour passer la règle de longueur.'],
    );
    ids.push(q.rows[0].id);
  }
  await c.query('set local session_replication_role = origin');

  await as('dave');
  for (const id of ids.slice(0, 10)) {
    await sql('insert into reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4)',
      [U.dave, 'question', id, 'Contenu hors sujet pour le forum']);
  }
  await failure(
    'insert into reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4)',
    [U.dave, 'question', ids[10], 'Contenu hors sujet pour le forum'],
    /Tu vas un peu vite/,
  );
}));

/* ══════════════════ 7. Rôles, administration, journal ══════════════════ */

test('rôles : un membre ne s\'attribue rien ; seul un administrateur accorde un rôle', () => tx(async () => {
  await as('bob');
  await failure('insert into user_roles (user_id, role_id) values ($1, $2)', [U.bob, 2], /permission denied/);
  await failure('select admin_set_role($1, $2, $3)', [U.bob, 'moderator', true], /Réservé aux administrateurs/);

  await as('alice');
  await sql('select admin_set_role($1, $2, $3)', [U.eve, 'moderator', true]);
  await as('eve');
  const s = await sql('select admin_stats() as s');
  assert.ok(s.rows[0].s.members_active >= 1, 'un modérateur accède aux statistiques');
}));

test('administrateur : impossible de retirer le dernier administrateur', () => tx(async () => {
  await as('alice');
  await failure('select admin_set_role($1, $2, $3)', [U.alice, 'admin', false], /dernier administrateur/);
}));

test('administrateur : ne modifie pas son propre statut', () => tx(async () => {
  await as('alice');
  await failure('select admin_set_account_status($1, $2, $3)', [U.alice, 'suspended', null], /propre statut/);
}));

test('statistiques et journal de sécurité : réservés à l\'équipe', () => tx(async () => {
  await as('eve');
  await failure('select admin_stats()', [], /Réservé/);
  assert.equal((await sql('select id from security_events')).rowCount, 0);
  await as('alice');
  assert.ok((await sql('select id from security_events')).rowCount >= 1);
}));

test('catégories : seul un administrateur en crée une', () => tx(async () => {
  await as('bob');
  await failure('insert into categories (name, slug) values ($1, $2)', ['Sport', 'sport'], /row-level security/);
  await as('alice');
  await sql('insert into categories (name, slug) values ($1, $2)', ['Sport', 'sport']);
}));

test('paramètres : publics visibles de tous, privés réservés à l\'équipe', () => tx(async () => {
  await superuser();
  await sql("insert into platform_settings (key, value, is_public) values ('limite_secrete', '42', false)");
  await as('anon');
  const visible = await sql('select key from platform_settings');
  assert.ok(visible.rows.some((r) => r.key === 'terms_version'));
  assert.ok(!visible.rows.some((r) => r.key === 'limite_secrete'));
  await as('bob');
  await failure("insert into platform_settings (key, value) values ('x', '1')", [], /row-level security/);
}));

test('fonctions d\'administration : même l\'appel est refusé au visiteur', () => tx(async () => {
  await as('anon');
  await failure('select admin_stats()', [], /permission denied/);
  await failure('select admin_set_role($1, $2, $3)', [U.eve, 'admin', true], /permission denied/);
}));

/* ══════════════════ 8. Accueil : chiffres réels ══════════════════ */

test('accueil : les chiffres excluent les comptes suspendus', () => tx(async () => {
  await as('anon');
  const avant = (await sql('select public_stats() as s')).rows[0].s.members;
  await as('alice');
  await sql('select admin_set_account_status($1, $2, $3)', [U.dave, 'suspended', 'test automatisé']);
  await as('anon');
  const apres = (await sql('select public_stats() as s')).rows[0].s.members;
  assert.equal(apres, avant - 1);
}));

/* ══════════════════ 9. Audit des droits (filet de sécurité contre les régressions) ══════════════════ */

test('audit : le visiteur ne peut rien écrire, et n\'exécute que les fonctions prévues', () => tx(async () => {
  await superuser();

  const writes = await sql(`
    select table_name, privilege_type
    from information_schema.role_table_grants
    where grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`);
  assert.equal(writes.rowCount, 0, `droits d'écriture trouvés pour le visiteur : ${JSON.stringify(writes.rows)}`);

  const executable = await sql(`
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
    order by p.proname`);
  assert.deepEqual(
    executable.rows.map((r) => r.proname),
    ['has_role', 'is_active', 'is_admin', 'is_author_active', 'is_staff', 'public_stats',
      'username_is_valid'],
    'seules les fonctions de lecture publique et les aides de RLS doivent être exécutables par le visiteur',
  );
}));
