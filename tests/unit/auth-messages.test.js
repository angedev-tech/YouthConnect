import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthMessages, validateHookPayload, InvalidAuthPayload, UnsupportedAuthEmail } from '../../lib/email/auth-messages.js';
import { renderEmail, escapeHtml, authLink } from '../../lib/email/templates.js';

const APP = 'https://youthconnect.exemple.fr';
const HASH = 'f'.repeat(64);
const HASH_NEW = 'e'.repeat(64);
const payload = (action, extraUser = {}, extraData = {}) => ({
  user: { email: 'amina@exemple.fr', ...extraUser },
  email_data: { email_action_type: action, token_hash: HASH, token: '123456', redirect_to: APP, site_url: APP, ...extraData },
});

test('confirmation d\'inscription : un message à l\'adresse de la charge, lien vers /auth/confirm', () => {
  const [msg] = buildAuthMessages(payload('signup'), { appUrl: APP });
  assert.equal(msg.to, 'amina@exemple.fr');
  assert.match(msg.subject, /Confirme ton adresse/);
  assert.ok(msg.html.includes(`${APP}/auth/confirm?token_hash=${HASH}&amp;type=signup`), 'lien dans le HTML');
  assert.ok(msg.text.includes(`${APP}/auth/confirm?token_hash=${HASH}&type=signup`), 'lien dans le texte');
});

test('réinitialisation : lien vers /auth/reset-password, type recovery', () => {
  const [msg] = buildAuthMessages(payload('recovery'), { appUrl: APP });
  assert.match(msg.text, new RegExp(`${APP.replace(/\./g, '\\.')}/auth/reset-password\\?token_hash=${HASH}&type=recovery`));
  assert.match(msg.subject, /Réinitialise ton mot de passe/);
});

test('changement d\'adresse sécurisé : deux messages, chacun vers la bonne adresse avec le bon jeton', () => {
  const data = payload('email_change', { new_email: 'nouvelle@exemple.fr' }, { token_hash_new: HASH_NEW });
  const messages = buildAuthMessages(data, { appUrl: APP });
  assert.equal(messages.length, 2);
  // Adresse actuelle : jeton « _new » (règle de la documentation Supabase)
  assert.equal(messages[0].to, 'amina@exemple.fr');
  assert.ok(messages[0].text.includes(`token_hash=${HASH_NEW}`));
  // Nouvelle adresse : jeton simple
  assert.equal(messages[1].to, 'nouvelle@exemple.fr');
  assert.ok(messages[1].text.includes(`token_hash=${HASH}`));
});

test('changement d\'adresse : sans nouvelle adresse, aucun lien n\'est envoyé à l\'ancienne', () => {
  assert.throws(() => buildAuthMessages(payload('email_change'), { appUrl: APP }), InvalidAuthPayload);
});

test('types non prévus refusés (aucun envoi silencieux)', () => {
  for (const action of ['magiclink', 'invite', 'email', 'nouveau_type_inconnu']) {
    assert.throws(() => buildAuthMessages(payload(action), { appUrl: APP }), UnsupportedAuthEmail, action);
  }
});

test('jeton mal formé refusé avant d\'entrer dans une URL', () => {
  const bad = payload('signup', {}, { token_hash: '"><script>alert(1)</script>' });
  assert.throws(() => validateHookPayload(bad), /token_hash mal formé/);
});

test('adresse de destination invalide refusée', () => {
  assert.throws(() => buildAuthMessages({ user: { email: 'pas-une-adresse' }, email_data: { email_action_type: 'signup', token_hash: HASH } }, { appUrl: APP }), InvalidAuthPayload);
});

test('échappement : aucune donnée ne peut injecter de balise dans le HTML', () => {
  assert.equal(escapeHtml('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  const msg = renderEmail({ subject: 'S', heading: '<img src=x onerror=alert(1)>', paragraphs: ['<script>bad()</script>'] });
  assert.doesNotMatch(msg.html, /<script>|<img src=x/);
  assert.match(msg.html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
});

test('lien : paramètres encodés (pas de contournement par caractères spéciaux)', () => {
  const url = authLink(APP, '/auth/confirm', HASH, 'signup&evil=1');
  assert.equal(url, `${APP}/auth/confirm?token_hash=${HASH}&type=signup%26evil%3D1`);
});

test('gabarit : aucune image externe, identité YouthConnect présente', () => {
  const [msg] = buildAuthMessages(payload('recovery'), { appUrl: APP });
  assert.doesNotMatch(msg.html, /<img\b/i, 'pas d\'image (pas de suivi des lecteurs)');
  assert.match(msg.html, /YouthConnect/);
  assert.match(msg.html, /lang="fr"/);
});

/* ── Reconfirmation par code et notifications de sécurité ── */

test('reconfirmation : le code à 6 chiffres est dans le message, sans lien', () => {
  const [msg] = buildAuthMessages({ user: { email: 'amina@exemple.fr' }, email_data: { email_action_type: 'reauthentication', token: '482913' } }, { appUrl: APP });
  assert.equal(msg.to, 'amina@exemple.fr');
  assert.match(msg.text, /Code : 482913/);
  assert.doesNotMatch(msg.html, /href=/, 'pas de lien : un code');
});

test('reconfirmation : code absent ou non numérique refusé', () => {
  for (const token of [undefined, '', '12ab56', '<script>']) {
    assert.throws(
      () => buildAuthMessages({ user: { email: 'amina@exemple.fr' }, email_data: { email_action_type: 'reauthentication', token } }, { appUrl: APP }),
      InvalidAuthPayload,
      String(token),
    );
  }
});

test('notification de changement de mot de passe : à l\'adresse du compte, sans lien', () => {
  const [msg] = buildAuthMessages({ user: { email: 'amina@exemple.fr' }, email_data: { email_action_type: 'password_changed_notification' } }, { appUrl: APP });
  assert.equal(msg.to, 'amina@exemple.fr');
  assert.match(msg.subject, /mot de passe a été modifié/);
  assert.doesNotMatch(msg.html, /href=/);
});

test('notification de changement d\'adresse : envoyée à l\'ANCIENNE adresse (old_email)', () => {
  const [msg] = buildAuthMessages({
    user: { email: 'nouvelle@exemple.fr' },
    email_data: { email_action_type: 'email_changed_notification', old_email: 'amina@exemple.fr' },
  }, { appUrl: APP });
  assert.equal(msg.to, 'amina@exemple.fr', 'jamais à la nouvelle adresse seule');
  assert.match(msg.subject, /adresse e-mail a été modifiée/);
});

test('notification de changement d\'adresse : sans ancienne adresse, refusée', () => {
  assert.throws(
    () => buildAuthMessages({ user: { email: 'nouvelle@exemple.fr' }, email_data: { email_action_type: 'email_changed_notification' } }, { appUrl: APP }),
    InvalidAuthPayload,
  );
});

test('les autres notifications Supabase (téléphone, MFA, identités) restent refusées', () => {
  for (const action of ['phone_changed_notification', 'mfa_factor_enrolled_notification', 'identity_linked_notification']) {
    assert.throws(
      () => buildAuthMessages({ user: { email: 'amina@exemple.fr' }, email_data: { email_action_type: action } }, { appUrl: APP }),
      UnsupportedAuthEmail,
      action,
    );
  }
});
