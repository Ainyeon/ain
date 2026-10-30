#!/usr/bin/env python3
"""가전 제원 수집 파일(hvac3d-lab/appliance-specs/raw/<삼성|LG>-<분류>.json 24개)을 합쳐 maker/3d/plan/data/appliance-catalog.json 을 만든다.
행의 값(치수·원문·출처)은 raw 그대로다 — 환산·반올림·추정·채우기 없음, null 은 미확인. 이 스크립트가 더하는 것은 id·brand 표기·placeable·whyNot 과, 아래 두 가지 거르기뿐이다.
  - 이중 등재: 같은 (브랜드, 모델) 이 같은 주소로 두 분류에 있으면 한 행만 남긴다(DEDUP_FIRST 순서의 앞 분류). raw 는 건드리지 않는다.
  - 세트 상품: 제품명에 괄호 밖 '+' 가 있거나 큐브 공기청정기 2대 조합 표기 '(합계, 모듈+모듈㎡)' 이면 공식 치수가 한 대분이라 놓지 않는다(placeable false).
  - 값을 정하는 규칙 둘(dimsBasis 에 이유를 적는다 — 원문에 있는 숫자만 고른다, 만들어 내지 않는다): 냉장고 깊이가 '후면핸들 포함 / 미포함' 두 값이면 포함 값(실제로 차지하는 깊이), LG TV 의 스탠드 포함 크기에 높이가 'a/b' 로 두 값이면 큰 값.
카탈로그가 커서 행의 notes 전문은 뺀다(raw 에 있다). dimsRaw·extraDims·url 은 남긴다.
실행: python3 tools/build-appliance-catalog.py [--check]   (--check: 파일을 쓰지 않고 지금 파일과 같은지만 본다)
raw 위치: 환경변수 APPLIANCE_SPECS_DIR (기본 ~/repos/personal/hvac3d-lab/appliance-specs)
"""
import hashlib, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'maker', '3d', 'plan', 'data', 'appliance-catalog.json')
SPECS = os.environ.get('APPLIANCE_SPECS_DIR') or os.path.expanduser('~/repos/personal/hvac3d-lab/appliance-specs')
BRANDS = ['samsung', 'lg']
BRAND_RAW = {'samsung': {'삼성전자', 'samsung'}, 'lg': {'LG전자', 'lg'}}   # raw 의 brand 칸 표기(파일마다 달랐다) — 파일 이름 접두와 같은 브랜드여야 한다
SITES = {'samsung': 'https://www.samsung.com/sec/', 'lg': 'https://www.lge.co.kr/'}
URL_HOST = {'samsung': ('www.samsung.com',), 'lg': ('www.lge.co.kr', 'www.lge.com')}
# (분류, 이름표, 짧은 이름표) — 칩·평면도 글씨는 짧은 이름표, 에어컨만 길게 풀어 적는다
CATEGORIES = [
    ('refrigerator', '냉장고', '냉장고'), ('kimchi', '김치냉장고', '김치냉장고'), ('washer', '세탁기', '세탁기'), ('dryer', '건조기', '건조기'),
    ('washtower', '워시타워·워시콤보', '워시타워·워시콤보'), ('dishwasher', '식기세척기', '식기세척기'), ('styler', '의류관리기', '의류관리기'),
    ('airpurifier', '공기청정기', '공기청정기'), ('aircon', '에어컨(스탠드·벽걸이·창문형·이동식)', '에어컨'), ('tv', 'TV', 'TV'),
    ('cooking', '조리가전', '조리가전'), ('water', '정수기', '정수기'),
]
AXES = (('widthMm', '가로'), ('heightMm', '높이'), ('depthMm', '깊이'))
MIN_MM, MAX_MM = 5, 5000   # 5mm 아래는 단위·쪽 읽기 오류로 본다(초슬림 TV 9.95mm·인덕션 높이 40mm 는 실제 값)
ROW_KEYS = ['model', 'modelCodes', 'name', 'category', 'series', 'capacityText', 'dimsRaw', 'widthMm', 'heightMm', 'depthMm', 'extraDims', 'weightText', 'notes', 'url', 'collectedAt', 'discontinued']
OPT_KEYS = {'discontinuedBasis'}   # 삼성 raw 만 행마다 단종 판정 기준을 적는다(LG 는 없음 → 카탈로그에서 null)
ROW_CAP = 250   # raw 가 (브랜드×분류) 파일마다 두는 행 상한 — raw coverage 의 '총 250행 상한'
DEDUP_FIRST = ['washtower', 'washer']   # 같은 모델이 여러 분류에 있으면 앞 분류에 남긴다(콤보·원바디는 워시타워·워시콤보 소속)
SET_WHY = '세트 상품이라 공식 치수가 본체 한 대분만 적혀 있어 놓지 않습니다 · 구성품을 따로 놓아 주세요'
DISCONTINUED_BASIS = {
    'samsung': "삼성닷컴 상품 페이지에 '해당 상품은 현재 삼성닷컴에서 상품 정보 확인만 가능합니다' 문구가 보이면 true, 없으면 false. 삼성 지원 페이지·비즈니스 페이지처럼 이 문구가 나올 수 없는 페이지는 null(판정 불가)이고 행의 discontinuedBasis 에 이유가 있다.",
    'lg': "LG 제품 페이지의 '단종 제품입니다' 표기가 있으면 true. 한 모델의 색상 옵션 한 곳만 단종이면 true 로 두지 않는다. 파일마다 판매 상태 표기(비매품 등)를 같은 뜻으로 읽은 곳은 files 의 coverage 에 적혀 있다. LG raw 에는 행별 기준 칸이 없어 행의 discontinuedBasis 는 null 이다.",
}
DROP_META = {'method': '수집 과정 설명(raw 에 있다)', 'installTexts': '설치 안내 문장 인용(raw 에 있다 — 행의 치수에는 쓰지 않았다고 raw 가 밝혔다)'}


