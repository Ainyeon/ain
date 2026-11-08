-- ═══════════════════════════════════════════════════════════════════════
-- 23_movein_detail_weather.sql — 입주 단지 상세(청약홈 공고) 칸 + 현장 날씨 표
-- 적용: 검토·로컬 검증(node tools/test-movein-weather-sql.mjs) 뒤 운영에 적용한다. 재실행 안전.
--       파이프라인(ain-automation)보다 먼저 적용한다 — 파이프라인은 칸·표가 없으면 경고만 남기고 넘어가지만,
--       사이트 화면은 칸이 없으면 입주 목록 조회가 실패한다.
--
-- [A] move_in_complexes 에 청약홈 분양공고 상세를 붙인다(ain-automation move_in_radar.py 가 채운다).
--     공개 범위는 표 그대로 — 회원(authenticated)만. 단지명과 같이 보이는 정보라 '단지명 = 회원 전용'을 따른다.
--     supply_households 는 청약홈 '공급규모'다. 재건축 조합원분 등이 빠질 수 있어 단지 총세대수와 다를 수 있다.
--     house_types 는 주택형별 [{type, area, supply_area, units}] — area 는 전용면적(㎡), units 는 일반+특별공급 세대.
--     house_types = '[]' 는 '조회했지만 청약홈에 해당 공고가 없음'(다시 조회하지 않는다), null 은 아직 조회 전.
--
-- [B] weather_daily — 기상청 단기예보를 시·도청 소재지 격자 기준으로 하루 단위로 줄인 값.
--     ain-automation collect_weather.py 가 매일 아침 채운다. 공개 자료라 비회원도 읽는다(시세와 같은 선).
--
-- 롤백:
--   drop table if exists public.weather_daily;
--   alter table public.move_in_complexes drop column if exists house_manage_no, drop column if exists supply_households,
--     drop column if exists builder, drop column if exists developer, drop column if exists house_types;
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── [A] 입주 단지 상세 ───────────────────────────────────────────────
alter table public.move_in_complexes
  add column if not exists house_manage_no   text,
  add column if not exists supply_households integer,
  add column if not exists builder           text,
  add column if not exists developer         text,
  add column if not exists house_types       jsonb;

-- ── [B] 현장 날씨 ────────────────────────────────────────────────────
create table if not exists public.weather_daily (
  sido      text    not null,               -- 서울·경기·인천·강원 … 제주 (짧은 표기 17곳)
  day       date    not null,               -- 한국 날짜
  tmin      numeric,                        -- 최저기온 ℃ (TMN, 없으면 시간별 기온 최저)
  tmax      numeric,                        -- 최고기온 ℃ (TMX, 없으면 시간별 기온 최고)
  pop_max   integer,                        -- 하루 중 가장 높은 강수확률 %
  pty       text,                           -- 비·비/눈·눈·소나기 중 하루에 나온 것(없으면 null)
  wind_max  numeric,                        -- 하루 중 가장 센 풍속 m/s
  base_at   timestamptz not null,           -- 예보 발표 시각
  collected_at timestamptz not null default now(),
  primary key (sido, day)
);

alter table public.weather_daily enable row level security;
revoke all on public.weather_daily from anon, authenticated, public;
grant select on public.weather_daily to anon, authenticated;
drop policy if exists "anyone reads weather" on public.weather_daily;
create policy "anyone reads weather" on public.weather_daily for select to anon, authenticated using (true);

-- ── [C] 적용 확인: 하나라도 어긋나면 전체 롤백 ──────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.move_in_complexes', 'SELECT')
     or has_column_privilege('anon', 'public.move_in_complexes', 'builder', 'SELECT')
     or has_column_privilege('anon', 'public.move_in_complexes', 'house_types', 'SELECT') then
    raise exception '입주 단지 표가 비회원에게 열림';
  end if;
  if not has_column_privilege('authenticated', 'public.move_in_complexes', 'supply_households', 'SELECT')
     or not has_column_privilege('authenticated', 'public.move_in_complexes', 'house_types', 'SELECT') then
    raise exception '회원이 새 칸을 못 읽음';
  end if;
  if has_table_privilege('authenticated', 'public.move_in_complexes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.move_in_complexes', 'INSERT') then
    raise exception '입주 단지 표에 회원 쓰기 권한 잔존';
  end if;
  if has_table_privilege('anon', 'public.weather_daily', 'INSERT')
     or has_table_privilege('anon', 'public.weather_daily', 'UPDATE')
     or has_table_privilege('authenticated', 'public.weather_daily', 'DELETE') then
    raise exception 'weather_daily 쓰기 권한 잔존';
  end if;
  if not has_table_privilege('anon', 'public.weather_daily', 'SELECT') then raise exception 'weather_daily 읽기 안 열림'; end if;
end $$;

commit;
