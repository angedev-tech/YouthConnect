import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  publicConfig, emailConfig, resendApiKey, hookSecretKey, ipHashSecret,
  parseFrom, parseAppUrl, parseSupabaseUrl,
} from '../../lib/env.js';

const PUBLISHABLE = 'sb_publishable_ABCDEFGH12345678';
const SECRET = 'sb_secret_ZYXWVUTS87654321';
const HOOK = `v1,whsec_${crypto.randomBytes(24).toString('base64')}`;

const base = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  EMAIL_FROM: 'YouthConnect <onboarding@resend.dev>',
  APP_URL: 'https://youthconnect-test.vercel.app',
  VERCEL_ENV: 'preview',
};

test('configuration publique : adresse et clé publiable seulement', () => {
  const cfg = publicConfig(base);
  assert.deepEqual(Object.keys(cfg).sort(), ['environment', 'supabasePublishableKey', 'supabaseUrl']);
  assert.equal(cfg.supabaseUrl, 'https://abcdefgh.supabase.co');
  assert.equal(cfg.environment, 'preview');
});

test('configuration publique : une clé secrète dans la variable publique est refusée', () => {
  assert.throws(() => publicConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: SECRET }), /SECRÈTE/);
});

test('adresse Supabase : https obligatoire, sans chemin', () => {
  assert.equal(parseSupabaseUrl('https://abcdefgh.supabase.co/'), 'https://abcdefgh.supabase.co');
  assert.throws(() => parseSupabaseUrl('http://abcdefgh.supabase.co'), /https/);
  assert.throws(() => parseSupabaseUrl('https://abcdefgh.supabase.co/rest/v1'), /sans chemin/);
  assert.equal(parseSupabaseUrl('http://localhost:54321'), 'http://localhost:54321');
});

test('expéditeur : formes « Nom <adresse> » et « adresse » ; forme invalide refusée', () => {
  assert.equal(parseFrom('YouthConnect <no-reply@mail.exemple.fr>').domain, 'mail.exemple.fr');
  assert.equal(parseFrom('no-reply@Mail.Exemple.fr').domain, 'mail.exemple.fr');
  assert.throws(() => parseFrom('pas une adresse'), /EMAIL_FROM/);
  assert.throws(() => parseFrom('Nom <a@b>'), /EMAIL_FROM/);
});

test('domaine de test resend.dev : accepté en preview, refusé en production', () => {
  const preview = emailConfig(base);
  assert.equal(preview.sandbox, true);
  assert.throws(
    () => emailConfig({ ...base, VERCEL_ENV: 'production', APP_URL: 'https://youthconnect.exemple.fr' }),
    /interdit en production/,
  );
});

test('un domaine réel est accepté en production et marqué comme non-test', () => {
  const cfg = emailConfig({
    ...base,
    VERCEL_ENV: 'production',
    EMAIL_FROM: 'YouthConnect <no-reply@mail.exemple.fr>',
    APP_URL: 'https://youthconnect.exemple.fr',
  });
  assert.equal(cfg.sandbox, false);
  assert.equal(cfg.fromDomain, 'mail.exemple.fr');
  assert.equal(cfg.appUrl, 'https://youthconnect.exemple.fr');
});

test('adresse du site : https obligatoire en production, sans chemin ni paramètres', () => {
  assert.throws(() => parseAppUrl('http://youthconnect.exemple.fr', { VERCEL_ENV: 'production' }), /https/);
  assert.throws(() => parseAppUrl('https://exemple.fr/chemin', {}), /sans chemin/);
  assert.throws(() => parseAppUrl('https://exemple.fr/?x=1', {}), /sans chemin/);
  assert.equal(parseAppUrl('http://localhost:3000', {}), 'http://localhost:3000');
});

test('clé Resend : doit commencer par re_', () => {
  assert.equal(resendApiKey({ RESEND_API_KEY: 're_abcdefghij1234' }), 're_abcdefghij1234');
  assert.throws(() => resendApiKey({ RESEND_API_KEY: 'sk_abcdefghij1234' }), /re_/);
  assert.throws(() => resendApiKey({}), /manquante/);
});

test('secret du hook : formes « v1,whsec_… » et « whsec_… » acceptées', () => {
  assert.equal(hookSecretKey({ SEND_EMAIL_HOOK_SECRET: HOOK }).length, 24);
  assert.deepEqual(
    hookSecretKey({ SEND_EMAIL_HOOK_SECRET: HOOK.slice(3) }),
    hookSecretKey({ SEND_EMAIL_HOOK_SECRET: HOOK }),
  );
  assert.throws(() => hookSecretKey({ SEND_EMAIL_HOOK_SECRET: 'abc' }), /whsec_/);
});

test('clé de hachage des adresses IP : au moins 32 caractères', () => {
  assert.throws(() => ipHashSecret({ IP_HASH_SECRET: 'trop-court' }), /32 caractères/);
  assert.equal(ipHashSecret({ IP_HASH_SECRET: 'x'.repeat(32) }).length, 32);
});

test('une variable manquante produit un message clair, sans valeur', () => {
  assert.throws(() => emailConfig({ APP_URL: 'https://a.fr' }), /EMAIL_FROM manquante/);
});
