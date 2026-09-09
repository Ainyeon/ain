#!/usr/bin/env python3
"""검수 원장 CSV -> /assets/data/education.json 변환 + 검증.

원칙 (CODE_IMPLEMENTATION_SPEC §3):
  - 원문 문자열은 손대지 않고 그대로 옮긴다. 파생값은 필터용 코드만 추가한다.
  - 미래 교육일 != 모집중 != 여석. 세 축을 각각 별도 필드로 유지한다.
  - 원문 내부 표기 충돌(날짜 3건 / 비용 1건)은 감추지 않는다.
  - 표기가 없다는 사실에서 결론을 만들지 않는다 -> 'unknown'.

실행: python3 tools/build-edu-json.py
     (assert 실패 = 원장과 화면 계수가 어긋난 것. 커밋 전 반드시 통과)
"""
import csv, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'education-seed.csv')
OUT = os.path.join(ROOT, 'assets', 'data', 'education.json')

# 업무분류 원문 -> 필터 코드. 원문 라벨은 항상 그대로 표시하고, 코드는 필터에만 쓴다.
FIELD_KEYWORDS = [
    ('hvac',       ['에어컨', '냉동공조', '공조냉동', '설비·에너지']),
    ('plumbing',   ['설비', '배관']),
    ('tile',       ['타일', '욕실', '조적']),
    ('waterproof', ['방수']),
    ('film',       ['필름']),
    ('carpentry',  ['목공', '수장']),
    ('paint',      ['도장']),
    ('interior',   ['인테리어']),
    ('grout',      ['줄눈', '코팅']),
    ('clean',      ['입주청소', '청소']),
    ('furniture',  ['부엌', '수납', '창호', '도어', '마루', '침대', '소파']),
]
FIELD_LABELS = {
    'hvac': '에어컨·공조', 'plumbing': '설비·배관', 'tile': '타일·욕실',
    'waterproof': '방수', 'film': '인테리어 필름', 'carpentry': '목공·수장',
    'paint': '도장', 'interior': '인테리어 종합', 'grout': '줄눈·코팅',
    'clean': '입주청소', 'furniture': '가구·창호',
}
SIDO = ['서울', '인천', '경기', '부산', '대구', '광주', '대전', '울산', '세종',
        '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']


def work_fields(raw):
    hit = []
    for code, keys in FIELD_KEYWORDS:
        if any(k in raw for k in keys) and code not in hit:
            hit.append(code)
    return hit


def region_code(raw):
    """지역 원문에서 필터용 지역 토큰만 뽑는다. 광역 접두가 없으면 첫 토큰을 그대로 쓴다
    (예: '논산 인재개발원' -> '논산'). 원문에 없는 광역시도를 추론하지 않는다."""
    if not raw or '원문에 없음' in raw or '해당 없음' in raw:
        return '미확인'
    for s in SIDO:
        if s in raw:
            return s
    tok = re.split(r'[\s(,·]', raw.strip())[0]
    return tok or '미확인'


NEGATION = ['아님', '아닙니다', '아니', '불가', '없음', '제외']


def target_level(raw):
    """대상 필터. 원문 근거가 있을 때만 분류하고 나머지는 unknown.

    긍정 문구만 보고 기울이지 않는다 (SPEC §3.4): '초보가 누구나 수강하는 과정이 아님'
    같은 부정문에서 '누구나'를 뽑아 초보 가능으로 만들면 안 된다. 문장 단위로 끊어
    부정 표지가 없는 문장에서만 초보 판정을 받는다.
    """
    if not raw or '원문에 없음' in raw:
        return 'unknown'
    sentences = [s for s in re.split(r'[.。\n]', raw) if s.strip()]
    for s in sentences:
        if any(n in s for n in NEGATION):
            continue
        if '경력 무관' in s or '누구나' in s:
            return 'beginner'
    if re.search(r'경력.{0,8}(이상|미만)', raw) or '유경험' in raw or '선수학습' in raw:
        return 'experience'
    if any(k in raw for k in ['심사', '등록 후', '대상 기술인력', '근로자', '중장년', '미취업', '대상자']):
        return 'condition'
    return 'unknown'


def cost_level(subsidy_raw, cost_raw):
    """비용 조건 필터. 국비 표기 있음 / 자비(원문에 청구 금액) / 미확인."""
    if '해당 없음' in (subsidy_raw or ''):
        return 'unknown'
    positive = ['내일배움카드 사용 가능', '국비', '국가 지원', '국기훈련', '국민내일배움카드']
    negative = ['사용불가', '사용 불가']
    if any(k in subsidy_raw for k in positive) and not any(n in subsidy_raw for n in negative):
        return 'subsidy'
    # 원문에 실제 청구 금액이 있으면 자비. '무료'는 자비도 국비도 아니므로 미확인으로 남긴다.
    if re.search(r'[0-9][0-9,]*\s*원|[0-9]+\s*만원', cost_raw or ''):
        return 'self'
    return 'unknown'



