// ain-site/auth.js
// Requires: @supabase/supabase-js loaded via CDN before this script
(function () {
  'use strict';

  const SUPABASE_URL = 'https://oqgoibbhnidsveueifet.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_SpAwevRkW29BHRuJeFdfSA_Ube6Z4Vo';

  const css = `
.ain-auth{display:flex;align-items:center;gap:8px;flex-shrink:0}
.ain-auth-login{
  display:inline-flex;align-items:center;gap:5px;
  height:30px;padding:0 12px;border-radius:7px;border:none;cursor:pointer;
  background:#FEE500;color:#191919;
  font-family:inherit;font-size:12px;font-weight:800;letter-spacing:-.01em;
  transition:opacity .12s ease;white-space:nowrap;
}
.ain-auth-login:hover{opacity:.88}
.ain-auth-name{
  color:#9BA3B0;font-size:11px;font-weight:700;letter-spacing:.02em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px;
}
.ain-auth-logout{
  display:inline-flex;align-items:center;
  height:28px;padding:0 10px;border-radius:7px;cursor:pointer;
  background:transparent;color:#6B7280;border:1px solid #2A313D;
  font-family:inherit;font-size:11px;font-weight:700;
  transition:opacity .12s ease;
}
.ain-auth-logout:hover{opacity:.75}
`;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  let _client = null;

  function getClient() {
    if (!_client) {
      _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return _client;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function kakaoIcon() {
    return '<svg width="13" height="12" viewBox="0 0 13 12" aria-hidden="true" style="flex-shrink:0">'
      + '<path d="M6.5 0C2.91 0 0 2.34 0 5.23c0 1.82 1.14 3.42 2.87 4.36L2.17 12l3.07-1.67c.41.07.83.11 1.26.11C10.09 10.44 13 8.1 13 5.23 13 2.34 10.09 0 6.5 0z" fill="#191919"/>'
      + '</svg>';
  }

  function render(container, session) {
    if (!container) return;
    if (session) {
      var meta = session.user.user_metadata || {};
      var name = meta.full_name || meta.name || meta.preferred_username || '회원';
      container.innerHTML =
        '<div class="ain-auth">'
        + '<span class="ain-auth-name">' + esc(name) + '</span>'
        + '<button class="ain-auth-logout" id="_ain_out">로그아웃</button>'
        + '</div>';
      document.getElementById('_ain_out')
        .addEventListener('click', function () { getClient().auth.signOut(); });
    } else {
      container.innerHTML =
        '<div class="ain-auth">'
        + '<button class="ain-auth-login" id="_ain_in">'
        + kakaoIcon()
        + '카카오 3초 로그인'
        + '</button>'
        + '</div>';
      document.getElementById('_ain_in')
        .addEventListener('click', function () {
          getClient().auth.signInWithOAuth({
            provider: 'kakao',
            options: {
              redirectTo: window.location.origin + window.location.pathname
            }
          });
        });
    }
  }

  window.ainAuth = {
    init: function (containerId) {
      var container = document.getElementById(containerId);
      if (!container) return null;

      var client = getClient();

      client.auth.getSession().then(function (res) {
        render(container, res.data.session);
      });

      client.auth.onAuthStateChange(function (_event, session) {
        render(container, session);
        window.dispatchEvent(new CustomEvent('ain:auth', { detail: { session: session } }));
      });

      return client;
    },
    getClient: getClient,
    getSession: function () {
      return getClient().auth.getSession().then(function (res) {
        return res.data.session;
      });
    }
  };
}());
