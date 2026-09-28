// A.IN 공통 UI — supabase-js, auth.js 다음 / 페이지 스크립트 이전에 로드.
// 탭바·현재 메뉴 표시·서비스워커·설치 안내·표시단 보정(정부사업 중복·뉴스 출처·원문 주소 비교).
// (옛 홈의 티커·스크롤 리빌·오브 패럴랙스·카드 기울기·로그인 팝업은 09-28 제거 — 쓰는 페이지 없음)
// 요소가 없는 페이지에서도 안전하게 동작 (존재 가드).
(function(){
  'use strict';

  const escT=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  // 모바일 상단 칩: 현재 페이지 칩이 스크롤 밖이면 보이게
  document.querySelectorAll('.tnav-links a.on,.board-tabs a.on').forEach(a=>a.setAttribute('aria-current','page'));
  const onChip=document.querySelector('.tnav-links a.on');
  if(onChip&&onChip.scrollIntoView)onChip.scrollIntoView({inline:'center',block:'nearest'});

  // 하단 탭바 (모바일 전용 — ≥769px CSS 숨김). 한 손 조작 핵심 내비게이션.
  (function buildTabbar(){
    const I={
      home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>',
      radar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/></svg>',
      brief:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
      price:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19 9.5 13l3.5 3.5L20 9"/><path d="M15.5 9H20v4.5"/></svg>',
      maker:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10h6M7 14h10"/></svg>',
      book:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
      board:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>'
    };
    // 메뉴 5개 (SPEC §7.1). 시세·정부사업·업계뉴스·캘린더는 라우트 유지 —
    // 홈 패널과 입주정보 페이지에서 연결한다.
    const TABS=[
      {href:'/',base:['/prices/','/gov/','/news/'],label:'홈',icon:I.home},   // 홈 대시보드의 하위 페이지
      {href:'/edu/',label:'교육·일자리',icon:I.book},
      {href:'/area/',base:['/area/','/calendar/'],label:'입주정보',icon:I.radar},
      {href:'/maker/',base:['/maker/','/work/'],label:'도구',icon:I.maker},
      {href:'/board/free/',base:'/board/',label:'게시판',icon:I.board}
    ];
    const here=location.pathname;
    const tb=document.createElement('nav');
    tb.className='tabbar';
    tb.setAttribute('aria-label','주요 메뉴');
    tb.innerHTML=TABS.map(t=>{
      const bases=[].concat(t.base||t.href);
      const on=(t.href==='/'&&(here==='/'||here==='/index.html'))||bases.some(b=>b!=='/'&&here.startsWith(b));
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
    try{if(localStorage.getItem('ain_install_dismissed'))return;}catch(err){return;}
    // 업무 화면의 '작업 등록'·메이커의 공유/저장 바와 같은 자리라 가린다 — 도구 화면에서는 띄우지 않는다
    if(location.pathname.startsWith('/work/')||document.querySelector('.action-bar'))return;
    deferredInstall=e;
    const bar=document.createElement('div');
    bar.className='install-bar';
    bar.innerHTML='<span>에인연을 홈 화면에 추가</span>'
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
      try{localStorage.setItem('ain_install_dismissed','1');}catch(err){}
      bar.remove();
    });
  });

  // ③ 정부사업 공고 중복 — 표시 단계에서만 제거한다. 운영 행은 건드리지 않는다.
  // 실측(2026-09-09): source_url 완전 동일 중복은 0건. 같은 bizinfo pblancId가
  //   짧은 URL(?pblancId=…)과 쿼리가 붙은 긴 URL(hashCode=&rowsSel=…&pblancId=…)로 2행 존재.
  // 중복키 = 공식 호스트 + 경로 + pblancId. 제목이 같다는 이유만으로 다른 공고를 합치지 않는다.
  // 근본 원인은 수집단(상위 레포)이며 이 repo에서는 확인·표시만 한다.
  function govDedupKey(url){
    if(!url)return null;
    try{
      const u=new URL(url);
      const id=u.searchParams.get('pblancId');
      return id?u.host+u.pathname+'?pblancId='+id:null;
    }catch(e){return null}
  }
  function dedupGov(rows){
    const seen=new Set();
    return (rows||[]).filter(r=>{
      const k=govDedupKey(r&&r.source_url);
      if(!k)return true;          // 판정 키가 없으면 합치지 않는다
      if(seen.has(k))return false;
      seen.add(k);return true;
    });
  }

  // ⑥ 뉴스 요약에 남은 SOURCE 자리표시자를 실제 출처명으로 채운다.
  //
  // 실측(2026-09-09, 활성 60건 전수): source 열 값에는 SOURCE 라벨이 없고,
  // summary 문장 **중간**에 "…선보인다. SOURCE에 따르면 습도…" 처럼 남아 있다.
  // 60건 모두 문두가 아니라 문중이었다 — "문두에만 있다"는 앞선 가정은 틀렸다.
  // 자리표시자는 항상 그 기사의 출처를 가리키므로 같은 행의 source 값으로 치환한다.
  //
  // 훼손 방지 규칙 두 가지:
  //   1) 대문자 SOURCE 바로 뒤에 한글이 붙은 경우만 (SOURCE에 / SOURCE는 …).
  //      "OPEN SOURCE 생태계"처럼 뒤에 공백이 오면 본문 단어이므로 건드리지 않는다.
  //   2) 앞 글자가 영숫자·밑줄·하이픈이면 식별자의 일부이므로 건드리지 않는다
  //      (MY_SOURCE에, data-SOURCE에 …).
  // 출처를 모르면 매체명을 지어내지 않고 '출처'로 둔다.
  // 근본 수정은 수집단(상위 레포)의 몫이며 여기는 표시단 보정이다.
  const SOURCE_INLINE=/(^|[^\w\-])SOURCE(?=[가-힣])/g;
  // 줄 맨 앞에 표식만 따로 붙은 형태. 뒤에 한글이 바로 붙으면 자리표시자이므로 여기서 지우지 않고
  // SOURCE_INLINE이 출처명으로 채우게 둔다 (먼저 치환한 뒤 이 규칙을 적용한다).
  const SOURCE_LEADING=/^[ \t]*SOURCE(?![가-힣])\b[ \t]*[:\-–—]?[ \t]*/gm;
  function fillNewsSource(text,sourceName){
    const t=String(text??'');
    if(!t)return '';
    const name=String(sourceName??'').trim()||'출처';
    return t.replace(SOURCE_INLINE,(m,pre)=>pre+name).replace(SOURCE_LEADING,'');
  }

  // 같은 원문 주소인지 비교하는 키 — 스킴·빈 파라미터·파라미터 순서·끝 슬래시 차이는 같은 글로 본다.
  // (교육 원장은 사람이 붙여 넣은 순서, 수집기는 원문 순서라 글자 비교로는 같은 과정이 두 번 실린다 — 09-26 실측)
  function sourceUrlKey(u){
    const raw=String(u??'').trim();
    try{
      const x=new URL(raw);
      const q=[...x.searchParams].filter(([,v])=>v!=='').map(([k,v])=>k+'='+v).sort();
      return x.host+x.pathname.replace(/\/$/,'')+(q.length?'?'+q.join('&'):'');
    }catch(e){ return raw.replace(/^https?:\/\//,'').replace(/\/$/,''); }
  }

  // 해외 매체 판정 — 출처 이름 + 원문 주소 호스트. 홈·뉴스 두 곳이 같은 규칙을 쓴다
  // (호주 HVAC&R News 가 이름 목록에 없어 '국내'로 붙던 문제 — 09-28)
  const OVERSEAS_SOURCES=new Set(['Cooling Post','Contractor Magazine','HVAC&R News']);
  const OVERSEAS_HOST=/(^|\.)(coolingpost\.com|contractormag\.com|hvacrnews\.com\.au)$/i;
  function isOverseasNews(r){
    if(!r)return false;
    if(OVERSEAS_SOURCES.has(r.source))return true;
    try{return OVERSEAS_HOST.test(new URL(r.url).hostname);}catch(err){return false;}
  }

  window.escT=escT;
  window.isOverseasNews=isOverseasNews;
  window.sourceUrlKey=sourceUrlKey;
  window.fillNewsSource=fillNewsSource;
  window.govDedupKey=govDedupKey;
  window.dedupGov=dedupGov;
})();
