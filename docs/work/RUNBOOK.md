# 업무 기능 운영 절차 (운영자용)

## 1. 처음 켜기 (순서대로)
1. 이 브랜치의 `supabase/17_work.sql`을 검토한 뒤 Supabase SQL Editor에서 실행한다.
   끝의 단언 블록이 실패하면 전체가 롤백된다. 메시지를 보고 원인(남은 정책, bucket_id 없는 storage 정책 등)을 정리한 뒤 다시 실행한다.
2. 로그인 세션에서 `select public.work_is_pro();`가 true(베타)인지 확인한다.
3. 실제 폰으로 수동 확인한다(무인 검증 사각).
   - 사진 올리기와 보기
   - 남의 uid 폴더에 올리면 거부되는지(앱 밖에서 시도)
   - 시공 카드 링크를 문자로 보내고 고객 폰에서 열기
   - AS 문의가 오늘 화면에 뜨는지
   - 견적서 공유와 인쇄
4. `_dev/legal/terms`, `_dev/legal/privacy`의 〔채울 것〕을 채운다. `node tools/check-legal.js`가 OK이고 법률 검토를 받은 뒤 `legal/`로 옮겨 공개하고, /work/ 푸터·카드 문의 고지에 링크를 다시 단다.
5. 배포 전 회귀 체크(CLAUDE.md)를 하고 main에 합친다.

## 2. 유료 부여·회수 (계좌이체 확인 후)
```sql
select public.admin_set_plan('<회원 uuid>', '2027-06-01 00:00+09', '계좌이체 9/30 19,900원');  -- 부여
select public.admin_set_plan('<회원 uuid>', null, '환불');                                  -- 회수
select * from public.billing_events order by id desc limit 20;                               -- 원장 (FK 없음, 5년 보존)
```
유료 판매 전에 끝낼 일:
- 사업자 업종 추가
- 통신판매업 신고 또는 면제 확인
- 호스팅 이전(GitHub Pages는 상업 SaaS 운영 금지)
- 청약철회·환불 조항 추가
- 베타 회원의 명시적 동의(전자상거래법 13조 6항)

## 3. 탈퇴 요청 처리 (사진 파일까지)
DB cascade는 Storage 파일을 지우지 않는다. 순서를 지킨다.
1. 필요하면 회원에게 CSV 내보내기를 먼저 안내한다.
2. 대시보드 Storage에서 `work` 버킷의 `<uid>/` 폴더를 통째로 지운다(API/대시보드로 지운다. SQL delete는 파일을 남긴다).
3. Authentication → Users에서 해당 사용자를 삭제한다. profiles → work_* 가 cascade로 지워지고, billing_events는 남는다.
4. 고아 파일을 점검한다.
```sql
select o.name from storage.objects o where o.bucket_id = 'work'
   and not exists (select 1 from public.work_photos p where p.path = o.name);
```

## 4. 베타 종료일을 바꿀 때
세 곳을 같이 바꾼다.
- `supabase/17_work.sql`의 `work_user_is_pro()` 날짜(SQL 재실행)
- `work/work-logic.js`의 `PLAN.betaEnd`(`?v=`와 sw VERSION도 올린다)
- `_dev/pricing/`·약관 문구
`tools/test-work-sql.mjs`가 SQL과 JS 날짜가 같은지 검사한다.

## 5. 용량
Supabase Free는 저장 1GB이고 백업이 없다. 사진 한도(1MB, 작업당 30장, 월 300장)는 이것을 전제로 잡았다.
회원이 늘면 Pro로 올린 뒤 한도를 다시 정한다.
```sql
select split_part(name, '/', 1) uid, count(*), pg_size_pretty(sum((metadata->>'size')::bigint))
  from storage.objects where bucket_id = 'work' group by 1 order by sum((metadata->>'size')::bigint) desc limit 20;
```
