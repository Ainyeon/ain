// A.IN 공통 UI — supabase-js, auth.js 다음 / 페이지 스크립트 이전에 로드.
// index.html에서 추출. nav 상태·스크롤 리빌·티커 렌더·로그인 상태 UI·모션.
// 요소가 없는 페이지에서도 안전하게 동작 (존재 가드).
(function(){
  'use strict';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch=matchMedia('(pointer: coarse)').matches;

  const escT=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  // nav state
  const nav=document.getElementById('nav');
  if(nav)addEventListener('scroll',()=>nav.classList.toggle('scrolled',scrollY>10),{passive:true});

  // 티커 렌더 (#ticker 있는 페이지에서 renderTicker(items) 호출. null 항목 렌더 제외)
  function renderTicker(items){
    const tk=document.getElementById('ticker');
    if(!tk)return;
    tk.innerHTML=items
      .filter(it=>it&&it.k!=null&&it.v!=null)
      .map(it=>'<div class="tick"><span class="k">'+escT(it.k)+'</span><span class="v">'+escT(it.v)+'</span>'
        +(it.change&&it.change.text!=null?'<span class="'+(it.change.dir==="down"?"down":"up")+'">'+escT(it.change.text)+'</span>':'')
        +(it.note!=null?'<span class="k">'+escT(it.note)+'</span>':'')
        +'</div>').join('');
    tk.innerHTML+=tk.innerHTML; // seamless loop
  }

  // kakao login + 세션 상태 UI — 인증 로직은 auth.js(ainAuth) 재사용.
  // 로드 시 getClient()가 OAuth 리다이렉트 토큰(#access_token) 감지·세션 저장까지 처리.
  let renderAuth=null;
  const kakaoBtn=document.getElementById('kakaoStart');
  if(kakaoBtn&&window.ainAuth){
    const authClient=ainAuth.getClient();
    const authPop=document.createElement('div');
    authPop.className='auth-pop';
    authPop.innerHTML='<button type="button" id="logoutBtn">로그아웃</button>';
    kakaoBtn.parentElement.appendChild(authPop);

    const displayName=user=>{
      const m=(user&&user.user_metadata)||{};
      const n=m.full_name||m.name||m.preferred_username||m.nickname;
      if(n)return n;
      if(user&&user.email)return user.email.split('@')[0];
      return '내 계정';
    };
    let loggedIn=false;
    renderAuth=session=>{
      loggedIn=!!session;
      authPop.classList.remove('open');
      if(session){
        const name=displayName(session.user);
        kakaoBtn.innerHTML='<span class="plus">'+escT(name.charAt(0))+'</span>'+escT(name);
      }else{
        kakaoBtn.innerHTML='<span class="plus">+</span>카카오로 시작';
      }
    };
    const cleanAuthHash=()=>{
      if(location.hash.includes('access_token')){
        history.replaceState(null,'',location.pathname+location.search);
      }
    };
    kakaoBtn.addEventListener('click',e=>{
      e.preventDefault();
      if(loggedIn){authPop.classList.toggle('open');return;}
      authClient.auth.signInWithOAuth({
        provider:'kakao',
        options:{redirectTo:location.origin+location.pathname}
      });
    });
    document.getElementById('logoutBtn').addEventListener('click',async()=>{
      await authClient.auth.signOut();
      renderAuth(null);
    });
    addEventListener('click',e=>{
      if(!e.target.closest('.nav-right'))authPop.classList.remove('open');
    });
    authClient.auth.getSession().then(r=>{renderAuth(r.data.session);cleanAuthHash();});
    authClient.auth.onAuthStateChange((_e,s)=>{
      renderAuth(s);cleanAuthHash();
      window.dispatchEvent(new CustomEvent('ain:auth',{detail:{session:s}}));
    });
    window.renderAuth=renderAuth;
  }

  // scroll reveal (blur -> sharp)
  const io=new IntersectionObserver(es=>es.forEach(e=>{
    if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}
  }),{threshold:.15});
  document.querySelectorAll('.rv').forEach(el=>io.observe(el));

  if(!reduced && !isTouch){
    // orb: mouse parallax + scroll parallax + hero text counter-drift (index 전용 요소 가드)
    const orb=document.getElementById('orb');
    const heroInner=document.getElementById('heroInner');
    if(orb&&heroInner){
      let mx=0,my=0,tx=0,ty=0;
      addEventListener('pointermove',e=>{
        mx=(e.clientX/innerWidth-.5);
        my=(e.clientY/innerHeight-.5);
      },{passive:true});
      (function loop(){
        tx+=(mx-tx)*.045; ty+=(my-ty)*.045;
        const sy=Math.min(scrollY,900);
        orb.style.transform=
          `translate(calc(-50% + ${tx*34}px), calc(-53% + ${ty*26 - sy*.14}px))`;
        heroInner.style.transform=
          `translate(${tx*-10}px, ${ty*-7}px)`;
        requestAnimationFrame(loop);
      })();
    }

    // 3D tilt on cards
    document.querySelectorAll('.tilt').forEach(card=>{
      card.addEventListener('pointermove',e=>{
        const r=card.getBoundingClientRect();
        const px=(e.clientX-r.left)/r.width-.5;
        const py=(e.clientY-r.top)/r.height-.5;
        card.style.transform=
          `perspective(900px) rotateX(${py*-4.5}deg) rotateY(${px*5.5}deg) translateZ(6px)`;
      });
      card.addEventListener('pointerleave',()=>{
        card.style.transition='transform .5s cubic-bezier(.2,.8,.2,1)';
        card.style.transform='';
        setTimeout(()=>card.style.transition='',500);
      });
    });
  }

  // 하단 탭바 (모바일 전용 — ≥901px CSS 숨김). 한 손 조작 핵심 내비게이션.
  (function buildTabbar(){
    const I={
      home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>',
      radar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/></svg>',
      brief:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
      price:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19 9.5 13l3.5 3.5L20 9"/><path d="M15.5 9H20v4.5"/></svg>',
      me:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.4 4.2-5 7.5-5s6.1 1.6 7.5 5"/></svg>'
    };
    const TABS=[
      {href:'/',label:'홈',icon:I.home},
      {href:'/calendar/',label:'입주레이더',icon:I.radar},
      {href:'/gov/',label:'정부사업',icon:I.brief},
      {href:'/prices/',label:'시세',icon:I.price},
      {href:'/me/',label:'내정보',icon:I.me}
    ];
    const here=location.pathname;
    const tb=document.createElement('nav');
    tb.className='tabbar';
    tb.setAttribute('aria-label','주요 메뉴');
    tb.innerHTML=TABS.map(t=>{
      const on=t.href==='/'?(here==='/'||here==='/index.html'):here.startsWith(t.href);
      return '<a href="'+t.href+'"'+(on?' class="on" aria-current="page"':'')+'>'+t.icon+'<span>'+t.label+'</span></a>';
    }).join('');
    document.body.appendChild(tb);
  })();

  // PWA: 서비스워커 등록 + 홈 화면 설치 프롬프트
  if('serviceWorker' in navigator){
    addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
  }
  let deferredInstall=null;
  addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    if(localStorage.getItem('ain_install_dismissed'))return;
    deferredInstall=e;
    const bar=document.createElement('div');
    bar.className='install-bar';
    bar.innerHTML='<span>홈 화면에 에인연을 추가하면 앱처럼 쓸 수 있어요</span>'
      +'<button type="button" class="install-go">추가</button>'
      +'<button type="button" class="install-x" aria-label="닫기">✕</button>';
    document.body.appendChild(bar);
    bar.querySelector('.install-go').addEventListener('click',async()=>{
      bar.remove();
      if(!deferredInstall)return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall=null;
    });
    bar.querySelector('.install-x').addEventListener('click',()=>{
      localStorage.setItem('ain_install_dismissed','1');
      bar.remove();
    });
  });

  window.escT=escT;
  window.renderTicker=renderTicker;
})();
