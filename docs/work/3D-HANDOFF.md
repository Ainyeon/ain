# 3D 배치도 → 에인연 업무 연결 안내 (받는 쪽 기준)

3D 작업(다른 채팅방)이 끝나면 이 문서대로 `/work/`에 붙인다. 먼저 **귀속을 정해야 한다**: 3D 스킬이 회사(바람대로) 자산이면
개인 프로젝트인 에인연(공개 저장소)에 코드·모델·키를 옮기지 않는다. 이 경우 연결은 외부 서비스 링크나 API 계약으로만 한다.

## 붙일 자리
- 화면: 작업 상세 `#job/:id` (work/work.js `viewJob`). "사진 보관" 패널 아래에 `panel('3D 배치도', …)`를 추가한다.
  입력으로 쓸 수 있는 값: 작업의 `field`·`work_type`·`items`(품목·수량·단위)·`address`·`sigungu`, 보관 사진(`S.d.photos`, 서명 URL은 `S.store.photoUrls`).
- 요금제: 프로 전용이면 화면은 `plan().isPro`로 가리고, **서버에서는 `public.work_is_pro()`로 막는다**(인자 없음, 본인만).
  베타 기간(2027-04-30까지)에는 전원 프로다.
- 결과물 저장: 새 테이블 `work_scenes`를 만든다면 17_work.sql의 `work_photos` 패턴을 그대로 쓴다.
  - `(job_id, user_id)` 복합 FK에 on delete cascade를 건다.
  - RLS는 `user_id = auth.uid()`로 둔다.
  - `revoke all … from anon, authenticated, public` 뒤 필요한 열만 grant한다.
  - 파일은 Storage `work` 버킷에 `uid/job/…` 경로로 예약 후 업로드한다.
  - 파일 끝 권한 단언 블록의 테이블 이름 패턴 `work\_%`에 자동으로 포함된다.
- 공유: 고객에게 보여 주려면 `get_card`에 필드를 **골라서** 추가한다. 경로·id·금액은 넣지 않는다.
  카드 페이지(`c/card.js`)는 textContent로만 그린다.
- 요금표: 출시되면 `/pricing/`의 "준비 중인 프로 혜택"에서 표로 옮기고, `work.js` 설정 화면의 요금제 목록도 고친다.

## 지켜야 할 것 (CLAUDE.md·SPEC 요약)
- service_role 키는 어떤 파일에도 넣지 않는다. 비밀 키가 필요한 호출은 Supabase Edge Function 환경변수로 처리한다.
- 3D 라이브러리는 CDN(jsdelivr)에서 불러온다. `/work/index.html`의 CSP `script-src`·`connect-src`에 해당 출처를 추가한다.
- 새 JS·CSS는 `?v=`를 맞추고 sw VERSION을 올린다. 업무 자산은 SHELL에 넣지 않는다.
- SQL은 파일로만 낸다. 운영 적용은 사용자가 한다.
