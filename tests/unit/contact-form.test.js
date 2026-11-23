// Décision D5 : le formulaire de contact informe sur Formspree et exige un consentement avant l'envoi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const form = html.slice(html.indexOf('action="https://formspree.io/f/'), html.indexOf('</form>', html.indexOf('action="https://formspree.io/f/')));

test('contact : l\'information sur le traitement par Formspree est présente avant le bouton', () => {
  assert.match(form, /traité par\s+Formspree, un service externe/);
  assert.ok(form.indexOf('Formspree') < form.indexOf('type="submit"'), 'l\'information est lue avant l\'envoi');
});

test('contact : la case de consentement est obligatoire (envoi impossible sans elle)', () => {
  const box = form.match(/<input type="checkbox" name="consentement"[^>]*>/);
  assert.ok(box, 'la case de consentement existe');
  assert.match(box[0], /\srequired[\s>]/, 'la case est obligatoire');
});

test('contact : le message ne part pas sans les champs obligatoires', () => {
  for (const name of ['prenom', 'email', 'sujet', 'message']) {
    assert.match(form, new RegExp(`name="${name}"[^>]*required`), `${name} est obligatoire`);
  }
});