def die(msg):
    sys.exit('build-appliance-catalog: ' + msg)


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def fmt(v):
    return str(int(v)) if float(v).is_integer() else repr(v)


MODULES = re.compile(r'\(\s*\d+\s*,\s*\d+\s*\+\s*\d+\s*㎡\s*\)')   # 큐브 공기청정기 2대 조합 표기: (106, 53+53㎡) · (123, 70+53㎡) — 공식 크기 줄은 한 대분(두 모듈의 높이가 다른 70+53 은 한쪽만)


def is_set(name):
    """세트 상품 = 제품명에서 괄호 안을 뺀 글자에 '+' 가 있거나, 큐브 공기청정기의 '(합계, 모듈+모듈㎡)' 2대 조합 표기. 그 밖의 괄호 안 '+' 는 사양 표기다(예: (71.1mm LCD+다이얼))"""
    return '+' in re.sub(r'\([^)]*\)', '', name) or bool(MODULES.search(name))


NUM = r'(\d[\d,]*(?:\.\d+)?)'
TRIPLE = NUM + r'\s*[×xX]\s*' + NUM + r'\s*[×xX]\s*' + NUM
# '포함' 값이 따로 적힌 크기: '후면핸들 포함 : W × H × D' · '판넬포함) W x H x D mm' · 'W x H x D (손잡이 포함)' — 라벨이 숫자 앞이거나 뒤
INCLUDED = [(re.compile(r'후면핸들\s*포함\s*[):]?\s*' + TRIPLE + r'\s*mm'), '후면핸들 포함'), (re.compile(r'판넬\s*포함\s*[):]?\s*' + TRIPLE + r'\s*mm'), '판넬 포함'),
            (re.compile(TRIPLE + r'\s*\(손잡이\s*포함\)'), '손잡이 포함')]
TV_SLASH = re.compile(r'WxHxD, mm\)\s*' + NUM + r'\s*x\s*' + NUM + r'\s*/\s*' + NUM + r'\s*x\s*' + NUM + r'\s*$')


def num(s):
    return float(s.replace(',', ''))


def resolve(it):
    """raw 행에서 비어 있는 치수를, 같은 행 원문(extraDims·dimsRaw)에 적힌 숫자로 정한다. (가로, 높이, 깊이, 이유) — 정하지 못하면 raw 값 그대로, 이유 None.
    raw 에 값이 이미 있는 축과 원문이 어긋나면 정하지 않는다."""
    w, h, d = it['widthMm'], it['heightMm'], it['depthMm']
    texts = [t for t in [it['dimsRaw']] + list(it['extraDims']) if t]
    if it['category'] != 'tv':   # 포함 값 규칙: 이미 있는 축은 같아야 하고, 비어 있는 축(들)만 채운다. 표기가 둘 이상 맞으면 정하지 않는다
        found = {(i, tuple(num(m.group(k)) for k in (1, 2, 3))) for t in texts for i, (rx, _) in enumerate(INCLUDED) for m in [rx.search(t)] if m}   # 같은 표기가 dimsRaw·extraDims 양쪽에 있어도 한 번
        if len(found) == 1:
            i, v = next(iter(found))
            if all(x is None or x == y for x, y in zip((w, h, d), v)) and any(x is None for x in (w, h, d)):
                return v[0], v[1], v[2], f'크기는 {INCLUDED[i][1]} 값입니다(미포함 값은 크기 원문에 있습니다)'
    if it['category'] == 'tv' and h is None and it['dimsRaw']:
        m = TV_SLASH.search(it['dimsRaw'].strip())
        if m and all(x is None or x == num(y) for x, y in ((w, m.group(1)), (d, m.group(4)))):
            a, b = num(m.group(2)), num(m.group(3))
            return num(m.group(1)), max(a, b), num(m.group(4)), f'높이는 스탠드 두 값({fmt(a)}/{fmt(b)}) 중 큰 값입니다'
    return w, h, d, None


