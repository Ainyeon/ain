// 에인연 업무 — 데이터 계층. 실제(Supabase)와 데모(메모리) 두 가지가 같은 모양을 가진다.
//   load()                  → { profile, customers, jobs, requests, photos, sub, isPro }  (1인 기준 전량 로드)
//   save(table, row)        → 저장된 행 (id 있으면 수정, 없으면 등록)
//   remove(table, id)
//   issueCard(customerId) / revokeCard(customerId) / resolveRequest(id)
//   addPhoto(jobId, blob, kind) / photoUrls(photos) / removePhoto(photo) / deleteRequest(id)
//   offline() → 마지막으로 불러온 오늘·내일 일정 요약 (지하·기계실에서 읽기 전용)
// ponytail: 전량 로드(1000행씩 나눠 읽기) — 작업이 수만 건이면 기간 필터를 붙인다.
(function () {
  'use strict';
  const L = window.ainWorkLogic;

  // 클라이언트가 쓸 수 있는 열 (supabase/17_work.sql 컬럼 GRANT와 같다)
  const COLS = {
    work_profiles: ['biz_name', 'owner_name', 'phone', 'account', 'biz_no', 'intro', 'quote_note', 'logo_data', 'sms_templates', 'updated_at'],
    work_customers: ['name', 'phone', 'address', 'memo', 'tag', 'revisit_months', 'revisit_snooze_until', 'updated_at'],
    work_jobs: ['customer_id', 'field', 'work_type', 'status', 'scheduled_at', 'all_day', 'duration_min', 'address', 'sido', 'sigungu',
      'complex_id', 'items', 'checklist', 'vat_mode', 'total_amount', 'payments', 'memo', 'completed_at', 'source', 'referral_party',
      'referral_fee', 'parent_job_id', 'warranty_months', 'updated_at']
  };
  const pick = (table, row) => {
    const out = {};
    COLS[table].forEach((k) => { if (row[k] !== undefined) out[k] = row[k]; });
    out.updated_at = new Date().toISOString();
    return out;
  };

  // 업로드 전 줄이기: 긴 변 1600px JPEG 0.8 (버킷 한도 2MB, 폰 원본은 5MB를 넘기 쉽다)
  async function shrink(file) {
    const bmp = await createImageBitmap(file);
    const cv = document.createElement('canvas');
    let blob = null;
    for (const [side, q] of [[1600, 0.8], [1600, 0.65], [1280, 0.6], [1024, 0.55]]) {   // 버킷 한도 1MB 안으로
      const s = Math.min(1, side / Math.max(bmp.width, bmp.height));
      cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
      if (blob.size < 950000) break;
    }
    if (bmp.close) bmp.close();
    return blob;
  }
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);

  // ── 실제 저장소
  // 서버 기본 최대 1000행 → id 순으로 나눠 끝까지 읽는다 (소리 없이 잘리는 일 방지)
  async function readAll(make) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await make().order('id', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }
  const offlineKey = (uid) => 'work_offline_' + uid;
  function saveOffline(uid, d) {
    const from = L.dayKey(new Date()), to = L.dayKey(L.addDays(new Date(), 1));
    const jobs = d.jobs.filter((j) => j.scheduled_at && L.dayKey(j.scheduled_at) >= from && L.dayKey(j.scheduled_at) <= to && j.status !== 'canceled');
    const ids = new Set(jobs.map((j) => j.customer_id));
    try {
      localStorage.setItem(offlineKey(uid), JSON.stringify({ at: new Date().toISOString(),
        jobs: jobs.map((j) => ({ id: j.id, customer_id: j.customer_id, scheduled_at: j.scheduled_at, all_day: j.all_day, address: j.address, status: j.status, work_type: j.work_type, memo: j.memo })),
        customers: d.customers.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, name: c.name, phone: c.phone })) }));
    } catch (e) { /* 저장 공간이 없으면 건너뛴다 */ }
  }

  function supabaseStore(client, userId) {
    const must = ({ data, error }) => { if (error) throw error; return data; };
    return {
      isDemo: false,
      userId,
      async load() {
        const [profile, customers, jobs, requests, photos, sub, pro] = await Promise.all([
          client.from('work_profiles').select('*').maybeSingle().then(must),
          readAll(() => client.from('work_customers').select('*')),
          readAll(() => client.from('work_jobs').select('*')),
          client.from('work_card_requests').select('*').order('created_at', { ascending: false }).limit(500).then(must),
          readAll(() => client.from('work_photos').select('*')),
          client.from('subscriptions').select('source,current_period_end').maybeSingle().then(must),
          client.rpc('work_is_pro').then(must)
        ]);
        const d = { profile: profile || {}, customers: customers.reverse(), jobs: jobs.reverse(), requests, photos, sub, isPro: !!pro };
        saveOffline(userId, d);
        return d;
      },
      offline() { try { return JSON.parse(localStorage.getItem(offlineKey(userId)) || 'null'); } catch (e) { return null; } },
      deleteRequest: (id) => client.from('work_card_requests').delete().eq('id', id).then(must),
      async save(table, row) {
        const body = pick(table, row);
        if (table === 'work_profiles') {
          const has = await client.from('work_profiles').select('user_id').maybeSingle().then(must);
          return (has ? client.from(table).update(body).eq('user_id', userId) : client.from(table).insert(body))
            .select().single().then(must);
        }
        return (row.id ? client.from(table).update(body).eq('id', row.id) : client.from(table).insert(body))
          .select().single().then(must);
      },
      async remove(table, id) {
        if (table === 'work_jobs') {
          // 사진 파일을 먼저 지운다 (행이 먼저 지워지면 파일이 고아가 된다)
          const ph = await client.from('work_photos').select('path').eq('job_id', id).then(must);
          if (ph.length) must(await client.storage.from('work').remove(ph.map((p) => p.path)));
        }
        must(await client.from(table).delete().eq('id', id));
      },
      issueCard: (customerId) => client.rpc('issue_card', { p_customer: customerId }).then(must),
      revokeCard: (customerId) => client.rpc('revoke_card', { p_customer: customerId }).then(must),
      resolveRequest: (id) => client.from('work_card_requests').update({ resolved_at: new Date().toISOString() }).eq('id', id).select().single().then(must),
      async addPhoto(jobId, file, kind) {
        const blob = await shrink(file);
        const path = userId + '/' + jobId + '/' + rid() + '.jpg';
        // 1) 행으로 경로 예약 (요금제·장수 검사는 서버 트리거) → 2) 그 경로로만 업로드
        const row = await client.from('work_photos').insert({ job_id: jobId, path, kind: kind || 'etc' }).select().single().then(must);
        const up = await client.storage.from('work').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) { await client.from('work_photos').delete().eq('id', row.id); throw up.error; }
        return row;
      },
      async photoUrls(photos) {
        if (!photos.length) return {};
        const data = must(await client.storage.from('work').createSignedUrls(photos.map((p) => p.path), 300));
        const out = {};
        data.forEach((d) => { if (d.signedUrl) out[d.path] = d.signedUrl; });
        return out;
      },
      async removePhoto(photo) {
        must(await client.storage.from('work').remove([photo.path]));
        must(await client.from('work_photos').delete().eq('id', photo.id));
      }
    };
  }

  // ── 데모 저장소 (로그인 없이 체험, 저장 안 됨). 예시 데이터는 오늘 기준으로 만든다.
  function demoStore() {
    const now = new Date();
    const at = (dayOff, h, m) => { const d = L.addDays(now, dayOff); d.setHours(h, m || 0, 0, 0); return d.toISOString(); };
    const day = (dayOff) => L.dayKey(L.addDays(now, dayOff));
    let seq = 100;
    const C = (id, name, phone, address, extra) => Object.assign({ id, name, phone, address, memo: null, tag: null, revisit_months: null,
      revisit_snooze_until: null, card_token: null, created_at: at(-200 + id, 10), updated_at: at(-1, 10) }, extra || {});
    const customers = [
      C(1, '김민지', '01000000001', '인천 서구 청라동 123 청라푸르지오 101동 1203호', { revisit_months: 12, card_token: 'demo' }),
      C(2, '박준호', '01000000002', '인천 연수구 송도동 22 송도더샵 305동 801호', { tag: 'vip', revisit_months: 12 }),
      C(3, '이서연', '01000000003', '인천 남동구 구월동 1150 힐스테이트 12동 504호'),
      C(4, '(주)한빛상사', '01000000004', '인천 부평구 부평동 540 한빛빌딩 3층', { memo: '2026-08-02 시스템 4way 6대 정기 점검 계약 문의' }),
      C(5, '최영수', '01000000005', '인천 서구 검단동 88 검단자이 110동 1502호', { revisit_months: 6 }),
      C(6, '정하늘', '01000000006', '경기 김포시 구래동 6880 한강신도시 반도 201동 1101호', { tag: 'caution', memo: '주차 어려움. 방문 전 꼭 전화' }),
      C(7, '윤지훈', '01000000007', '인천 서구 가정동 505 루원시티 1702호', { revisit_months: 12 }),
      C(8, '한지우', '01000000008', '인천 서구 마전동 620 검단신도시 2단지 903호', { revisit_months: 12 })
    ];
    const I = (name, qty, price, unit, model) => ({ name, model: model || '', unit: unit || '대', qty, price });
    const J = (id, customer_id, o) => Object.assign({ id, customer_id, field: 'ac-clean', work_type: 'clean', status: 'booked', all_day: false,
      duration_min: null, complex_id: null, items: [], checklist: [], vat_mode: 'none', total_amount: 0, payments: [], memo: null,
      completed_at: null, source: null, referral_party: null, referral_fee: null, parent_job_id: null, warranty_months: null,
      created_at: at(-3, 9), updated_at: at(-1, 9) }, o);
    const withTotal = (j) => { j.total_amount = L.totals(j.items, j.vat_mode).total; return j; };
    const addr = (cid) => customers.find((c) => c.id === cid).address;
    const reg = (cid) => L.parseRegion(addr(cid));
    const jobs = [
      J(1, 1, { scheduled_at: at(0, 9), items: [I('벽걸이', 2, 90000), I('스탠드', 1, 140000)], source: 'blog' }),
      J(2, 2, { scheduled_at: at(0, 11, 30), field: 'ac-install', work_type: 'install', duration_min: 180,
        items: [I('벽걸이', 1, 150000, '대', 'LG 휘센'), I('배관 추가', 4, 25000, 'm'), I('앵글·거치대', 1, 60000, '개')], source: 'repeat' }),
      J(3, 3, { scheduled_at: at(0, 14), items: [I('시스템 4way', 1, 160000)], source: 'soomgo' }),
      J(4, 5, { scheduled_at: at(0, 16, 30), items: [I('벽걸이', 1, 90000), I('할인', 1, -10000, '식')], source: 'danggeun' }),
      J(5, 6, { scheduled_at: at(1, 10), items: [I('스탠드', 1, 140000), I('벽걸이', 3, 90000)], source: 'referral', referral_party: '청라설비' }),
      J(6, 4, { scheduled_at: at(1, 14), status: 'quote', field: 'ac-system', work_type: 'inspect', items: [I('시스템 4way', 6, 45000)], vat_mode: 'excl', source: 'direct' }),
      J(7, 7, { scheduled_at: at(3, 9), all_day: true, field: 'ac-install', work_type: 'move', items: [I('이전 설치', 1, 250000, '식')], source: 'repeat' }),
      J(8, 1, { scheduled_at: at(-370, 10), status: 'done', completed_at: at(-370, 12), items: [I('벽걸이', 2, 80000)], warranty_months: 3,
        payments: [{ amount: 160000, at: day(-370), method: 'transfer' }], source: 'blog' }),
      J(9, 2, { scheduled_at: at(-12, 10), status: 'done', completed_at: at(-12, 13), field: 'ac-install', work_type: 'install',
        items: [I('스탠드', 1, 200000, '대', '삼성 무풍'), I('배관 추가', 5, 25000, 'm')], warranty_months: 12,
        checklist: [{ label: '배관 길이(m)', value: '9' }, { label: '진공 시간(분)', value: '20' }, { label: '가스 압력(psi)', value: '130' }, { label: '누설 확인', value: '이상 없음' }],
        payments: [{ amount: 100000, at: day(-14), method: 'transfer' }], source: 'repeat' }),
      J(10, 3, { scheduled_at: at(-6, 15), status: 'done', completed_at: at(-6, 17), items: [I('벽걸이', 2, 90000)], payments: [], source: 'soomgo' }),
      J(11, 5, { scheduled_at: at(-190, 10), status: 'done', completed_at: at(-190, 12), items: [I('벽걸이', 1, 80000)], payments: [{ amount: 80000, at: day(-190), method: 'cash' }], source: 'danggeun' }),
      J(12, 7, { scheduled_at: at(-360, 10), status: 'done', completed_at: at(-360, 12), items: [I('스탠드', 1, 130000)], payments: [{ amount: 130000, at: day(-360), method: 'transfer' }], source: 'repeat' }),
      J(13, 6, { scheduled_at: at(-2, 13), status: 'done', completed_at: at(-2, 15), items: [I('벽걸이', 2, 90000)],
        checklist: [{ label: '분해 범위', value: '완전 분해' }, { label: '사용 약품', value: '중성 세정제' }, { label: '배수 확인', value: '정상' }],
        warranty_months: 1, payments: [{ amount: 180000, at: day(-2), method: 'transfer' }], source: 'referral' }),
      J(15, 8, { scheduled_at: at(-358, 10), status: 'done', completed_at: at(-358, 12), items: [I('벽걸이', 3, 80000)], payments: [{ amount: 240000, at: day(-358), method: 'transfer' }], source: 'blog' }),
      J(14, null, { scheduled_at: null, status: 'inquiry', address: '인천 서구 원당동', memo: '010-0000-0009 벽걸이 2대 세척 문의. 다음 주 평일 오전 희망', source: 'soomgo' })
    ].map((j) => { if (j.customer_id) { j.address = addr(j.customer_id); Object.assign(j, reg(j.customer_id)); } else Object.assign(j, L.parseRegion(j.address)); return withTotal(j); });
    // 지난 1년 매출 그래프용 완료 작업
    [[-30, 3, 1150000], [-60, 5, 2400000], [-90, 2, 3100000], [-120, 7, 2750000], [-150, 5, 1600000], [-210, 2, 900000], [-240, 3, 700000], [-270, 7, 1200000], [-300, 5, 800000], [-330, 3, 650000]]
      .forEach(([off, cid, amt], i) => jobs.push(withTotal(J(++seq, cid, { scheduled_at: at(off, 10), status: 'done', completed_at: at(off, 12),
        items: [I('월 합계(예시)', 1, amt, '식')], payments: [{ amount: amt, at: day(off), method: 'transfer' }],
        source: ['soomgo', 'repeat', 'blog', 'referral', 'danggeun'][i % 5], address: addr(cid), ...reg(cid) }))));
    const requests = [{ id: 1, customer_id: 1, kind: 'as', message: '작년에 세척한 벽걸이에서 물이 조금 떨어져요. 이번 주 가능할까요?', contact: '01000000001',
      created_at: at(0, 7, 40), resolved_at: null }];
    const state = {
      profile: { biz_name: '시원설비', owner_name: '김현장', phone: '01000000000', account: '농협 123-4567-8901-23 (김현장)',
        biz_no: null, intro: '에어컨 설치·세척 12년. 청라·검단·루원', quote_note: '현장 상황에 따라 배관·타공 추가 비용이 생길 수 있습니다.', logo_data: null, sms_templates: {} },
      customers, jobs, requests, photos: [], sub: null, isPro: true
    };
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const photoBlobs = {};
    return {
      isDemo: true,
      userId: 'demo',
      async load() { return clone(state); },
      async save(table, row) {
        const body = pick(table, row);
        if (table === 'work_profiles') { Object.assign(state.profile, body); return clone(state.profile); }
        const list = table === 'work_jobs' ? state.jobs : state.customers;
        if (row.id) {
          const t = list.find((x) => x.id === row.id);
          Object.assign(t, body);
          return clone(t);
        }
        const t = Object.assign({ id: ++seq, created_at: new Date().toISOString(), card_token: null }, body);
        list.unshift(t);
        return clone(t);
      },
      async remove(table, id) {
        const list = table === 'work_jobs' ? state.jobs : state.customers;
        const i = list.findIndex((x) => x.id === id);
        if (i >= 0) list.splice(i, 1);
        if (table === 'work_customers') {
          state.jobs.forEach((j) => { if (j.customer_id === id) j.customer_id = null; });
          state.requests = state.requests.filter((r) => r.customer_id !== id);
        }
        if (table === 'work_jobs') state.photos = state.photos.filter((p) => p.job_id !== id);
      },
      async issueCard(customerId) { const c = state.customers.find((x) => x.id === customerId); c.card_token = 'demo'; return 'demo'; },
      async revokeCard(customerId) { const c = state.customers.find((x) => x.id === customerId); c.card_token = null; },
      async resolveRequest(id) { const r = state.requests.find((x) => x.id === id); r.resolved_at = new Date().toISOString(); return clone(r); },
      async deleteRequest(id) { state.requests = state.requests.filter((r) => r.id !== id); },
      offline() { return null; },
      async addPhoto(jobId, file, kind) {
        if (state.photos.filter((p) => p.job_id === jobId).length >= L.PLAN.pro.photosPerJob) throw new Error('photo_limit_job');
        const p = { id: ++seq, job_id: jobId, path: 'demo/' + jobId + '/' + rid() + '.jpg', kind: kind || 'etc', created_at: new Date().toISOString() };
        photoBlobs[p.path] = URL.createObjectURL(await shrink(file));
        state.photos.push(p);
        return clone(p);
      },
      async photoUrls(photos) { const o = {}; photos.forEach((p) => { if (photoBlobs[p.path]) o[p.path] = photoBlobs[p.path]; }); return o; },
      async removePhoto(photo) { state.photos = state.photos.filter((p) => p.id !== photo.id); }
    };
  }

  window.ainWorkStore = { supabaseStore, demoStore, shrink, COLS, offlineKey };
})();
