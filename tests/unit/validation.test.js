import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUsername, validateEmail, buildPhone, validatePassword, validatePasswordConfirmation,
  validateSignup, COUNTRY_CODES,
} from '../../js/validation.js';
import { messageForAuthError, GENERIC_MESSAGE } from '../../js/messages.js';
import { parseAuthLinkParams } from '../../js/auth-links.js';

test('pseudo : 3 à 30 caractères, sans accent ni espace, réservés refusés', () => {
  assert.equal(validateUsername('amina_2026').ok, true);
  assert.equal(validateUsername('ab').ok, false);
  assert.equal(validateUsername('a'.repeat(31)).ok, false);
  assert.equal(validateUsername('amina koné').ok, false);
  assert.equal(validateUsername('amïna').ok, false);
  assert.equal(validateUsername('Admin').ok, false, 'réservé, casse ignorée');
  assert.equal(validateUsername('support').ok, false);
});

test('e-mail : format vérifié, mis en minuscules', () => {
  assert.deepEqual(validateEmail('  Amina@Exemple.FR '), { ok: true, value: 'amina@exemple.fr' });
  assert.equal(validateEmail('pas-une-adresse').ok, false);
  assert.equal(validateEmail('a@b').ok, false);
  assert.equal(validateEmail('a b@exemple.fr').ok, false);
});

test('téléphone : indicatif + numéro local, format international exigé', () => {
  assert.deepEqual(buildPhone('+228', '90 12 34 56'), { ok: true, value: '+22890123456' });
  assert.equal(buildPhone('+228', '').ok, false, 'obligatoire');
  assert.equal(buildPhone('+228', '90123abc').ok, false, 'chiffres seulement');
  assert.equal(buildPhone('+228', '090123456').ok, false, 'sans le 0 initial');
  assert.equal(buildPhone('+228', '123').ok, false, 'trop court');
  assert.ok(COUNTRY_CODES.some((c) => c.code === '+228'), 'le Togo est proposé');
});

test('mot de passe : 10 caractères minimum, pas l\'adresse e-mail, 72 octets maximum', () => {
  assert.equal(validatePassword('court').ok, false);
  assert.equal(validatePassword('motdepasse1').ok, true);
  assert.equal(validatePassword('amina@exemple.fr', 'amina@exemple.fr').ok, false);
  assert.equal(validatePassword('é'.repeat(40)).ok, false, '80 octets : trop long');
});

test('confirmation du mot de passe', () => {
  assert.equal(validatePasswordConfirmation('motdepasse1', 'motdepasse1').ok, true);
  assert.equal(validatePasswordConfirmation('motdepasse1', 'autre').ok, false);
});

const formulaireValide = {
  username: 'amina_2026', firstName: 'Amina', lastName: 'Koné', email: 'amina@exemple.fr',
  countryCode: '+228', localPhone: '90123456', password: 'motdepasse1', passwordConfirmation: 'motdepasse1',
  termsAccepted: true,
};

test('formulaire complet valide : valeurs normalisées', () => {
  const r = validateSignup(formulaireValide);
  assert.equal(r.ok, true);
  assert.equal(r.values.phone, '+22890123456');
  assert.equal(r.values.email, 'amina@exemple.fr');
});

test('formulaire : chaque erreur est signalée sur son champ, CGU obligatoires', () => {
  const r = validateSignup({ ...formulaireValide, username: 'a', termsAccepted: false, localPhone: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.username && r.errors.terms && r.errors.phone);
  assert.equal(r.errors.email, undefined);
});

test('messages : codes connus traduits, code inconnu → message générique', () => {
  assert.equal(messageForAuthError({ code: 'invalid_credentials' }), 'Identifiants incorrects.');
  assert.match(messageForAuthError({ code: 'over_email_send_rate_limit' }), /Trop d'e-mails/);
  assert.equal(messageForAuthError({ code: 'code_inconnu_xyz' }), GENERIC_MESSAGE);
  assert.equal(messageForAuthError({ status: 429 }).startsWith('Trop de tentatives'), true);
});

test('messages : aucun message ne révèle si une adresse existe', () => {
  assert.doesNotMatch(messageForAuthError({ code: 'user_not_found' }), /introuvable|n'existe/);
});

test('liens e-mail : jeton et type acceptés seulement dans le bon format', () => {
  const hash = 'a'.repeat(64);
  assert.deepEqual(parseAuthLinkParams(`?token_hash=${hash}&type=signup`, ['signup']), { tokenHash: hash, type: 'signup' });
  assert.throws(() => parseAuthLinkParams(`?token_hash=${hash}&type=recovery`, ['signup']), /invalide/);
  assert.throws(() => parseAuthLinkParams('?token_hash=<script>&type=signup', ['signup']), /invalide/);
  assert.throws(() => parseAuthLinkParams('', ['signup']), /invalide/);
});