URL_RE = re.compile(r'https?://[^\s\u3131-\uD79D()\[\],]+')


def split_url(raw):
    """URL 열에서 실제 HTTP(S) URL만 뽑고 나머지 설명은 note로 분리한다.
    원장이 괄호 설명이나 둘째 URL을 같은 칸에 담아도 href에 통째로 들어가지 않게 한다."""
    raw = (raw or '').strip()
    if not raw:
        return '', ''
    urls = URL_RE.findall(raw)
    if not urls:
        return '', raw
    rest = URL_RE.sub('', raw).strip(' .,()[]')
    if len(urls) > 1:
        rest = ('추가 URL: ' + ' '.join(urls[1:]) + (' ' + rest if rest else '')).strip()
    return urls[0], rest


DATE_RE = re.compile(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?')


def apply_end_at(raw):
    """접수 마감이 원문에서 하나로 확정될 때만 ISO 값을 만든다.

    시각 기준 '마감 경과'를 화면에서 계산하기 위한 필드다. 원문에 없거나(=모름)
    한 칸에 날짜가 둘 이상이면(=충돌) None으로 두고 어느 쪽으로도 기울이지 않는다.
    시각 표기가 없으면 그날 끝(23:59)까지로 본다 — 마감을 앞당겨 잡지 않기 위해서다.
    """
    raw = (raw or '').strip()
    if not raw or '원문에 없음' in raw or '해당 없음' in raw:
        return None
    hits = DATE_RE.findall(raw)
    if len(hits) != 1:
        return None
    y, mo, d, hh, mm = hits[0]
    return '%04d-%02d-%02dT%02d:%02d:00+09:00' % (
        int(y), int(mo), int(d), int(hh) if hh else 23, int(mm) if mm else 59)


def group_of(row):
    """목록 섹션. 세 축(일정/접수/여석)을 섞지 않는다."""
    if row['record_type'].startswith('채용접점'):
        return 'excluded'
    if row['접수문구_유무'] == '접수 마감일시 명시':
        return 'deadline'
    if row['현재상태_라벨'].startswith('모집 공고 게시'):
        return 'posted_no_deadline'
    return 'unconfirmed'


def conflict_of(raw):
    if not raw or raw.startswith('관찰 범위에서 없음') or raw.startswith('해당 없음'):
        return None
    kind = 'date' if raw.startswith('[날짜') else 'cost' if raw.startswith('[비용') else 'other'
    return {'kind': kind, 'text': raw}



def self_test():
    """파생 규칙의 최소 회귀 검사 — 부정문 오분류와 지역 추론 금지."""
    assert target_level('무경력 초보가 누구나 수강하는 과정이 아님. 냉매 현장경력 1년 이상 5년 미만') == 'experience'
    assert target_level('학력·경력 무관, 누구나 처음부터') == 'beginner'
    assert target_level('보수교육 대상 기술인력. 신규교육 이수자 기준은 보조출처 참조. 서류 확인 후 접수완료') == 'condition'
    assert target_level('원문에 없음') == 'unknown'
    assert region_code('논산 인재개발원(오프라인)') == '논산'      # 충남으로 추론하지 않는다
    assert region_code('인천본원(인천 남동구 소래로 688), 오프라인') == '인천'
    assert region_code('원문에 없음') == '미확인'
    assert cost_level('원문에 없음', '23만원') == 'self'
    assert cost_level('원문에 없음', '교육비 무료. 중식 제공') == 'unknown'   # 무료 != 자비 != 국비
    assert cost_level('내일배움카드 사용불가', '원문에 없음') == 'unknown'
    assert cost_level('국민내일배움카드 사용 가능', '원문에 없음') == 'subsidy'
    assert apply_end_at('~ 2026.10.09 18:00') == '2026-10-09T18:00:00+09:00'
    assert apply_end_at('2026.10.09') == '2026-10-09T23:59:00+09:00'   # 시각 없으면 그날 끝까지
    assert apply_end_at('원문에 없음') is None
    assert apply_end_at('상단 2026-08-19 / 본문 2026-08-24') is None   # 충돌은 어느 쪽도 고르지 않음
    assert split_url('http://a.test/x') == ('http://a.test/x', '')
    assert split_url('http://a.test/x (목록) http://b.test/y')[0] == 'http://a.test/x'
    assert '추가 URL: http://b.test/y' in split_url('http://a.test/x (목록) http://b.test/y')[1]
    assert split_url('') == ('', '')


def main():
    self_test()
    with open(SRC, encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))

    items = []
    for r in rows:
        raw_field = r['업무분류']
        items.append({
            'id': r['EDU_ID'],
            'record_type': r['record_type'],
            'org': r['기관명'],
            'course': r['과정명'],
            'course_class': r['과정분류'],
            'work_raw': raw_field,
            'work_codes': work_fields(raw_field),
            'region_raw': r['지역_온라인'],
            'region_code': region_code(r['지역_온라인']),
            'target_raw': r['대상_경력_원문'],
            'target_level': target_level(r['대상_경력_원문']),
            'posted_raw': r['원문_등록일시'],
            'schedule_raw': r['일정_원문표기'],
            'schedule_meaning': r['일정의_의미'],
            'apply_start_raw': r['접수시작_원문'],
            'apply_end_raw': r['접수마감_원문'],
            'apply_end_at': apply_end_at(r['접수마감_원문']),
            'apply_notice': r['접수문구_유무'],
            'capacity_raw': r['정원_원문'],
            'seats_level': r['여석_확인수준'],
            'conflict': conflict_of(r['원문내부_표기충돌']),
            'status_label': r['현재상태_라벨'],
            'cost_raw': r['비용_원문표기'],
            'cost_condition': r['비용_적용조건'],
            'subsidy_raw': r['국비_원문표기'],
            'cost_level': cost_level(r['국비_원문표기'], r['비용_원문표기']),
            'practice_raw': r['실습_시간_원문'],
            'cert_type': r['자격유형'],
            'cert_basis': r['자격_구분근거'],
            'org_claim': r['기관주장_문구'],
            'url': split_url(r['공식원문URL'])[0],
            'url_note': split_url(r['공식원문URL'])[1],
            'url_aux': split_url(r['보조출처URL'])[0],
            'url_aux_note': split_url(r['보조출처URL'])[1],
            'source_limit': r['출처한계'],
            'checked_at': r['최종확인일'],
            'unknowns': r['모르는항목'],
            'exposure': r['출시노출'],
            'verified_by': r['조사자_검증'],
            'group': group_of(r),
        })

    listed = [i for i in items if i['group'] != 'excluded']
    counts = {
        'rows': len(items),
        'education': len(listed),
        'excluded_recruit': len(items) - len(listed),
        'orgs': len({i['org'] for i in listed}),
        'by_group': {g: sum(1 for i in listed if i['group'] == g)
                     for g in ('deadline', 'posted_no_deadline', 'unconfirmed')},
        'by_record_type': {t: sum(1 for i in listed if i['record_type'] == t)
                           for t in sorted({i['record_type'] for i in listed})},
        'conflict_date': sum(1 for i in listed if i['conflict'] and i['conflict']['kind'] == 'date'),
        'conflict_cost': sum(1 for i in listed if i['conflict'] and i['conflict']['kind'] == 'cost'),
    }

    # ── 원장과 화면 계수가 어긋나면 여기서 멈춘다 (SPEC §3.2 / §3.3) ──
    assert counts['rows'] == 15, counts
    assert counts['education'] == 14, counts
    assert counts['excluded_recruit'] == 1, counts
    assert counts['orgs'] == 7, counts
    assert counts['by_group'] == {'deadline': 6, 'posted_no_deadline': 2, 'unconfirmed': 6}, counts
    assert counts['by_record_type'] == {'과정소개': 4, '기관과정목록': 2, '모집회차': 8}, counts
    assert counts['conflict_date'] == 3, counts   # KRRC 112 / 110 / 116
    assert counts['conflict_cost'] == 1, counts   # 한국건설직업전문학원 성남
    # 공식원문URL은 작동하는 단일 URL 하나만 (SPEC §11.1). 보조출처도 href에 들어가므로 같은 규칙.
    for i in items:
        assert i['url'].startswith('http') and ' ' not in i['url'], i['id']
        assert not i['url_note'], (i['id'], i['url_note'])
        assert i['url_aux'] == '' or (i['url_aux'].startswith('http') and ' ' not in i['url_aux']), i['id']
    # 접수 마감이 확정된 회차만 ISO 값을 갖는다 (마감 경과 계산용)
    assert sum(1 for i in listed if i['apply_end_at']) == 6, \
        [(i['id'], i['apply_end_at']) for i in listed]

    payload = {
        'source': 'EDUCATION_SEED_REVIEWED.csv (검수 원장 15행) — tools/education-seed.csv',
        'checked_at': max(i['checked_at'] for i in items),
        'counts': counts,
        'field_labels': FIELD_LABELS,
        'items': items,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('OK', OUT, json.dumps(counts, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