def dims_ok(it):
    return all(is_num(it[k]) and MIN_MM <= it[k] <= MAX_MM for k, _ in AXES)


def placeable(it):
    return dims_ok(it) and not is_set(it['name'])


def why_not(it):
    """놓을 수 없는 행의 한국어 한 줄 — 그 행의 값에서만 만든다(치수 이유가 먼저, 치수는 되는데 세트면 세트 이유)"""
    if placeable(it):
        return None
    if dims_ok(it):
        return SET_WHY
    vals = [it[k] for k, _ in AXES]
    if all(v is None for v in vals) and it['dimsRaw'] is None:
        return '치수 미확인 · 공식 페이지에 크기 줄이 없습니다'
    nulls = [n for (k, n) in AXES if it[k] is None]
    if nulls:
        if nulls == ['깊이'] and any('후면핸들 포함' in e for e in it['extraDims']) and any('후면핸들 미포함' in e for e in it['extraDims']):
            return '깊이가 두 값(후면핸들 포함·미포함)으로 적혀 있어 정하지 않았습니다'
        return f"{'·'.join(nulls)} 값이 하나로 적혀 있지 않아 정하지 않았습니다 · 공식 표기에 값이 둘 이상이거나 숫자 하나로 읽히지 않습니다"
    bad = [f'{n} {fmt(it[k])} mm' for k, n in AXES if not (MIN_MM <= it[k] <= MAX_MM)]
    return f"{', '.join(bad)} · 놓을 수 있는 크기는 각 {MIN_MM}~{MAX_MM} mm 입니다"


