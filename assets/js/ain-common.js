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

  window.escT=escT;
  window.renderTicker=renderTicker;
})();
