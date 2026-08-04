// Service worker de solo app-shell: instala la app para uso/carga offline.
// No cachea llamadas a Supabase — eso lo maneja IndexedDB (ver js/db-local.js
// y js/sync.js), para no tener dos mecanismos de "offline" compitiendo.

const CACHE_NAME = 'agrosalado-stock-shell-v5';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/estilo.css',
  './js/app.js',
  './js/auth.js',
  './js/config.js',
  './js/dashboard.js',
  './js/db-local.js',
  './js/export.js',
  './js/historial.js',
  './js/movimientos.js',
  './js/router.js',
  './js/supabaseClient.js',
  './js/sync.js',
  '/assets/icon-512.png',
  '/assets/icon-192.png',
  '/assets/logo-full.png',
  '/assets/fondo-login.jpg',
  'https://esm.sh/@supabase/supabase-js@2',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);

  // Nunca interceptar llamadas a la API/Auth de Supabase (datos en vivo).
  // El bundle de supabase-js (esm.sh) sí se cachea, como parte del app-shell,
  // para que el JS de la app pueda cargar aunque no haya conexión.
  if (url.hostname.endsWith('.supabase.co')) {
    return;
  }

  if (evento.request.method !== 'GET') return;

  evento.respondWith(
    caches.match(evento.request).then((cacheada) => {
      const red = fetch(evento.request)
        .then((respuesta) => {
          const copia = respuesta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(evento.request, copia));
          return respuesta;
        })
        .catch(() => cacheada);
      return cacheada || red;
    })
  );
});