def load_raw():
    rawdir = os.path.join(SPECS, 'raw')
    files, rows, per_file = [], [], {}
    for cat, _, _ in CATEGORIES:
        for brand in BRANDS:
            files.append((brand, cat, f'{brand}-{cat}.json'))
    present = sorted(f for f in os.listdir(rawdir) if f.endswith('.json'))
    if present != sorted(f for _, _, f in files):
        die(f'raw 파일 구성이 다릅니다: {sorted(set(present) ^ set(f for _, _, f in files))}')
    for brand, cat, fname in files:
        data = open(os.path.join(rawdir, fname), 'rb').read()
        d = json.loads(data.decode('utf-8'))
        if d['category'] != cat or d['brand'] not in BRAND_RAW[brand]:
            die(f"{fname}: brand/category 칸이 파일 이름과 다릅니다 ({d['brand']!r}, {d['category']!r})")
        if len(d['items']) > ROW_CAP:
            die(f"{fname}: 행이 상한 {ROW_CAP} 을 넘습니다 ({len(d['items'])})")
        ids = set()
        for it in d['items']:
            who = f"{fname} {it.get('model')}"
            if not set(ROW_KEYS) <= set(it) <= set(ROW_KEYS) | OPT_KEYS:
                die(f'{who}: 행 칸이 다릅니다 {sorted(set(it) ^ set(ROW_KEYS))}')
            if it['category'] != cat:
                die(f'{who}: 행의 분류가 파일과 다릅니다')
            for k, _ in AXES:
                if it[k] is not None and not is_num(it[k]):
                    die(f'{who}: {k} 가 숫자도 null 도 아닙니다 {it[k]!r}')
            m = re.match(r'https://([^/]+)/', it['url'])
            if not m or m.group(1) not in URL_HOST[brand]:
                die(f"{who}: 출처 주소가 {brand} 공식 도메인이 아닙니다 {it['url']}")
            basis = it.get('discontinuedBasis')
            if it['discontinued'] is not None and not isinstance(it['discontinued'], bool):
                die(f"{who}: discontinued 가 true/false/null 이 아닙니다 {it['discontinued']!r}")
            if it['discontinued'] is None and not (isinstance(basis, str) and '판정 불가' in basis):
                die(f'{who}: discontinued 가 null 인데 판정 불가 이유(discontinuedBasis)가 없습니다')
            if basis is not None and not (isinstance(basis, str) and basis):
                die(f'{who}: discontinuedBasis 가 글자가 아닙니다')
            rid = f"{brand}-{cat}-{it['model']}"
            while rid in ids:   # 한 파일 안에서 같은 모델이 또 나오면 id 에 ~2 를 붙여 걸러내지 않는다(같은 주소면 dedup 이 멈춘다, 다른 주소면 meta.dedup.sameModelDifferentUrl 에 남는다)
                rid += '~2'
            ids.add(rid)
            eff = dict(it)
            eff['widthMm'], eff['heightMm'], eff['depthMm'], basis_dims = resolve(it)
            row = {'id': rid, 'brand': brand, 'category': cat, 'model': it['model'], 'modelCodes': it['modelCodes'], 'name': it['name'], 'series': it['series'], 'capacityText': it['capacityText'],
                   'widthMm': eff['widthMm'], 'heightMm': eff['heightMm'], 'depthMm': eff['depthMm'], 'dimsBasis': basis_dims, 'dimsRaw': it['dimsRaw'], 'extraDims': it['extraDims'], 'weightText': it['weightText'],
                   'url': it['url'], 'collectedAt': it['collectedAt'], 'discontinued': it['discontinued'], 'discontinuedBasis': basis}
            row['placeable'] = placeable(eff)
            row['whyNot'] = why_not(eff)
            rows.append(row)
        keep = {k: v for k, v in d['meta'].items() if k not in DROP_META}
        per_file[fname] = {'brand': brand, 'category': cat, 'sourcePage': d['sourceSiteUrl'], 'collectedAt': d['collectedAt'], 'sha256': hashlib.sha256(data).hexdigest(),
                           'rows': len(d['items']), 'skipped': len(d['skipped']), 'skippedByRowCap': sum(1 for s in d['skipped'] if '상한' in s['reason']), 'verifyLog': len(d['verifyLog']), **keep}
    dates = sorted({f['collectedAt'] for f in per_file.values()} | {r['collectedAt'] for r in rows})
    if len(dates) != 1:
        die(f'수집일이 하나가 아닙니다: {dates}')
    return rows, per_file, dates[0]


def dedup(rows, per_file):
    """같은 (브랜드, 모델) 이 같은 주소로 여러 행이면 DEDUP_FIRST 의 앞 분류 한 행만 남긴다. 주소가 다르면(같은 분류 안이든 아니든) 걸러내지 않고 기록만 한다."""
    groups, drop, pairs, differ = {}, set(), [], []
    for r in rows:
        groups.setdefault((r['brand'], r['model']), []).append(r)
    for (brand, model), g in groups.items():
        if len(g) < 2:
            continue
        by_url = {}
        for r in g:
            by_url.setdefault(r['url'], []).append(r)
        if len(by_url) > 1:
            differ.append({'brand': brand, 'model': model, 'rows': [{'id': r['id'], 'category': r['category'], 'url': r['url']} for r in g]})
        for url, same in by_url.items():
            if len(same) < 2:
                continue
            cats = [r['category'] for r in same]
            if len(set(cats)) < len(cats) or not set(cats) <= set(DEDUP_FIRST):
                die(f'{brand} {model}: 같은 주소가 {cats} 에 겹칩니다 — DEDUP_FIRST 에 우선순위를 정하거나 raw 를 고쳐야 합니다')
            keep = min(same, key=lambda r: DEDUP_FIRST.index(r['category']))
            gone = [r for r in same if r is not keep]
            drop.update(r['id'] for r in gone)
            pairs.append({'brand': brand, 'model': model, 'kept': keep['category'], 'dropped': [r['category'] for r in gone]})
    kept = [r for r in rows if r['id'] not in drop]
    for f in per_file.values():
        f['rowsInCatalog'] = sum(1 for r in kept if r['brand'] == f['brand'] and r['category'] == f['category'])
    return kept, pairs, differ


def why_kind(w):
    return ('세트 상품' if w == SET_WHY else '치수 미확인(크기 줄 없음)' if w.startswith('치수 미확인') else '크기가 5~5000 mm 밖' if '놓을 수 있는 크기는' in w
            else '값이 하나로 적혀 있지 않아 정하지 않음')


