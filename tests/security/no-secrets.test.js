// Garde-fou : ce test échoue si une clé secrète, un secret de webhook ou une clé API serveur
// se trouve dans un fichier servi au navigateur, ou si un fichier de secrets peut être publié.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSecretMaterial } from '../../lib/keys.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Tout ce que le navigateur peut télécharger
const PUBLIC_FILES = ['index.html', 'script.js', 'style.css', 'sw.js', 'manifest.json'];

function publicTextFiles() {
  const files = PUBLIC_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  for (const dir of ['js', 'auth']) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { recursive: true })) {
      const file = path.join(full, String(entry));
      if (fs.statSync(file).isFile() && /\.(js|mjs|html|css|json)$/.test(file)) files.push(file);
    }
  }
  const publicDir = path.join(ROOT, 'public');
  if (fs.existsSync(publicDir)) {
    for (const entry of fs.readdirSync(publicDir, { recursive: true })) {
      const full = path.join(publicDir, String(entry));
      if (fs.statSync(full).isFile() && /\.(js|mjs|html|css|json|txt)$/.test(full)) files.push(full);
    }
  }
  return files;
}

test('aucun matériel secret dans les fichiers servis au navigateur', () => {
  const files = publicTextFiles();
  assert.ok(files.length >= 10, 'les fichiers du site et du navigateur doivent être analysés');
  for (const file of files) {
    const findings = findSecretMaterial(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(
      findings.map((f) => f.kind),
      [],
      `${path.relative(ROOT, file)} contient du matériel secret (valeur non affichée)`,
    );
  }
});

test('le fichier .env (vraies valeurs) est ignoré par Git', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(ignore.includes('.env'), '.env doit être ignoré');
  assert.ok(ignore.includes('.env.*'), '.env.* doit être ignoré');
  assert.ok(ignore.includes('!.env.example'), '.env.example doit rester suivi');
});

test('.env.example ne contient que des emplacements, jamais de vraie valeur', () => {
  const example = path.join(ROOT, '.env.example');
  assert.ok(fs.existsSync(example), '.env.example doit exister');
  const text = fs.readFileSync(example, 'utf8');
  // Les NOMS des variables serveur sont attendus ici ; seules les VALEURS réelles sont interdites
  const values = findSecretMaterial(text).filter((f) => !f.kind.startsWith('nom de variable'));
  assert.deepEqual(values.map((f) => f.kind), []);
});

test('aucune clé secrète n\'est écrite dans le code du site ni dans les fonctions (sauf lecture de variables)', () => {
  const apiDir = path.join(ROOT, 'api');
  for (const entry of fs.readdirSync(apiDir, { recursive: true })) {
    const full = path.join(apiDir, String(entry));
    if (!fs.statSync(full).isFile()) continue;
    const text = fs.readFileSync(full, 'utf8');
    assert.doesNotMatch(text, /sb_secret_[A-Za-z0-9_-]{8,}/, `${entry} contient une clé secrète en dur`);
    assert.doesNotMatch(text, /\bre_[A-Za-z0-9_]{16,}/, `${entry} contient une clé Resend en dur`);
  }
});
