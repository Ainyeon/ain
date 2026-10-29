#!/usr/bin/env python3
"""제원 폴더(hvac-specs)의 CSV 에서 천장형 실내기만 뽑아 maker/3d/plan/data/ac-catalog.json 을 만든다.
값은 CSV 원문 그대로(빈칸=null). 추정·환산·반올림 없음 — 숫자 칸(coolingKw 등)은 원문이 일반 숫자일 때만 채운다.
실행: python3 tools/build-ac-catalog.py [--check]   (--check: 파일을 쓰지 않고 지금 파일과 같은지만 본다)
제원 폴더 위치: 환경변수 HVAC_SPECS_DIR (기본 ~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/Personal/reference/hvac-specs)
"""
import csv, hashlib, io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'maker', '3d', 'plan', 'data', 'ac-catalog.json')
SPECS = os.environ.get('HVAC_SPECS_DIR') or os.path.expanduser('~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/Personal/reference/hvac-specs')
BRANDS = [('samsung', 'samsung.csv'), ('lg', 'lg.csv')]
FORMS = ('1way', '2way', '4way', '360')          # 천장형 실내기 형태(CSV form 칸). 스탠드·벽걸이·실외기는 제외
MINI_4WAY_MAX_BODY_W_MM = 600                     # 4way 중 본체 가로가 이보다 작으면 미니 4Way (삼성 575 / 일반 4way 는 840 이상)
VERBATIM = ['series', 'cooling_kw', 'heating_kw', 'pyeong', 'area_m2', 'hp', 'power_supply', 'power_cooling_w', 'power_heating_w', 'energy_grade',
            'body_size_mm', 'panel_size_mm', 'weight_kg', 'refrigerant', 'pipe_liquid', 'pipe_gas', 'paired_outdoor', 'source_url', 'checked_date', 'note', 'verified']


def die(msg):
    sys.exit('build-ac-catalog: ' + msg)


def dims(text, who, col):
    """'1,198×35×500' · '840×204×840mm' · '1,050 × 330 × 1,050' · '1,000×66×1,000 (PC6NUDK1NW)' → [w, h, d] (정수·소수 그대로). 칸이 비면 None, 읽을 수 없으면 중단"""
    if not text:
        return None
    t = re.sub(r'\(.*?\)', '', text).replace('mm', '').replace(',', '').replace(' ', '')
    parts = t.split('×')
    if len(parts) != 3 or not all(re.fullmatch(r'\d+(\.\d+)?', p) for p in parts):
        die(f'{who} {col} 치수를 읽지 못했습니다: {text!r}')
    return [float(p) if '.' in p else int(p) for p in parts]


def plain_kw(text):
    """원문이 일반 숫자('6.00' '7.2' '11')일 때만 숫자로. '4,000W' 같은 W 표기·빈칸은 환산하지 않고 None"""
    return float(text) if re.fullmatch(r'\d+(\.\d+)?', text) else None


def readme_blocks():
    """README.md 의 '규칙'·'신뢰도' 절 글머리 줄을 원문 그대로, 수집일(frontmatter checked)"""
    src = open(os.path.join(SPECS, 'README.md'), encoding='utf-8').read()
    m = re.search(r'^checked:\s*(\S+)', src, re.M)
    out = {'checked': m.group(1) if m else None}
    for key, head in (('rules', '규칙'), ('reliability', '신뢰도')):
        sec = re.search(r'^## ' + head + r'.*?\n(.*?)(?=^## |\Z)', src, re.M | re.S)
        if not sec:
            die(f'README.md 에 "## {head}" 절이 없습니다')
        out[key] = [ln[2:].strip() for ln in sec.group(1).splitlines() if ln.startswith('- ')]
        if not out[key]:
            die(f'README.md "## {head}" 절에 글머리 줄이 없습니다')
    scope = re.search(r'^범위:\s*(.+)$', src, re.M)
    out['scope'] = scope.group(1).strip() if scope else None
    if not out['checked'] or not out['scope']:
        die('README.md 에서 수집일·범위를 읽지 못했습니다')
    return out