def build():
    rows, per_file, collected = load_raw()
    raw_rows = len(rows)
    rows, pairs, differ = dedup(rows, per_file)
    ids = [r['id'] for r in rows]
    if len(ids) != len(set(ids)):
        die('id 가 겹칩니다')
    by_cat = {c: {b: sum(1 for r in rows if r['category'] == c and r['brand'] == b) for b in BRANDS} for c, _, _ in CATEGORIES}
    for c in by_cat:
        by_cat[c]['total'] = by_cat[c]['samsung'] + by_cat[c]['lg']
    not_ok = [r for r in rows if not r['placeable']]
    kinds = {k: 0 for k in ('치수 미확인(크기 줄 없음)', '값이 하나로 적혀 있지 않아 정하지 않음', '크기가 5~5000 mm 밖', '세트 상품')}
    for r in not_ok:
        kinds[why_kind(r['whyNot'])] += 1
    sets = [r for r in rows if is_set(r['name'])]
    reached = [f for f, v in per_file.items() if v['rows'] == ROW_CAP]
    cut = [f for f, v in per_file.items() if v['skippedByRowCap']]
    handle = sum(1 for r in not_ok if r['whyNot'].startswith('깊이가 두 값(후면핸들'))
    basis_tv = sum(1 for r in rows if r['dimsBasis'] and r['dimsBasis'].startswith('높이는 스탠드'))
    disc = {b: {k: sum(1 for r in rows if r['brand'] == b and r['discontinued'] is v) for k, v in (('true', True), ('false', False), ('null', None))} for b in BRANDS}
    disc['total'] = {k: disc['samsung'][k] + disc['lg'][k] for k in ('true', 'false', 'null')}
    meta = {
        'about': '삼성·LG 공식 페이지에 적힌 가전 제품 크기. 치수·원문·출처는 수집 파일(raw)의 숫자이고 환산·반올림·추정으로 만든 값이 없다. raw 에서 비어 있던 칸을 같은 행 원문의 숫자로 정한 행은 dimsBasis 에 이유가 있다. null 은 미확인. 행의 notes 전문은 용량 때문에 뺐다(raw 에 있다).',
        'collectedAt': collected,
        'sourceSites': dict(SITES),
        'categories': [{'id': c, 'name': n, 'short': s} for c, n, s in CATEGORIES],
        'dims': 'widthMm=가로, heightMm=세로(높이), depthMm=깊이, 단위 mm. 값은 공식 페이지 원문(dimsRaw)의 숫자를 라벨 순서대로 읽은 것이고, 라벨 순서가 달라 바로잡은 행은 raw 파일 meta 에 적혀 있다.',
        'dimsBasis': "raw 의 치수 칸이 비어 있어도 같은 행 원문에 숫자가 하나로 정해지면 그 값을 쓰고 이유를 적는다. 후면핸들 포함·미포함 두 깊이는 포함 값, 스탠드 높이 'a/b' 두 값은 큰 값. 그 밖에는 null.",
        'placeable': f"가로·높이·깊이가 모두 유한한 양수이고 각각 {MIN_MM}~{MAX_MM} mm 이며 세트 상품이 아니면 true. 아니면 false 이고 whyNot 에 이유 한 줄. 놓을 수 없는 행도 목록에는 남는다.",
        'counts': {'rows': len(rows), 'rawRows': raw_rows, 'placeable': len(rows) - len(not_ok), 'notPlaceable': len(not_ok), 'notPlaceableBy': kinds, 'discontinued': disc, 'byCategory': by_cat,
                   'byBrand': {b: sum(1 for r in rows if r['brand'] == b) for b in BRANDS}},
        'dedup': {
            'rule': "같은 (브랜드, 모델) 이 같은 공식 주소로 두 분류에 있으면 한 행만 남긴다. 워시타워·워시콤보 분류를 세탁기 분류보다 우선한다(콤보·원바디는 워시타워·워시콤보 소속). raw 파일은 바꾸지 않았다. 주소가 다른 같은 (브랜드, 모델) 은 걸러내지 않고 sameModelDifferentUrl 에 남긴다.",
            'priority': list(DEDUP_FIRST),
            'pairs': len(pairs),
            'rawRows': raw_rows,
            'keptCategory': dict(sorted({k: sum(1 for p in pairs if p['kept'] == k) for k in {p['kept'] for p in pairs}}.items())),
            'droppedCategory': dict(sorted({k: sum(p['dropped'].count(k) for p in pairs) for k in {c for p in pairs for c in p['dropped']}}.items())),
            'list': pairs,
            'sameModelDifferentUrl': differ,
        },
        'sets': {
            'rule': "제품명에서 괄호 안을 뺀 글자에 '+' 가 있으면 세트 상품이다. 공식 치수가 본체 한 대분만 적혀 있어 놓을 수 없다(placeable false). 큐브 공기청정기의 2대 조합 표기 '(합계, 모듈+모듈㎡)' 도 세트다(공식 크기 줄이 한 대분). 그 밖의 괄호 안 '+' 는 사양 표기라 세트가 아니다(예: (71.1mm LCD+다이얼)). 치수가 비어 있는 세트 행은 치수 이유가 먼저 보인다.",
            'rows': len(sets),
            'byCategory': {c: sum(1 for r in sets if r['category'] == c) for c, _, _ in CATEGORIES if any(r['category'] == c for r in sets)},
        },
        'rowCap': {
            'perFile': ROW_CAP,
            'reached': [{'file': f, 'rows': per_file[f]['rows']} for f in reached],
            'skippedByCap': [{'file': f, 'skipped': per_file[f]['skippedByRowCap']} for f in cut],
        },
        'discontinuedBasis': DISCONTINUED_BASIS,
        'limits': [
            '번들(여러 제품을 묶은 상품)은 파일마다 다르게 처리했다. 어떻게 처리했는지는 files 의 coverage 와 raw 의 skipped 에 있다.',
            f"(브랜드×분류) 파일마다 행 상한 {ROW_CAP} 이 있다. 상한에 닿은 파일: {', '.join(reached)}. 상한 때문에 뺀 모델이 skipped 에 적힌 파일: {', '.join(cut)}. 어떤 모델이 빠졌는지는 파일별 coverage·skipped 에 있다.",
            f"깊이를 후면핸들 포함·미포함 두 값으로 병기한 냉장고는 포함 값을 깊이로 쓴다(미포함 값은 extraDims 원문, 행의 dimsBasis 에 이유). 가로·높이가 raw 와 달라 정하지 못한 {handle}행은 놓을 수 없다.",
            f"LG TV 의 스탠드 포함 크기에 높이가 'a/b' 두 값으로 적힌 {basis_tv}행은 큰 값을 높이로 쓴다(dimsBasis 에 두 값).",
            'TV 의 치수(dimsRaw·widthMm·heightMm·depthMm)는 스탠드 포함 줄 기준이다(스탠드 포함 줄이 없는 모델만 스탠드 제외 줄). 스탠드 제외·스탠드 크기·VESA 는 extraDims 에 원문으로 있다.',
            '2in1(멀티) 에어컨은 스탠드 실내기 크기가 대표 치수이고 벽걸이 실내기·실외기 크기는 extraDims 에 있다.',
            '크기 칸에 값이 둘 이상이거나 숫자 하나로 읽히지 않는 표기(슬래시 두 값, 상하·좌우 두 설치 형태, 괄호 안 다른 값)는 해당 축을 null 로 두었다.',
            f"discontinued 는 raw 의 값 그대로다(true {disc['total']['true']}행 · false {disc['total']['false']}행 · null {disc['total']['null']}행). 기준은 discontinuedBasis 에 있고 null 은 판정 불가이며 카드에 단종 표시를 달지 않는다.",
        ],
        'source': {'dir': 'hvac3d-lab/appliance-specs/raw', 'builder': 'tools/build-appliance-catalog.py', 'omittedMeta': DROP_META},
        'files': per_file,
    }
    return meta, rows


def dump(meta, rows):
    head = json.dumps({'meta': meta}, ensure_ascii=False, indent=2)[:-2]   # '}' 앞에서 끊고 items 를 한 줄씩 붙인다
    body = ',\n'.join('    ' + json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows)
    return head + ',\n  "items": [\n' + body + '\n  ]\n}\n'


if __name__ == '__main__':
    text = dump(*build())
    if '--check' in sys.argv:
        same = os.path.exists(OUT) and open(OUT, encoding='utf-8').read() == text
        print('appliance-catalog.json 은 raw 와 ' + ('같습니다' if same else '다릅니다 — python3 tools/build-appliance-catalog.py 로 다시 만드세요'))
        sys.exit(0 if same else 1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(text)
    print('쓴 파일:', os.path.normpath(OUT), len(text.encode('utf-8')), 'bytes')
