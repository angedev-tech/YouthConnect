// Service worker de YouthConnect.
//
// Règle de confidentialité : on ne met en cache QUE les fichiers statiques du site
// (pages, styles, scripts, images). Jamais les réponses de l'API, jamais les requêtes
// authentifiées, jamais les réponses d'un autre site (base de données, images tierces).
// Sur un appareil partagé, les données d'un membre ne restent donc pas accessibles hors session.

const CACHE_NAME = 'youthconnect-cache-v6';

// Fichiers essentiels, téléchargés depuis le réseau à l'installation
const FICHIERS_A_METTRE_EN_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/style.css',
    '/script.js',
    '/icon-192.png',
    '/icon-512.png'
];

const EXTENSIONS_STATIQUES = /\.(html|css|js|mjs|png|jpe?g|webp|svg|ico|woff2?|json)$/i;

// Vrai seulement pour un fichier statique du même site, sans authentification
function estCacheable(request) {
    if (request.method !== 'GET') return false;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;   // autre site : jamais
    if (url.pathname.startsWith('/api/')) return false;      // API : jamais
    if (request.headers.has('authorization')) return false;  // requête authentifiée : jamais
    return url.pathname === '/' || EXTENSIONS_STATIQUES.test(url.pathname);
}

// Installation : on met en cache les fichiers essentiels.
// { cache: 'reload' } force le téléchargement réel depuis le réseau.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.all(
                FICHIERS_A_METTRE_EN_CACHE.map((url) =>
                    fetch(url, { cache: 'reload' })
                        .then((reponse) => (reponse.ok ? cache.put(url, reponse) : null))
                        .catch((e) => console.error('Échec mise en cache de', url, e))
                )
            );
        })
    );
    self.skipWaiting();
});

// Activation : on supprime les anciens caches (dont ceux de l'ancienne version)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((noms) => {
            return Promise.all(
                noms
                    .filter((nom) => nom !== CACHE_NAME)
                    .map((nom) => caches.delete(nom))
            );
        })
    );
    self.clients.claim();
});

// Récupération : réseau d'abord, cache seulement hors-ligne, et seulement pour les fichiers statiques.
self.addEventListener('fetch', (event) => {
    if (!estCacheable(event.request)) return; // le navigateur gère la requête normalement

    event.respondWith(
        fetch(event.request)
            .then((reponseReseau) => {
                // Seules les réponses réussies du même site sont conservées
                if (reponseReseau.ok && reponseReseau.type === 'basic') {
                    const copie = reponseReseau.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copie));
                }
                return reponseReseau;
            })
            .catch(() => caches.match(event.request))
    );
});

// Réception d'une notification push envoyée par notre serveur
self.addEventListener('push', (event) => {
    let data = { title: 'YouthConnect', body: 'Nouvelle activité sur YouthConnect', url: '/' };
    try {
        if (event.data) data = { ...data, ...event.data.json() };
    } catch (e) {
        console.error('Erreur lecture payload push:', e);
    }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon || '/icon-192.png',
            badge: data.badge || '/icon-192.png',
            data: { url: data.url || '/' },
        })
    );
});

// Clic sur une notification : on ouvre (ou on met au premier plan) l'onglet YouthConnect
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const cible = event.notification.data?.url || '/?openNotifications=1';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
            for (const client of clientsList) {
                if ('focus' in client) {
                    client.postMessage({ type: 'NAVIGATE', url: cible });
                    return client.focus();
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(cible);
        })
    );
});
