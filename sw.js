// Service worker: deixa o app abrir instantaneamente e funcionar com os últimos dados.
// Suba o número da versão quando publicar mudanças nos arquivos do app.
var VERSAO = 'estoque-mp-v1';
var ARQUIVOS = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/logo-azul.png', 'icons/favicon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSAO; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // Chamadas à planilha (Apps Script) nunca passam pelo cache do service worker
  // (só tratamos arquivos do próprio app e as fontes do Google Fonts)
  var meu = url.origin === self.location.origin;
  var fonte = url.hostname.indexOf('fonts.g') === 0;
  if (!meu && !fonte) return;
  // Arquivos do app e fontes: mostra o guardado e atualiza por trás
  e.respondWith(caches.open(VERSAO).then(function (c) {
    return c.match(req).then(function (hit) {
      var rede = fetch(req).then(function (r) {
        if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
        return r;
      }).catch(function () { return hit; });
      return hit || rede;
    });
  }));
});