def build():
    models, counts, hashes = [], {}, {}
    for brand, fname in BRANDS:
        path = os.path.join(SPECS, 'data', fname)
        raw = open(path, 'rb').read()
        hashes[fname] = hashlib.sha256(raw).hexdigest()
        rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'), newline='')))
        counts[fname] = {'rows': len(rows), 'ceilingIndoor': 0}
        for r in rows:
            if r['unit_type'] != '실내기' or r['form'] not in FORMS:
                continue
            who = f"{fname} {r['model']}"
            body, panel = dims(r['body_size_mm'], who, 'body_size_mm'), dims(r['panel_size_mm'], who, 'panel_size_mm')
            kind = 'mini4way' if r['form'] == '4way' and body and body[0] < MINI_4WAY_MAX_BODY_W_MM else r['form']
            e = {'id': f"{brand}:{r['model']}", 'brand': brand, 'type': kind, 'code': r['model'], 'brandName': r['brand'] or None, 'form': r['form']}
            for k in VERBATIM:
                e[k] = r[k] if r[k] != '' else None
            e['coolingKw'] = plain_kw(r['cooling_kw'])
            e['heatingKw'] = plain_kw(r['heating_kw'])
            e['bodyMm'] = body
            e['panelMm'] = panel
            e['currentUncertain'] = '현행 불확실' in r['note']
            models.append(e)
            counts[fname]['ceilingIndoor'] += 1
    ids = [m['id'] for m in models]
    if len(ids) != len(set(ids)):
        die('브랜드 안에서 모델명이 겹칩니다: ' + ', '.join(sorted({i for i in ids if ids.count(i) > 1})))
    bodies = sorted({m['bodyMm'][0] for m in models if m['form'] == '4way' and m['bodyMm']})
    if any(MINI_4WAY_MAX_BODY_W_MM <= w < 800 for w in bodies):
        die(f'4way 본체 가로 {bodies} — 미니 4Way 기준({MINI_4WAY_MAX_BODY_W_MM})으로 가를 수 없는 값이 있습니다')
    meta = {
        'about': '삼성·LG 천장형 시스템에어컨 실내기 제원. 값은 CSV 원문 그대로이고 빈칸은 null(미확인). 추정·환산·반올림 없음.',
        'source': {'dir': 'Obsidian/Personal/reference/hvac-specs', 'files': ['data/samsung.csv', 'data/lg.csv'], 'sha256': hashes, 'builder': 'tools/build-ac-catalog.py'},
        'counts': {'models': len(models), 'byFile': counts, 'byType': {t: sum(1 for m in models if m['type'] == t) for t in ('1way', '2way', '4way', 'mini4way', '360')}},
        'readme': readme_blocks(),
        'included': '천장형 실내기만: CSV unit_type=실내기 이고 form 이 1way·2way·4way·360 인 행. 형식(type)은 form 그대로이고, 4way 중 본체 가로가 %dmm 미만이면 mini4way(삼성 미니·인테리어 4Way 575×250×575).' % MINI_4WAY_MAX_BODY_W_MM,
        'excluded': '실외기(unit_type=실외기): 배치도 천장에 놓는 것은 실내기뿐이고 실외기의 능력·소비전력·등급은 짝 실내기와의 세트 기준이라 단독 항목으로 쓸 수 없다. LG 세트 행(unit_type=세트): 최소/정격/최대 값이 한 칸에 들어 있고 같은 모델의 실내기 행이 따로 있다. 스탠드·벽걸이: 천장형이 아니다.',
        'columns': {
            'id': 'brand:code', 'brand': 'samsung|lg', 'type': '배치 형식(1way|2way|4way|mini4way|360)', 'code': 'CSV model 칸(모델명)', 'brandName': 'CSV brand 칸', 'form': 'CSV form 칸',
            'series~verified': 'CSV 같은 이름 칸 원문 그대로(빈칸 null)', 'coolingKw/heatingKw': '원문이 일반 숫자일 때만 숫자, "4,000W" 같은 W 표기와 빈칸은 null(환산하지 않는다 — 원문은 cooling_kw/heating_kw 칸)',
            'bodyMm/panelMm': '원문 body_size_mm/panel_size_mm 의 [가로, 높이, 세로] 숫자(괄호 메모·mm·쉼표만 걷어 낸 것), 칸이 비면 null. 평면 크기는 [0]×[2]',
            'currentUncertain': 'CSV note 에 "현행 불확실"이 적힌 행',
        },
    }
    return {'meta': meta, 'models': models}


def dump(doc):
    head = json.dumps({'meta': doc['meta']}, ensure_ascii=False, indent=2)[:-2]   # '}' 앞에서 끊고 models 를 한 줄씩 붙인다
    body = ',\n'.join('    ' + json.dumps(m, ensure_ascii=False, separators=(',', ':')) for m in doc['models'])
    return head + ',\n  "models": [\n' + body + '\n  ]\n}\n'


if __name__ == '__main__':
    text = dump(build())
    if '--check' in sys.argv:
        same = os.path.exists(OUT) and open(OUT, encoding='utf-8').read() == text
        print('ac-catalog.json 은 제원 폴더와 ' + ('같습니다' if same else '다릅니다 — python3 tools/build-ac-catalog.py 로 다시 만드세요'))
        sys.exit(0 if same else 1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(text)
    print('쓴 파일:', os.path.normpath(OUT), len(text.encode('utf-8')), 'bytes')
