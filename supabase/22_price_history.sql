-- ═══════════════════════════════════════════════════════════════════════
-- 22_price_history.sql — 시세 날짜별 기록(구리 원화 kg값·한 달 흐름 그래프용)
-- 적용: 검토·로컬 검증(node tools/test-open-board-sql.mjs) 뒤 운영에 적용한다. 재실행 안전.
--
-- 왜: prices 는 파이프라인(ain-automation collect_prices.py, 매일 06:00 KST)이 같은 5행(item_id)을
--     매일 덮어써서 지난 값이 DB에 남지 않는다. 덮어쓸 때마다 그날 값을 한 줄씩 따로 남긴다.
--     파이프라인은 고치지 않는다(트리거가 받는다). 지난 값은 파이프라인 저장소의
--     data/prices_history.jsonl 에서 22b_price_history_backfill.sql 로 한 번 채운다.
-- 공개 범위: prices 와 같다(anon 읽기 — 국제 시세라 공개 자산).
--
-- 롤백:
--   drop trigger if exists price_history_capture on public.prices;
--   drop function if exists public.tg_price_history();
--   drop table if exists public.price_history;
-- ═══════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.price_history (
  item_id      text    not null,
  day          date    not null,                 -- 한국 날짜
  price        numeric not null,
  collected_at timestamptz,
  primary key (item_id, day)
);

alter table public.price_history enable row level security;
revoke all on public.price_history from anon, authenticated, public;
grant select on public.price_history to anon, authenticated;
drop policy if exists "anyone reads price history" on public.price_history;
create policy "anyone reads price history" on public.price_history for select to anon, authenticated using (true);

-- ⚠️ 실패해도 시세 수집을 막지 않는다.
create or replace function public.tg_price_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.price is not null then
    begin
      insert into public.price_history (item_id, day, price, collected_at)
      values (new.item_id, (coalesce(new.collected_at, now()) at time zone 'Asia/Seoul')::date, new.price, new.collected_at)
      on conflict (item_id, day) do update set price = excluded.price, collected_at = excluded.collected_at;
    exception when others then
      raise warning '시세 기록 건너뜀(%): %', new.item_id, sqlerrm;
    end;
  end if;
  return new;
end $$;
revoke all on function public.tg_price_history() from public, anon, authenticated;

drop trigger if exists price_history_capture on public.prices;
create trigger price_history_capture
  after insert or update of price, collected_at on public.prices
  for each row execute function public.tg_price_history();

-- 지금 값으로 시작(이미 있으면 그대로)
insert into public.price_history (item_id, day, price, collected_at)
select item_id, (collected_at at time zone 'Asia/Seoul')::date, price, collected_at
  from public.prices where price is not null and collected_at is not null
on conflict (item_id, day) do nothing;

do $$
begin
  if has_table_privilege('anon', 'public.price_history', 'INSERT')
     or has_table_privilege('anon', 'public.price_history', 'UPDATE')
     or has_table_privilege('authenticated', 'public.price_history', 'DELETE') then
    raise exception 'price_history 쓰기 권한 잔존';
  end if;
  if not has_table_privilege('anon', 'public.price_history', 'SELECT') then raise exception 'price_history 읽기 안 열림'; end if;
  if has_function_privilege('anon', 'public.tg_price_history()', 'EXECUTE') then raise exception '기록 함수가 열림'; end if;
end $$;

commit;
