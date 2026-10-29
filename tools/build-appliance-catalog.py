#!/usr/bin/env python3
"""가전 제원 수집 파일(hvac3d-lab/appliance-specs/raw/<삼성|LG>-<분류>.json 24개)을 합쳐 maker/3d/plan/data/appliance-catalog.json 을 만든다.
행의 값(치수·원문·출처)은 raw 그대로다 — 환산·반올림·추정·채우기 없음, null 은 미확인. 이 스크립트가 더하는 것은 id·brand 표기·placeable·whyNot 뿐이다.
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
MIN_MM, MAX_MM = 50, 5000
ROW_KEYS = ['model', 'modelCodes', 'name', 'category', 'series', 'capacityText', 'dimsRaw', 'widthMm', 'heightMm', 'depthMm', 'extraDims', 'weightText', 'notes', 'url', 'collectedAt', 'discontinued']
DROP_META = {'method': '수집 과정 설명(raw 에 있다)', 'installTexts': '설치 안내 문장 인용(raw 에 있다 — 행의 치수에는 쓰지 않았다고 raw 가 밝혔다)'}


def die(msg):
    sys.exit('build-appliance-catalog: ' + msg)


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def fmt(v):
    return str(int(v)) if float(v).is_integer() else repr(v)


def placeable(it):
    return all(is_num(it[k]) and MIN_MM <= it[k] <= MAX_MM for k, _ in AXES)


def why_not(it):
    """놓을 수 없는 행의 한국어 한 줄 — 그 행의 값에서만 만든다"""
    if placeable(it):
        return None
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
        ids = set()
        for it in d['items']:
            who = f"{fname} {it.get('model')}"
            if set(it) != set(ROW_KEYS):
                die(f'{who}: 행 칸이 다릅니다 {sorted(set(it) ^ set(ROW_KEYS))}')
            if it['category'] != cat:
                die(f'{who}: 행의 분류가 파일과 다릅니다')
            for k, _ in AXES:
                if it[k] is not None and not is_num(it[k]):
                    die(f'{who}: {k} 가 숫자도 null 도 아닙니다 {it[k]!r}')
            m = re.match(r'https://([^/]+)/', it['url'])
            if not m or m.group(1) not in URL_HOST[brand]:
                die(f"{who}: 출처 주소가 {brand} 공식 도메인이 아닙니다 {it['url']}")
            rid = f"{brand}-{cat}-{it['model']}"
            if rid in ids:
                die(f'{who}: id 가 겹칩니다')
            ids.add(rid)
            row = {'id': rid, 'brand': brand, 'category': cat, 'model': it['model'], 'modelCodes': it['modelCodes'], 'name': it['name'], 'series': it['series'], 'capacityText': it['capacityText'],
                   'widthMm': it['widthMm'], 'heightMm': it['heightMm'], 'depthMm': it['depthMm'], 'dimsRaw': it['dimsRaw'], 'extraDims': it['extraDims'], 'weightText': it['weightText'],
                   'url': it['url'], 'collectedAt': it['collectedAt'], 'discontinued': it['discontinued']}
            row['placeable'] = placeable(it)
            row['whyNot'] = why_not(it)
            rows.append(row)
        keep = {k: v for k, v in d['meta'].items() if k not in DROP_META}
        per_file[fname] = {'brand': brand, 'category': cat, 'sourcePage': d['sourceSiteUrl'], 'collectedAt': d['collectedAt'], 'sha256': hashlib.sha256(data).hexdigest(),
                           'rows': len(d['items']), 'skipped': len(d['skipped']), 'verifyLog': len(d['verifyLog']), **keep}
    dates = sorted({f['collectedAt'] for f in per_file.values()} | {r['collectedAt'] for r in rows})
    if len(dates) != 1:
        die(f'수집일이 하나가 아닙니다: {dates}')
    return rows, per_file, dates[0]


def build():
    rows, per_file, collected = load_raw()
    ids = [r['id'] for r in rows]
    if len(ids) != len(set(ids)):
        die('id 가 겹칩니다')
    by_cat = {c: {b: sum(1 for r in rows if r['category'] == c and r['brand'] == b) for b in BRANDS} for c, _, _ in CATEGORIES}
    for c in by_cat:
        by_cat[c]['total'] = by_cat[c]['samsung'] + by_cat[c]['lg']
    not_ok = [r for r in rows if not r['placeable']]
    kinds = {'치수 미확인(크기 줄 없음)': 0, '값이 하나로 적혀 있지 않아 정하지 않음': 0, '크기가 50~5000 mm 밖': 0}
    for r in not_ok:
        w = r['whyNot']
        kinds['치수 미확인(크기 줄 없음)' if w.startswith('치수 미확인') else '크기가 50~5000 mm 밖' if '놓을 수 있는 크기는' in w else '값이 하나로 적혀 있지 않아 정하지 않음'] += 1
    capped = [f for f, v in per_file.items() if v['rows'] == 80]
    handle = sum(1 for r in not_ok if r['whyNot'].startswith('깊이가 두 값(후면핸들'))
    discontinued = sum(1 for r in rows if r['discontinued'])
    meta = {
        'about': '삼성·LG 공식 페이지에 적힌 가전 제품 크기. 치수·원문·출처는 수집 파일(raw) 그대로이고 환산·반올림·추정으로 채운 값이 없다. null 은 미확인. 행의 notes 전문은 용량 때문에 뺐다(raw 에 있다).',
        'collectedAt': collected,
        'sourceSites': dict(SITES),
        'categories': [{'id': c, 'name': n, 'short': s} for c, n, s in CATEGORIES],
        'dims': 'widthMm=가로, heightMm=세로(높이), depthMm=깊이, 단위 mm. 값은 공식 페이지 원문(dimsRaw)의 숫자를 라벨 순서대로 읽은 것이고, 라벨 순서가 달라 바로잡은 행은 raw 파일 meta 에 적혀 있다.',
        'placeable': f'가로·높이·깊이가 모두 유한한 양수이고 각각 {MIN_MM}~{MAX_MM} mm 이면 true. 아니면 false 이고 whyNot 에 이유 한 줄. 놓을 수 없는 행도 목록에는 남는다.',
        'counts': {'rows': len(rows), 'placeable': len(rows) - len(not_ok), 'notPlaceable': len(not_ok), 'notPlaceableBy': kinds, 'discontinued': discontinued, 'byCategory': by_cat,
                   'byBrand': {b: sum(1 for r in rows if r['brand'] == b) for b in BRANDS}},
        'limits': [
            '번들(여러 제품을 묶은 상품)은 파일마다 다르게 처리했다. 어떻게 처리했는지는 files 의 coverage 와 raw 의 skipped 에 있다.',
            f"(브랜드×분류)당 80행 한도에 걸린 파일이 있다({', '.join(capped)}). 한도 밖 모델은 행이 되지 못했고, 어떤 모델이 빠졌는지는 파일별 coverage·skipped 에 있다.",
            f'깊이를 후면핸들 포함·미포함 두 값으로 병기한 냉장고는 depthMm 이 null 이라 놓을 수 없다({handle}행). 가로·높이는 원문 숫자 그대로 남아 있다.',
            'TV 의 치수(dimsRaw·widthMm·heightMm·depthMm)는 스탠드 포함 줄 기준이다(스탠드 포함 줄이 없는 모델만 스탠드 제외 줄). 스탠드 제외·스탠드 크기·VESA 는 extraDims 에 원문으로 있다.',
            '2in1(멀티) 에어컨은 스탠드 실내기 크기가 대표 치수이고 벽걸이 실내기·실외기 크기는 extraDims 에 있다.',
            '크기 칸에 값이 둘 이상이거나 숫자 하나로 읽히지 않는 표기(슬래시 두 값, 상하·좌우 두 설치 형태, 괄호 안 다른 값)는 해당 축을 null 로 두었다.',
            f'discontinued 는 raw 의 값 그대로다({discontinued}행이 true). 기준은 파일마다 coverage 에 적혀 있고, 삼성 냉장고는 페이지에서 판매 종료 여부를 알 수 없어 전부 false 이다.',
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
