// lib/email/dns-check.js — vérifie les enregistrements DNS d'envoi d'un domaine.
//
// Le résolveur est injecté (dns.promises en production, une fausse version en test).
// Les noms suivent la configuration par défaut de Resend : SPF et MX de rebond sur « send.<domaine> »,
// DKIM sur « resend._domainkey.<domaine> ». Si Resend t'affiche d'autres noms ou valeurs,
// c'est sa page Records qui fait foi.

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED']);

async function txt(resolver, host) {
  try {
    return (await resolver.resolveTxt(host)).map((chunks) => chunks.join(''));
  } catch (err) {
    if (NOT_FOUND.has(err?.code)) return [];
    throw err;
  }
}

async function mx(resolver, host) {
  try {
    return (await resolver.resolveMx(host)).map((r) => r.exchange.replace(/\.$/, '').toLowerCase());
  } catch (err) {
    if (NOT_FOUND.has(err?.code)) return [];
    throw err;
  }
}

async function cname(resolver, host) {
  try {
    return await resolver.resolveCname(host);
  } catch (err) {
    if (NOT_FOUND.has(err?.code)) return [];
    throw err;
  }
}

/**
 * @returns {Promise<Array<{check: string, host: string, status: 'ok'|'absent', detail: string}>>}
 */
export async function checkEmailDns(domain, resolver) {
  const clean = domain.trim().toLowerCase().replace(/\.$/, '');
  const sendHost = `send.${clean}`;
  const dkimHost = `resend._domainkey.${clean}`;
  const dmarcHost = `_dmarc.${clean}`;
  const results = [];

  // DKIM : signature publique de tes e-mails (enregistrement TXT, parfois CNAME)
  const dkimTxt = await txt(resolver, dkimHost);
  const dkimOk = dkimTxt.some((t) => /v=DKIM1|p=/.test(t));
  const dkimCname = dkimOk ? [] : await cname(resolver, dkimHost);
  results.push({
    check: 'DKIM',
    host: dkimHost,
    status: dkimOk || dkimCname.length > 0 ? 'ok' : 'absent',
    detail: dkimOk ? 'clé publique présente' : dkimCname.length ? 'CNAME présent' : 'enregistrement absent',
  });

  // SPF : liste les serveurs autorisés à envoyer pour ton domaine
  const spfTxt = await txt(resolver, sendHost);
  const spfOk = spfTxt.some((t) => /^v=spf1\b/i.test(t));
  results.push({
    check: 'SPF',
    host: sendHost,
    status: spfOk ? 'ok' : 'absent',
    detail: spfOk ? 'politique SPF présente' : 'enregistrement absent (ou CNAME affiché par Resend)',
  });

  // MX de rebond : reçoit les erreurs de livraison
  const mxHosts = await mx(resolver, sendHost);
  const mxOk = mxHosts.some((h) => /^feedback-smtp\.[a-z0-9-]+\.amazonses\.com$/.test(h));
  results.push({
    check: 'MX de rebond',
    host: sendHost,
    status: mxOk ? 'ok' : 'absent',
    detail: mxOk ? 'serveur de rebond présent' : 'enregistrement MX absent',
  });

  // DMARC : dit aux boîtes de réception quoi faire des e-mails non authentifiés
  const dmarcTxt = await txt(resolver, dmarcHost);
  const dmarc = dmarcTxt.find((t) => /^v=DMARC1/i.test(t));
  const policy = dmarc?.match(/\bp=(none|quarantine|reject)\b/i)?.[1]?.toLowerCase();
  results.push({
    check: 'DMARC',
    host: dmarcHost,
    status: dmarc ? 'ok' : 'absent',
    detail: dmarc ? `politique : ${policy ?? 'non précisée'}` : 'enregistrement absent (recommandé : p=none au début)',
  });

  return results;
}
