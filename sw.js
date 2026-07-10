// 에인연 서비스워커 — 오프라인 내성: 마지막 브리핑·시세 1회분 열람 가능
// 전략: 내비게이션·데이터 = 네트워크 우선(성공 시 캐시 갱신, 실패 시 캐시 폴백)
//       정적 자산 = 캐시 우선(백그라운드 갱신)
const VERSION = 'ain-v9'; // v9: HF2 — 전 라우트 토큰 리스킨, ain.css 프리캐시 제거
const SHELL_CACHE = VERSION + '-shell';
const DATA_CACHE = VERSION + '-data';

const SHELL = [
  '/',
  '/gov/',
  '/prices/',
  '/calendar/',
  '/news/',
  '/me/',
  '/maker/',
  '/maker/notice/',
  '/maker/compare/',
  '/maker/maker.css?v=8',
  '/maker/maker-core.js',
  '/maker/notice/notice.js',
  '/maker/compare/compare.js',
  '/maker/fields.json',
  '/maker/formats.json',
  '/maker/copy.json',
  '/board/board.css?v=8',
  '/board/board-free.js',
  '/board/board-proposal.js',
  '/assets/js/ain-community.js',
  '/assets/css/design-tokens.css?v=8',
  '/assets/css/components.css?v=8',
  '/assets/js/ain-common.js',
  '/auth.js',
  '/assets/fonts/PretendardVariable.subset.woff2',
  '/assets/favicon.svg',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
];

// 오프라인 캐싱 허용 데이터: 공개 읽기 전용 REST GET만 (인증·토큰 요청은 절대 캐시 안 함)
const DATA_HOST = 'oqgoibbhnidsveueifet.supabase.co';
const DATA_PATH = '/rest/v1/';
const DATA_ALLOW = ['v_ticker_metals', 'v_stat_movein', 'v_stat_gov', 'v_gov_list', 'move_in_teaser', 'news_items', 'prices'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isDataRequest(url) {
  return url.hostname === DATA_HOST
    && url.pathname.startsWith(DATA_PATH)
    && DATA_ALLOW.some((t) => url.pathname === DATA_PATH + t);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 인증 관련은 손대지 않음
  if (url.pathname.startsWith('/auth/v1')) return;

  // 페이지 내비게이션: 네트워크 우선 → 캐시 폴백
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // 공개 데이터: 네트워크 우선, 최신 1회분 캐시 폴백 (Authorization 헤더 무시하고 URL 키로 저장)
  if (isDataRequest(url)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(url.href, copy));
          }
          return res;
        })
        .catch(() => caches.match(url.href, { cacheName: DATA_CACHE }))
    );
    return;
  }

  // 정적 자산(자체 호스트 + CDN 스크립트): 캐시 우선 + 백그라운드 갱신
  if (url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
