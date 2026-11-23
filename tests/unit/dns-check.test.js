import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEmailDns } from '../../lib/email/dns-check.js';

const DOMAIN = 'mail.exemple.fr';

/** Faux résolveur : les noms absents lèvent ENODATA, comme le vrai DNS. */
function resolverWith(records = {}) {
  const missing = () => Object.assign(new Error('ENODATA'), { code: 'ENODATA' });
  return {
    resolveTxt: async (host) => {
      if (!(host in (records.txt ?? {}))) throw missing();
      return records.txt[host];
    },
    resolveMx: async (host) => {
      if (!(host in (records.mx ?? {}))) throw missing();
      return records.mx[host];
    },
    resolveCname: async (host) => {
      if (!(host in (records.cname ?? {}))) throw missing();
      return records.cname[host];
    },
  };
}

const byCheck = (results) => Object.fromEntries(results.map((r) => [r.check, r]));

test('tous les enregistrements présents : tout est ok', async () => {
  const resolver = resolverWith({
    txt: {
      [`resend._domainkey.${DOMAIN}`]: [['p=MIGfMA0GCSqGSIb3DQEBAQUAA4']],
      [`send.${DOMAIN}`]: [['v=spf1 include:amazonses.com ~all']],
      [`_dmarc.${DOMAIN}`]: [['v=DMARC1; p=none; rua=mailto:dmarc@exemple.fr']],
    },
    mx: { [`send.${DOMAIN}`]: [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com.', priority: 10 }] },
  });
  const r = byCheck(await checkEmailDns(DOMAIN, resolver));
  assert.equal(r.DKIM.status, 'ok');
  assert.equal(r.SPF.status, 'ok');
  assert.equal(r['MX de rebond'].status, 'ok');
  assert.equal(r.DMARC.status, 'ok');
  assert.match(r.DMARC.detail, /politique : none/);
});

test('rien de configuré : chaque enregistrement est signalé absent', async () => {
  const results = await checkEmailDns(DOMAIN, resolverWith());
  assert.deepEqual(results.map((r) => r.status), ['absent', 'absent', 'absent', 'absent']);
});

test('DKIM en CNAME (accepté) ; MX vers un autre serveur refusé', async () => {
  const resolver = resolverWith({
    cname: { [`resend._domainkey.${DOMAIN}`]: ['resend._domainkey.resend.example'] },
    mx: { [`send.${DOMAIN}`]: [{ exchange: 'mx.autre-fournisseur.example.', priority: 10 }] },
  });
  const r = byCheck(await checkEmailDns(DOMAIN, resolver));
  assert.equal(r.DKIM.status, 'ok');
  assert.match(r.DKIM.detail, /CNAME/);
  assert.equal(r['MX de rebond'].status, 'absent');
});

test('DMARC : la politique est lue (none, quarantine, reject)', async () => {
  for (const policy of ['quarantine', 'reject']) {
    const resolver = resolverWith({ txt: { [`_dmarc.${DOMAIN}`]: [[`v=DMARC1; p=${policy}`]] } });
    const r = byCheck(await checkEmailDns(DOMAIN, resolver));
    assert.match(r.DMARC.detail, new RegExp(`politique : ${policy}`));
  }
});

test('un SPF qui n\'est pas le sien n\'est pas accepté comme valide', async () => {
  const resolver = resolverWith({ txt: { [`send.${DOMAIN}`]: [['google-site-verification=abc']] } });
  const r = byCheck(await checkEmailDns(DOMAIN, resolver));
  assert.equal(r.SPF.status, 'absent');
});

test('erreur DNS inattendue : remontée, pas avalée', async () => {
  const resolver = resolverWith();
  resolver.resolveTxt = async () => {
    throw Object.assign(new Error('panne'), { code: 'EFORMERR_INCONNU' });
  };
  await assert.rejects(checkEmailDns(DOMAIN, resolver), /panne/);
});
