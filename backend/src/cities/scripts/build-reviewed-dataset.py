#!/usr/bin/env python3
'Offline bulk decisions. Evidence, rule and review state remain explicit on every row.\nRun prepare-geographic-evidence.py first. This never publishes a release.\n'

from pathlib import Path

import json, re, hashlib, random, collections, math, unicodedata

from dataset_geography import *
from source_response_point import response_point

ROOT = Path(__file__).resolve().parents[3]

D = ROOT / 'src/cities/data/neighbourhoods'

OUT = ROOT / 'output/neighbourhood-cities'

OUT.mkdir(exist_ok=True, parents=True)

A1, A2, COV = geography(D)

B2 = {s.properties['adm2_pcode']: s for s in A2}

BASE = load(ROOT / 'src/cities/data/egypt-cities-catalog.json')['records']

DIST = {r['sourceCode']: r for r in BASE if not r.get('districtSourceCode')}

OV = load(D / 'reviewed-overrides.json')

REVIEW = load(D / 'personal-review.json') if (D / 'personal-review.json').exists() else {'decisions': {}, 'translations': {}, 'sampleAudit': None}

MANIFEST = load(D / 'source-manifest.json')

for source in MANIFEST['snapshots']:
    blob = (ROOT / source['path']).read_bytes()
    if hashlib.sha256(blob).hexdigest() != source['sha256']:
        raise ValueError('Source checksum mismatch ' + source['path'])

def norm(value):
    value = re.sub('[ؐ-ًؚ-ٰٟۖ-ۭـ]', '', str(value)).lower().strip()
    value = value.translate(str.maketrans('أإآٱةىؤئ', 'ااااهيوي'))
    value = re.sub('^(?:el|al)[ -]+', '', value)
    value = re.sub("[-'’]", '', value)
    value = re.sub('\\s+', ' ', value)
    return re.sub('^ال', '', value).strip()

def ar(v):
    return bool(re.search('[\u0600-ۿ]', v or ''))

def en(v):
    return bool(re.search('[A-Za-z]', v or '')) and (not ar(v))

def clean(v):
    return re.sub('\\s+', ' ', v or '').strip(' ;,')

def area_for(p):
    return next((a for a, s in COV.items() if s.covers(p)), None)

def short_ar(v):
    return re.sub('^(?:(?:قسم|مركز|مدينة|مدينه)\\s*)+', '', v).strip()

def source_id(e):
    return f"OSM:{e['type']}/{e['id']}"

# Latin spellings come from exact bilingual source-name matches before curated transliteration.
OSM = {source_id(e): e for a in REGIONS for group in ['places', 'hamlets'] for e in load(D / (a + '-' + group + '.json.gz'))['elements']}

WD = {}

for r in load(D / 'wikidata.json.gz')['results']['bindings']:
    q = r['item']['value'].split('/')[-1]
    v = WD.setdefault(q, {'en': set(), 'ar': set(), 'enAlias': set(), 'arAlias': set(), 'points': set()})
    for k in ['en', 'ar', 'enAlias', 'arAlias']:
        if k in r:
            v[k].add(clean(r[k]['value']))
    match = re.match('Point\\(([-\\d.]+) ([-\\d.]+)\\)', r.get('coord', {}).get('value', ''))
    if match:
        v['points'].add((float(match[1]), float(match[2])))

LEX = collections.defaultdict(collections.Counter)

for e in OSM.values():
    t = e.get('tags', {})
    a = t.get('name:ar') or (t.get('name') if ar(t.get('name')) else '')
    b = t.get('name:en') or (t.get('name') if en(t.get('name')) else '')
    if a and b:
        LEX[norm(a)][b] += 1

for w in WD.values():
    for a in sorted(w['ar']):
        for b in sorted(w['en']):
            if ar(a) and en(b):
                LEX[norm(a)][b] += 1

for a, b in REVIEW.get('translations', {}).items():
    LEX[norm(a)][b] += 1000

TOKENS = {'عزبة': 'Ezbet', 'عزبه': 'Ezbet', 'قرية': 'Village', 'قريه': 'Village', 'الجزيرة': 'El Gezira', 'الجزيره': 'El Gezira', 'جزيرة': 'Geziret', 'جزيره': 'Geziret', 'ابو': 'Abu', 'أبو': 'Abu', 'ابى': 'Abi', 'أبي': 'Abi', 'ميت': 'Mit', 'كفر': 'Kafr', 'كوم': 'Kom', 'نجع': 'Nagaa', 'محمد': 'Mohamed', 'احمد': 'Ahmed', 'أحمد': 'Ahmed', 'محمود': 'Mahmoud', 'ابراهيم': 'Ibrahim', 'إبراهيم': 'Ibrahim', 'اسماعيل': 'Ismail', 'إسماعيل': 'Ismail', 'حسن': 'Hassan', 'حسين': 'Hussein', 'على': 'Ali', 'علي': 'Ali', 'عبد': 'Abdel', 'الله': 'Allah', 'الرحمن': 'Rahman', 'الرحيم': 'Rahim', 'الجديده': 'El Gedida', 'الجديدة': 'El Gedida', 'القديمه': 'El Qadima', 'القديمة': 'El Qadima', 'بحري': 'Bahary', 'بحرى': 'Bahary', 'قبلي': 'Qebly', 'قبلى': 'Qebly', 'شرق': 'East', 'غرب': 'West', 'الشرقية': 'El Sharqiya', 'الشرقيه': 'El Sharqiya', 'الغربية': 'El Gharbiya', 'الغربيه': 'El Gharbiya', 'شمال': 'North', 'جنوب': 'South', 'اول': 'First', 'أول': 'First', 'اولى': 'First', 'أولى': 'First', 'اولي': 'First', 'الأولى': 'First', 'ثان': 'Second', 'ثاني': 'Second', 'ثانية': 'Second', 'ثانيه': 'Second', 'الثانية': 'Second', 'ثالث': 'Third', 'ثالثة': 'Third', 'ثالثه': 'Third', 'رابع': 'Fourth', 'رابعة': 'Fourth', 'رابعه': 'Fourth', 'خامس': 'Fifth', 'خامسة': 'Fifth', 'خامسه': 'Fifth', 'سادس': 'Sixth', 'سادسة': 'Sixth', 'سادسه': 'Sixth', 'سابع': 'Seventh', 'سابعه': 'Seventh', 'ثامن': 'Eighth', 'ثامنه': 'Eighth', 'تاسع': 'Ninth', 'تاسعه': 'Ninth', 'عاشر': 'Tenth', 'عاشره': 'Tenth', 'مدينة': 'City', 'مدينه': 'City', 'مساكن': 'Housing', 'حي': 'District', 'حى': 'District', 'الحي': 'District', 'الحى': 'District', 'قسم': 'Quarter', 'قسمه': 'Qisma', 'تقسيم': 'Taqsim', 'نزلة': 'Nazlet', 'نزله': 'Nazlet', 'منشأة': 'Manshiyet', 'منشاة': 'Manshiyet', 'منشأه': 'Manshiyet', 'منشاه': 'Manshiyet', 'منشية': 'Manshiya', 'منشيه': 'Manshiya', 'منشيت': 'Manshiyet', 'القاهرة': 'Cairo', 'الاسكندرية': 'Alexandria', 'الإسكندرية': 'Alexandria', 'دمياط': 'Damietta', 'القنال': 'El Canal', 'المنصورة': 'El Mansoura', 'المنصوره': 'El Mansoura', 'سيدي': 'Sidi', 'سيدى': 'Sidi', 'السيد': 'El Sayed', 'السيده': 'El Sayeda', 'السيدة': 'El Sayeda', 'الشيخ': 'El Sheikh', 'الملك': 'El Malek', 'الامام': 'El Imam', 'الإمام': 'El Imam', 'الشهيد': 'El Shaheed', 'السوق': 'El Souq', 'البحر': 'El Bahr', 'البحري': 'El Bahary', 'البحرى': 'El Bahary', 'السراي': 'El Saray', 'السراى': 'El Saray', 'الجامع': 'El Gamea', 'الجامعـ': 'El Gamea', 'الجنوب': 'El Ganoub', 'الميناء': 'El Mina', 'الوسط': 'El Wasat', 'الوسطاني': 'El Wastani', 'الوسطانى': 'El Wastani', 'الساحل': 'El Sahel', 'النصر': 'El Nasr', 'السلام': 'El Salam', 'الامل': 'El Amal', 'الأمل': 'El Amal', 'النور': 'El Nour', 'العرب': 'El Arab', 'العربي': 'El Araby', 'العربى': 'El Araby', 'العربية': 'El Arabiya', 'القبليه': 'El Qebliya', 'القبليه': 'El Qebliya', 'المساكن': 'El Masaken', 'الاول': 'First', 'الأول': 'First', 'الثاني': 'Second', 'الثانى': 'Second', 'الثالث': 'Third', 'الرابع': 'Fourth', 'الخامس': 'Fifth', 'السادس': 'Sixth', 'السابع': 'Seventh', 'الثامن': 'Eighth', 'التاسع': 'Ninth', 'العاشر': 'Tenth', 'ناصر': 'Nasser', 'سعد': 'Saad', 'سعيد': 'Saeed', 'فؤاد': 'Fouad', 'زغلول': 'Zaghloul', 'عمر': 'Omar', 'عمره': 'Omra', 'عمرو': 'Amr', 'بكر': 'Bakr', 'بدر': 'Badr', 'حمزه': 'Hamza', 'حمزة': 'Hamza', 'مصطفى': 'Mostafa', 'يوسف': 'Youssef', 'يونس': 'Younes', 'يحيى': 'Yahya', 'عثمان': 'Othman', 'عيسى': 'Eissa', 'عيسي': 'Eissa', 'زكريا': 'Zakaria', 'صالح': 'Saleh', 'صابر': 'Saber', 'جابر': 'Gaber', 'عليوه': 'Aliwa', 'بدوى': 'Badawy', 'بدوي': 'Badawy', 'بدران': 'Badran', 'سلامه': 'Salama', 'سلامة': 'Salama', 'الشعراء': 'El Shoaraa', 'البساتين': 'El Basateen', 'البستان': 'El Bostan', 'النخيل': 'El Nakheel', 'الروضة': 'El Rawda', 'الروضه': 'El Rawda', 'المطرية': 'El Matariya', 'المطريه': 'El Matariya', 'السنانية': 'El Senaniya', 'السنانيه': 'El Senaniya', 'الكبير': 'El Kebir', 'الكبرى': 'El Kobra', 'الصغير': 'El Soghayar', 'الصغرى': 'El Soghra', 'الزهراء': 'El Zahraa', 'الزهور': 'El Zohour', 'الضواحي': 'El Dawahy', 'الضواحى': 'El Dawahy', 'المنشية': 'El Manshiya', 'المنشيه': 'El Manshiya', 'المنشاة': 'El Manshaa', 'العزبة': 'El Ezba', 'العزبه': 'El Ezba', 'اللوزي': 'El Lozy', 'اللوزى': 'El Lozy', 'الشط': 'El Shatt', 'الشاطئ': 'El Shatea', 'الرمل': 'El Raml', 'الدقي': 'Dokki', 'الدقى': 'Dokki', 'الزمالك': 'Zamalek', 'سموحة': 'Smouha', 'سموحه': 'Smouha', 'جليم': 'Gleem', 'رشدي': 'Roushdy', 'رشدى': 'Roushdy', 'المنتزه': 'Montaza', 'المنتزة': 'Montaza', 'الكرموز': 'Karmouz', 'كرموز': 'Karmouz', 'الورديان': 'Wardian', 'الاسماعيليه': 'Ismailia', 'الاسماعيلية': 'Ismailia', 'الإسماعيلية': 'Ismailia', 'العبور': 'Obour', 'أكتوبر': 'October', 'اكتوبر': 'October', 'زايد': 'Zayed', 'الشروق': 'Shorouk', 'رمضان': 'Ramadan', 'الرحاب': 'Rehab', 'مدينتي': 'Madinaty', 'مدينتى': 'Madinaty', 'القطامية': 'Katameya', 'القطاميه': 'Katameya'}

# No guessed vowels: unsupported Arabic tokens are sent for individual review.
COMPACT = {}

for arabic, spellings in LEX.items():
    compact = arabic.replace(' ', '')
    if len(compact) > 2:
        COMPACT[compact] = spellings.most_common(1)[0][0]

for arabic, english in TOKENS.items():
    COMPACT[norm(arabic).replace(' ', '')] = english

COMPACT.update({'و': 'and', 'ال': 'El', 'الشمالى': 'North', 'الجنوبيه': 'South', 'الغربيه': 'West', 'الشرقيه': 'East'})

UNRESOLVED_NAMES = {}

def translate(a):
    a = clean(a)
    manual = next((b for original, b in REVIEW.get('translations', {}).items() if norm(original) == norm(a)), None)
    if manual:
        return (manual, 'curated')
    if norm(a) in LEX:
        return (LEX[norm(a)].most_common(1)[0][0], 'curated')
    compact = norm(a).replace(' ', '')
    if compact in COMPACT:
        return (COMPACT[compact], 'curated')
    raw = norm(a).replace(' ', '')
    memo = {}

    def segment(start):
        if start == len(raw):
            return []
        if start in memo:
            return memo[start]
        for end in range(len(raw), start, -1):
            part = raw[start:end]
            translated = COMPACT.get(part)
            if not translated and re.fullmatch('[0-9٠-٩_]+', part):
                translated = part.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')).replace('_', ' / ')
            if translated:
                tail = segment(end)
                if tail is not None:
                    memo[start] = [translated, *tail]
                    return memo[start]
        memo[start] = None
        return None
    parts = segment(0)
    if parts:
        return (' '.join(parts), 'curated')
    words = re.split('[\\s/،,()-]+', a)
    unknown = [w for w in words if w and w not in TOKENS and (not w.isdecimal())]
    if unknown:
        UNRESOLVED_NAMES[a] = unknown
        return (None, 'unresolved')
    return (' '.join((TOKENS.get(w, w.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789'))) for w in words if w)), 'curated')

def labels(e):
    t = e.get('tags', {})
    approved = REVIEW.get('nameOverrides', {}).get(source_id(e))
    if approved:
        return approved['nameEnglish'], approved['nameArabic'], 'curated'
    a = clean(t.get('name:ar') or (t.get('name') if ar(t.get('name')) else ''))
    b = clean(t.get('name:en') or t.get('int_name') or (t.get('name') if en(t.get('name')) else ''))
    how = 'OSM'
    w = WD.get(t.get('wikidata'), {})
    if not a:
        a = next((x for x in sorted(w.get('ar', [])) if ar(x)), '')
        how = 'Wikidata' if a else how
    if not b:
        b = next((x for x in sorted(w.get('en', [])) if en(x)), '')
        how = 'Wikidata' if b else how
    if a and (not b):
        b, how = translate(a)
    if b and (not a):
        original_b = b
        b_lookup = re.sub('\\b(?:compound|compund)\\b', '', b, flags=re.I).strip()
        matches = {x for x, ys in LEX.items() if any((norm(y) == norm(b) for y in ys))}
        originals = [x for x in REVIEW.get('englishArabic', {}) if norm(x) == norm(b) or norm(x) == norm(b_lookup)]
        if originals:
            a = REVIEW['englishArabic'][originals[0]]
            how = 'curated'
    manual = next((value for original, value in REVIEW.get('translations', {}).items() if a and norm(original) == norm(a)), None)
    if manual:
        b = manual
        how = 'curated'
    if b:
        b = re.sub('\\b(?:El|Al) (?:El|Al)\\b', 'El', b)
    if b and (not en(b) or len(b) > 100):
        b = None
    return (b, a, how)

FAMILIES = [('October', ['october', 'اكتوبر', 'أكتوبر'], ['EG2107', 'EG2121']), ('Sheikh Zayed', ['zayed', 'زايد'], ['EG2119']), ('Obour', ['obour', 'العبور'], ['EG1413']), ('New Cairo', ['new cairo', 'القاهرة الجديدة', 'التجمع', 'الرحاب', 'مدينتي', 'مدينتى'], ['EG0137', 'EG0138', 'EG0139']), ('Shorouk', ['shorouk', 'shrouk', 'الشروق'], ['EG0140']), ('Badr', ['badr', 'بدر'], ['EG0141']), ('10th of Ramadan', ['ramadan', 'العاشر'], ['EG1309', 'EG1321']), ('New Borg El Arab', ['borg', 'borj', 'برج العرب'], ['EG0216']), ('New Damietta', ['damietta', 'دمياط الجديدة'], ['EG1105'])]

CONTEXT = {c: n for n, words, codes in FAMILIES for c in codes}

CONTEXT_AR = {'October': 'السادس من أكتوبر', 'Sheikh Zayed': 'الشيخ زايد', 'Obour': 'العبور', 'New Cairo': 'القاهرة الجديدة', 'Shorouk': 'الشروق', 'Badr': 'بدر', '10th of Ramadan': 'العاشر من رمضان', 'New Borg El Arab': 'برج العرب الجديدة', 'New Damietta': 'دمياط الجديدة'}

# Named-city polygons establish the city context for Zemam Out features without guessing.
ENCLOSING_CITIES=[]
for area in REGIONS:
    for feature in load(D/(area+'-residential.json.gz'))['elements']:
        tags=feature.get('tags',{})
        addresses=' '.join(tags.get(key,'') for key in ['addr:city','is_in:city','is_in'])
        name=' '.join(tags.get(key,'') for key in ['name','name:en','name:ar'])
        city_codes=next((codes for _,words,codes in FAMILIES if any(norm(word) in norm(addresses) for word in words)),None)
        if not city_codes:
            city_codes=next((codes for _,words,codes in FAMILIES if any(norm(word) in norm(name) for word in words)),None)
        value=osm_geometry(feature) if city_codes else None
        if value:
            ENCLOSING_CITIES.append((Shape(value),city_codes,source_id(feature)))

def parent_for(p, gov, raw_parent, text, city_hint=None):
    if raw_parent in DIST:
        return (raw_parent, {'parentRule': 'ocha-containment', 'parentPolygonDistanceKm': 0.0})
    options = [s for s in A2 if s.properties['adm1_pcode'] == gov and s.properties['adm2_pcode'] in DIST]
    named = next((codes for name, words, codes in FAMILIES if city_hint and norm(name)==norm(city_hint) and codes[0][:4]==gov),None)
    if not named:
        named = next((codes for name, words, codes in FAMILIES if any((norm(w) in norm(text) for w in words)) and codes[0][:4] == gov), None)
    if not named:
        named = next((codes for shape, codes, source in ENCLOSING_CITIES if codes[0][:4] == gov and shape.covers(p)), None)
    enclosing=next((source for shape,codes,source in ENCLOSING_CITIES if named==codes and shape.covers(p)),None)
    rule = 'zemam-out-named-city' if named else 'zemam-out-nearest-polygon'
    candidates = [B2[c] for c in named] if named else options
    if not candidates:
        return (None, {})
    dist, shape = min(((polygon_distance(p, s), s) for s in candidates))
    prov = {'parentRule': rule, 'zemamOutSourceCode': raw_parent, 'parentPolygonDistanceKm': round(dist / 1000, 5), 'parentCandidateSourceCodes': named or [s.properties['adm2_pcode'] for s in options], 'parentCityEvidence':('reviewed City name '+city_hint if city_hint else enclosing or 'bilingual City name in source row') if named else None}
    return (shape.properties['adm2_pcode'] if dist <= 40000 else None, prov)

NOISE = re.compile('\\b(?:block|parcel|plot|group|mugawra|mugawara|mojawra|area\\s+(?:[a-z]|[0-9]+)|tower|towers|building\\s*\\d|street|road)\\b|بلوك|مجموع[ةه]|مجاور[ةه]|قطعة|قطعه|شارع|برج\\s+(?!العرب)|ابراج|أبراج|منطق[ةه]\\s+[\\d٠-٩a-zع]\\s*$', re.I)

BARE = re.compile('^[\\d٠-٩\\s.,\\-A-Za-zأ-ي]{1,6}$')

DECISIONS = []

RESIDUE = []

CITIES = []

MERGES = []

EXCLUDED = collections.Counter()

SPATIAL_DUPS = collections.defaultdict(list)

# Reviewed display-name cleanup is explicit input; source names/identities remain intact.
for code, approval in REVIEW.get('districtNames',{}).items():
    district = DIST[code]
    district.setdefault('aliases',[]).append(district['nameEnglish'])
    district['nameEnglish'] = approval['nameEnglish']

# District source aliases used for precise duplicate identities.
DIST_NAMES = collections.defaultdict(list)

for c in DIST.values():
    for n in [c['nameEnglish'], c['sourceNameEnglish'], short_ar(c['nameArabic']), *(c.get('aliases') or [])]:
        DIST_NAMES[c['governorateCode'], norm(n).replace(' ', '')].append(c['sourceCode'])

LOCALITY_RESIDENTIAL = [Shape(f['geometry'],f['properties']) for f in load(OUT/'residential-clipped.geojson.gz')['features']]

for code, e in sorted(OSM.items(), key=lambda kv: (0 if kv[0] in REVIEW.get('preferredSourceCodes', []) else 1, 0 if kv[1]['type'] == 'node' else 1, kv[1]['id'])):
    t = e.get('tags', {})
    p = osm_point(e)
    area = area_for(p) if p else None
    decision = {'sourceCode': code, 'decision': 'exclude', 'reviewed': False, 'notes': '', 'rule': '', 'coverageArea': area}

    def exclude(rule, note):
        decision.update(rule=rule, notes=note)
        DECISIONS.append(decision)
        EXCLUDED[rule] += 1
    if re.search('^(?:قطاع\\s+[\\w]+|محلي[ةه]\\s+\\d+|مسلسل\\s+\\d+|المرحل[ةه]\\s+\\d+|مدخل\\s+\\d+|عمارات\\s+\\d+|مباني\\s+\\d+|منطق[ةه]\\s+(?:خدمات|المخازن|ال?\\d+\\s*متر))$', clean(t.get('name', '')), re.I) or re.search('^(?:sector|locality|series|phase|entrance|buildings?)\\s+[a-z0-9]+$|^(?:services?|storage|community services) area$|^\\d+ meter area$|^a housing$', clean(t.get('name:en', '')), re.I):
        exclude('generic-sector-or-service-code', 'Code-level sector/locality/series/phase/entrance or unnamed service/storage label, not a real area name.')
        continue
    if re.search(r'^(?:قطاع\s*[أ-يa-z]?\s*[٠-٩0-9]+|sector\s+[a-z]?\d+)', clean(t.get('name', ''))+' '+clean(t.get('name:en', '')), re.I):
        exclude('generic-sector-or-service-code', 'Alphanumeric sector code, including repeated industrial sectors, below neighbourhood granularity.')
        continue
    if code in REVIEW.get('decisions', {}):
        exclude('personal-review-exclusion', REVIEW['decisions'][code]['notes'])
        continue
    if not area:
        exclude('outside-coverage', 'Point outside the reviewed administrative coverage union.')
        continue
    raw_name = clean(t.get('name') or t.get('name:en') or t.get('name:ar'))
    if t.get('place') in {'hamlet', 'isolated_dwelling', 'locality'}:
        landform = re.search(r'^(?:ال)?(?:وادي|وادى|ترعة|مصرف|ملاحة|رمال|طابية|قلعة|مقلع|محجر|خزان|نقب|حطية|غراقة|مقبرة|المقبرة|نقطة تفتيش)\b|\b(?:canal|drain|quarry|cemetery|checkpoint|dunes?|valley)\b', raw_name+' '+t.get('name:en',''), re.I)
        if landform or t.get('historic') or t.get('natural') or t.get('man_made') or t.get('landuse') == 'quarry':
            exclude('non-settlement-locality', 'Named landform, drain/canal, ruins, tower, quarry or standalone historic feature; not a real settlement/area name.')
            continue
        if re.fullmatch(r'(?:Gate|بوابة)\s*\d+', raw_name, re.I) or re.search(r'mall.*entrance|مدخل المول|Faisal Bridge Entrance|Hassanin.s land|Tourist Promenade|ممشى', raw_name+' '+t.get('name:en',''), re.I):
            exclude('gate-or-private-premises', 'Unqualified gate, facility entrance, promenade or individually named land parcel; no independent residential-area identity.')
            continue
        if re.search(r'^(?:Karm|Ilw[ae]t|Rod|Talat|Barr)\b|^(?:كرم|علوة|روض|طلعة|بر)\b', raw_name+' '+t.get('name:en',''), re.I):
            nearby = next((shape for shape in LOCALITY_RESIDENTIAL if shape.bounds[0]-.006 <= p[0] <= shape.bounds[2]+.006 and shape.bounds[1]-.006 <= p[1] <= shape.bounds[3]+.006 and polygon_distance(p,shape) <= 500), None)
            if not nearby:
                exclude('locality-without-settlement-evidence', 'Ambiguous field/vineyard/mound/topographic locality, with no residential snapshot within 500 m. Do not turn uninhabited labels into grid fillers.')
                continue
    if re.search('^(?:area|villas?|phase)\\s+[a-z0-9]+$|^منطق[ةه]\\s+(?:[\\d٠-٩]+[أ-يa-z]?|[أ-يa-z][\\d٠-٩]*)$|(?:housing|مساكن|منطق[ةه])[^;]*\\s+[a-zأابتثجحخدذرزسشصضطظعغفقكلمنهوي]$', raw_name, re.I) and code not in REVIEW.get('residentialComplexes', {}):
        exclude('generic-sector-or-service-code', 'Bare alphanumeric area/villa/phase or letter subdivision, below neighbourhood granularity.')
        continue
    if re.search('^(?:sector|locality|series|phase|entrance|buildings?)\\s+[a-z0-9]+$|^(?:services?|storage|community services) area$|^\\d+ meter area$|^a housing$|^مساكن [أابتثجحخدذرزسشصضطظعغفقكلمنهوي]$', raw_name, re.I) and code not in REVIEW.get('residentialComplexes', {}):
        exclude('generic-sector-or-service-code', 'Code-level sector/locality/series/phase/entrance or unnamed service/storage label, not a real area name.')
        continue
    if re.search('cluster\\s*\\d|\\bcourt\\s+[a-z]\\b|\\bpk1\\s+phase|\\b(?:[ab][0-9])\\s+haram|residential (?:building|area)$|building entrance|\\bSLR$|عمارة|مشروع \\d+ عمارة|دار مصر - \\d+ عمارات', raw_name, re.I) or raw_name.lower() in ['p']:
        exclude('sub-compound-unit-or-generic-building', 'Cluster/court/plot/phase code, building count or generic label rather than an independently named area.')
        continue
    if re.fullmatch('(?:north|south) (?:east|west)', t.get('name:en', ''), re.I) or re.fullmatch('(?:شمال|جنوب) (?:شرق|غرب)', raw_name):
        exclude('single-accommodation-or-direction', 'Bare direction, not a proper area name.')
        continue
    if re.search('hostel|youth hostel|students? (?:housing|accommodation)|student (?:female|male) city|المدينة الجامعية للطالبات|المدينة الجامعية للطلاب|سكن طلاب|مدينة الطلاب|بيت شباب|^(?:north|south) (?:east|west)$', raw_name + ' ' + t.get('name:en', ''), re.I):
        exclude('single-accommodation-or-direction', 'Single student accommodation/youth hostel or bare direction, not a named neighbourhood.')
        continue
    if re.fullmatch(r'(?:housing|مساكن|المساكن)', raw_name, re.I) or re.search(r'^(?:phase\s+\d+[a-z]?|(?:مساكن\s+)?المرحل[ةه]\s*\d+)', raw_name, re.I):
        exclude('generic-phase-or-housing-label', 'Bare housing label or coded phase, without an independently named area.')
        continue
    if any(re.search(r'^(?:draw\s+[a-z]|serial\s+[0-9, ]+|buildings\s+phase\s+\d+)$|^(?:القرع[ةه]\s+[أ-ي]|مسلسل\s+[0-9٠-٩,، ]+|عمارات\s+المرحل[ةه]\s*\d+)$',value,re.I) for value in [raw_name,t.get('name:en','')]):
        exclude('generic-allocation-or-building-phase', 'Allocation sequence, letter draw or generic building phase; not a named area.')
        continue
    if not raw_name:
        exclude('no-name', 'No usable source name.')
        continue
    if (NOISE.search(raw_name + ' ' + t.get('name:en', '')) and code not in REVIEW.get('residentialComplexes', {}) and code not in REVIEW.get('areaLandmarks', {})) or (BARE.fullmatch(raw_name) and (not re.search('[ا-ي]{4}', raw_name)) and re.search('\\d', raw_name)):
        exclude('micro-unit-or-building', 'Block/plot/group/mugawra/building/street/bare code; not a selectable area name.')
        continue
    if any((k in t for k in ['building', 'highway'])) or (t.get('amenity') and (not t.get('place'))):
        exclude('non-place-feature', 'Building, transport or standalone amenity without a place identity.')
        continue
    b, a, how = labels(e)
    if not b or not a:
        decision.update(rule='unresolved-bilingual-name', notes='Needs an individually reviewed bilingual name; never invented automatically.')
        DECISIONS.append(decision)
        RESIDUE.append({**decision, 'tags': t, 'point': p})
        continue
    gov = locate(p, A1, 'adm1_pcode')
    raw_parent = locate(p, A2, 'adm2_pcode')
    if not gov:
        exclude('outside-adm1', 'Source coordinate is outside all OCHA ADM1 polygons.')
        continue
    city_review=REVIEW.get('cityContexts',{}).get(code,{})
    city_hint=city_review.get('city')
    city_tags=' '.join(t.get(key,'') for key in ['addr:city','is_in:city','is_in'])
    if not city_hint:
        city_hint=next((name for name,words,codes in FAMILIES if any(norm(word) in norm(city_tags) for word in words) and codes[0][:4]==gov),None)
    parent, prov = parent_for(p, gov, raw_parent, b + ' ' + a, city_hint)
    if city_hint:prov['cityContextEvidence']=city_review.get('notes') or 'OSM city/address tag: '+city_tags
    if not parent:
        decision.update(rule='parent-beyond-40km', notes='No admissible same-governorate parent within 40 km; lead review required.')
        DECISIONS.append(decision)
        RESIDUE.append({**decision, 'point': p, 'provenance': prov})
        continue
    aliases = []
    for k in ['alt_name', 'alt_name:en', 'alt_name:ar', 'official_name', 'official_name:en', 'official_name:ar', 'int_name']:
        aliases.extend((clean(x) for x in t.get(k, '').split(';') if clean(x) and (ar(x) or en(x))))
    if t.get('wikidata') in WD:
        w = WD[t['wikidata']]
        aliases.extend((x for k in ['enAlias', 'arAlias'] for x in sorted(w[k]) if (ar(x) if k == 'arAlias' else en(x)) and len(x) < 100))
    aliases = [x for x in aliases if not NOISE.search(x) and (not BARE.fullmatch(x))]
    match = list(dict.fromkeys(DIST_NAMES.get((gov, norm(b).replace(' ', '')), []) + DIST_NAMES.get((gov, norm(short_ar(a)).replace(' ', '')), [])))
    approved_district = REVIEW.get('districtIdentityMerges',{}).get(code)
    if approved_district:
        if DIST[approved_district]['governorateCode'] != gov:
            raise ValueError('Reviewed district merge crosses governorate')
        match = [approved_district]
    if match:
        target = parent if parent in match else match[0]
        decision.update(decision='merge', mergeInto=target, nameEnglish=b, nameArabic=a, aliases=aliases, rule='same-district-name', notes='Same bilingual district identity; retain the district UUID/point and add source spellings only.')
        DECISIONS.append(decision)
        MERGES.append(decision)
        continue
    kind = t.get('place', 'residential')
    if code in REVIEW.get('residentialComplexes', {}) or (kind not in {'suburb', 'quarter', 'town', 'city', 'village', 'neighbourhood'} and t.get('landuse') == 'residential'):
        kind = 'residential'
    rule = 'named-residential-compound' if kind == 'residential' or re.search('compound|كمبوند|كومباوند', b + ' ' + a, re.I) else 'named-place-' + kind
    context = city_hint or CONTEXT.get(parent)
    if (re.search('^(?:الحي|الحى|حي|حى)\\s+', a) or re.search('^(?:[\\d]+(?:st|nd|rd|th)?|First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth) District$', b, re.I)) and context:
        numbered_label = a + ' ' + b
        aliases.extend([a, b])
        b = b + ' (' + context + ')'
        a = a + ' — ' + CONTEXT_AR[context]
        rule = 'numbered-new-city-district' if re.search('\\d|الأول|الاول|الثاني|الثانى|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|عشر|First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth', numbered_label, re.I) else rule
    duplicate = next((c for c in [*SPATIAL_DUPS[gov, norm(b)], *SPATIAL_DUPS[gov, norm(a)]] if distance([c['point']['longitude'], c['point']['latitude']], p) < 1500), None)
    if duplicate:
        duplicate['aliases'].extend([b, a, *aliases])
        decision.update(rule='duplicate-place', notes='Duplicate name and point within 1.5 km of ' + duplicate['sourceCode'], duplicateOf=duplicate['sourceCode'])
        DECISIONS.append(decision)
        EXCLUDED['duplicate-place'] += 1
        continue
    decision.update(decision='include', nameEnglish=b, nameArabic=a, aliases=aliases, governorateCode=gov, districtSourceCode=parent, point={'longitude': p[0], 'latitude': p[1], 'evidence': code + ' WGS84 node point / Overpass bounding-box centre'}, parentEvidence='OCHA ADM2 ' + str(raw_parent) + '; ' + prov['parentRule'], rule=rule, notes=rule + '; geographic coverage and noise rules; sample review not yet signed off.', provenance={**prov, 'nameSource': how, 'coverageArea': area, 'inclusionRule': rule, 'osmPlaceType': t.get('place', 'residential')})
    DECISIONS.append(decision)
    CITIES.append(decision)
    for label in [b, a]:
        SPATIAL_DUPS[gov, norm(label)].append(decision)

save(OUT / 'bulk-decisions.json', DECISIONS)

save(OUT / 'name-and-parent-residue.json', RESIDUE)

save(OUT / 'translation-residue.json', UNRESOLVED_NAMES)

print('OSM included', len(CITIES), 'merges', len(MERGES), 'residue', len(RESIDUE), 'excluded', dict(EXCLUDED))

print('included by area', dict(collections.Counter((c['coverageArea'] for c in CITIES))))

# Secondary named localities from Wikidata; landmark entities are reserved for independent GPS checks.
WD_DECISIONS = []

for q, w in sorted(WD.items()):
    if 'WD:' + q in REVIEW.get('decisions', {}):
        DECISIONS.append({'sourceCode':'WD:'+q,'decision':'exclude','reviewed':False,'rule':'personal-source-review-exclusion','notes':REVIEW['decisions']['WD:'+q]['notes'],'coverageArea':None})
        continue
    a = next((x for x in sorted(w['ar']) if re.match('^(?:عزبة|عزبه|قرية|قريه|كفر|مدينة|مدينه|حي |حى )', x)), None)
    if not a or len(w['points']) != 1:
        continue
    p = list(next(iter(w['points'])))
    area = area_for(p)
    if not area:
        continue
    b = next((x for x in sorted(w['en']) if en(x)), None)
    how = 'Wikidata'
    if not b:
        b, how = translate(a)
    manual = next((value for original, value in REVIEW.get('translations', {}).items() if norm(original) == norm(a)), None)
    if manual:
        b = manual
        how = 'curated'
    if not b:
        continue
    gov = locate(p, A1, 'adm1_pcode')
    raw_parent = locate(p, A2, 'adm2_pcode')
    if not gov:
        continue
    parent, prov = parent_for(p, gov, raw_parent, b + ' ' + a)
    if not parent:
        continue
    if any((c['governorateCode'] == gov and norm(short_ar(c['nameArabic'])) == norm(short_ar(a)) for c in CITIES)):
        continue
    match = DIST_NAMES.get((gov, norm(short_ar(a)).replace(' ', '')), []) or DIST_NAMES.get((gov, norm(b).replace(' ', '')), [])
    if match:
        continue
    d = {'sourceCode': 'WD:' + q, 'decision': 'include', 'reviewed': False, 'nameEnglish': b, 'nameArabic': a, 'governorateCode': gov, 'districtSourceCode': parent, 'aliases': [], 'point': {'latitude': p[1], 'longitude': p[0], 'evidence': 'Wikidata ' + q + ' P625 in committed snapshot'}, 'parentEvidence': 'OCHA ' + str(raw_parent) + '; ' + prov['parentRule'], 'rule': 'wikidata-named-locality', 'coverageArea': area, 'notes': 'Explicit village/city/quarter label, one coordinate, geographic containment; source-based name/sample review pending.', 'provenance': {**prov, 'nameSource': how, 'coverageArea': area, 'inclusionRule': 'wikidata-named-locality'}}
    CITIES.append(d)
    WD_DECISIONS.append(d)

DECISIONS.extend(WD_DECISIONS)

print('Secondary Wikidata localities', len(WD_DECISIONS))

# Individually reviewed additions: all coordinates are read from named source records.
for added in REVIEW.get('additions', []):
    prov_extra = {'proxyPoint': True} if added.get('proxyPoint') else {}
    p = None
    if added.get('sourceResponse'):
        source = added['sourceResponse']
        if not any(s['path'] == 'src/cities/data/neighbourhoods/' + source['file'] for s in MANIFEST['snapshots']):
            raise ValueError('Research response absent from source manifest')
        p = response_point(D, source)
        prov_extra['coordinateSource'] = {'kind': 'recorded response', **source}
        evidence = added['evidence']
    elif added.get('osmGeometry'):
        identity = added['osmGeometry']
        feature = next(e for region in REGIONS for e in load(D/(region+'-residential.json.gz'))['elements'] if source_id(e) == identity)
        shape = Shape(osm_geometry(feature))
        name_entity = WD[added['nameWikidata']]
        if len(name_entity['points']) != 1 or not shape.covers(list(next(iter(name_entity['points'])))):
            raise ValueError('Named landmark does not corroborate residential polygon '+identity)
        p = shape.representative()
        prov_extra.update(coordinateSource={'kind':'OSM residential geometry','id':identity,'pointRule':'GEOS point-on-surface'},nameEvidenceWikidata=added['nameWikidata'])
        evidence = identity+' original residential geometry, deterministic point-on-surface; settlement name corroborated by '+added['nameWikidata']+' landmark label, not its coordinate'
    elif added.get('wikidata'):
        prov_extra['coordinateSource']={'kind':'Wikidata','id':added['wikidata']}
        wd = WD[added['wikidata']]
        if len(wd['points']) != 1:
            raise ValueError('Ambiguous curated source coordinate ' + added['sourceCode'])
        p = list(next(iter(wd['points'])))
        evidence = 'Wikidata ' + added['wikidata'] + ' P625'
    else:
        candidates = load(D / 'ocha-cod-ab/egy_admin3-covered.geojson.gz')['features']
        source = next((f for f in candidates if added.get('adm3Pcode') and f['properties']['adm3_pcode'] == added['adm3Pcode'] or (added.get('adm3Arabic') and norm(f['properties']['adm3_name1']) == norm(added['adm3Arabic']))))
        props = source['properties']
        p = [props['center_lon'], props['center_lat']]
        evidence = 'OCHA ADM3 ' + props['adm3_pcode'] + ' center_lon/center_lat (proxy explicitly reviewed)'
        prov_extra['proxyPoint'] = True
    if added.get('coastalCorrectionGovernorate'):
        original = list(p)
        shore = next((g for g in A1 if g.properties['adm1_pcode'] == added['coastalCorrectionGovernorate']))
        nearest = nearest_polygon_point(p, shore)
        offset = distance(original, nearest)
        if offset > 500:
            raise ValueError('Coastal correction exceeds individually reviewed 500 m limit')
        inside = shore.representative()
        fraction = 1 / max(distance(nearest, inside), 1)
        p = [nearest[i] + fraction * (inside[i] - nearest[i]) for i in [0, 1]]
        if not shore.covers(p):
            candidates = []
            for angle in range(0, 360, 15):
                candidate = [nearest[0] + math.cos(math.radians(angle)) / (111195 * math.cos(math.radians(nearest[1]))), nearest[1] + math.sin(math.radians(angle)) / 111195]
                if shore.covers(candidate):
                    candidates.append(candidate)
            if not candidates:
                raise ValueError('Coastal correction did not enter source polygon')
            p = min(candidates, key=lambda candidate: distance(original, candidate))
        prov_extra.update(originalSourcePoint=original, coordinateCorrectionMeters=round(distance(original, p), 2))
        evidence += '; nearest OCHA ADM1 coastline plus 1 m inward, original ' + str(original)
    area = area_for(p)
    gov = locate(p, A1, 'adm1_pcode')
    raw_parent = locate(p, A2, 'adm2_pcode')
    if not area or not gov:
        raise ValueError('Curated coordinate outside covered governorate: ' + added['sourceCode'])
    parent, prov = parent_for(p, gov, raw_parent, added['nameEnglish'] + ' ' + added['nameArabic'])
    if not parent:
        raise ValueError('Curated parent requires lead review ' + added['sourceCode'])
    d = {'sourceCode': added['sourceCode'], 'decision': 'include', 'reviewed': False, 'nameEnglish': added['nameEnglish'], 'nameArabic': added['nameArabic'], 'governorateCode': gov, 'districtSourceCode': parent, 'aliases': added.get('aliases', []), 'point': {'latitude': p[1], 'longitude': p[0], 'evidence': evidence}, 'parentEvidence': 'OCHA ' + str(raw_parent) + '; ' + prov['parentRule'], 'rule': 'personal-source-backed-addition', 'coverageArea': area, 'notes': added['notes'], 'provenance': {**prov, **prov_extra, 'nameSource': 'curated', 'coverageArea': area, 'inclusionRule': 'personal-source-backed-addition'}}
    CITIES.append(d)
    DECISIONS.append(d)

# ADM3 occupancy uses intersection with committed residential geometry or a populated-place point.
RES = load(OUT / 'residential-clipped.geojson.gz')['features']

RES_SHAPES = [Shape(f['geometry'], f['properties']) for f in RES]

PP = load(D / 'ocha-cod-ab/egy_populatedplaces.geojson.gz')['features']

# Populated places supply additional independent locality points; never borrow the
# containing shiakha's Arabic label for a different English feature name.
for feature in PP:
    point = feature['geometry']['coordinates']
    area = area_for(point)
    if not area:
        continue
    props = feature['properties']
    original = props['featurename_en'].strip()
    pcode = (props.get('pcode') or '').strip()
    gov = locate(point,A1,'adm1_pcode')
    identity = pcode.lower() or gov.lower()+'-'+re.sub(r'[^a-z0-9]+','-',original.lower()).strip('-')
    decision = {'sourceCode':'PUPZY:pp-'+identity,'reviewed':False,'coverageArea':area}
    approval = REVIEW.get('populatedPlaces',{}).get(original)
    if not approval:
        reason = REVIEW.get('populatedPlacesExcluded',{}).get(original)
        if not reason:
            raise ValueError('Unreviewed populated-place bilingual name: '+original)
        decision.update(decision='exclude',rule='populated-place-no-credible-arabic',notes=reason,nameEnglish=original)
        DECISIONS.append(decision)
        continue
    english,arabic = approval['nameEnglish'],approval['nameArabic']
    raw_parent = locate(point,A2,'adm2_pcode')
    parent,prov = parent_for(point,gov,raw_parent,english+' '+arabic)
    if not parent:
        raise ValueError('Populated-place parent exceeds lead limit: '+original)
    decision.update(nameEnglish=english,nameArabic=arabic,governorateCode=gov,districtSourceCode=parent,aliases=[original],point={'longitude':point[0],'latitude':point[1],'evidence':'OCHA populated places '+(pcode or original)+' original GeoJSON coordinate'},parentEvidence='OCHA ADM2 '+str(raw_parent)+'; '+prov['parentRule'],provenance={**prov,'coordinateSource':{'kind':'OCHA populated places','id':pcode or original},'nameSource':'curated','coverageArea':area,'inclusionRule':'ocha-populated-place'})
    if approval.get('duplicateSourceCode'):
        decision.update(decision='exclude',rule='duplicate-populated-place-reviewed',duplicateOf=approval['duplicateSourceCode'],notes=approval['notes'])
        DECISIONS.append(decision)
        continue
    match = DIST_NAMES.get((gov,norm(short_ar(arabic)).replace(' ','')),[]) or DIST_NAMES.get((gov,norm(english).replace(' ','')),[])
    target = approval.get('district') or (parent if parent in match else match[0] if match else None)
    if target:
        if DIST[target]['governorateCode'] != gov:
            raise ValueError('Populated-place district merge crosses governorate')
        decision.update(decision='merge',mergeInto=target,rule='populated-place-district-identity',notes='Same named official district identity; preserve its UUID and point. '+approval['notes'])
        DECISIONS.append(decision)
        continue
    duplicate = next((city for city in CITIES if city['governorateCode']==gov and (norm(city['nameArabic']).replace(' ','')==norm(arabic).replace(' ','') or norm(city['nameEnglish']).replace(' ','')==norm(english).replace(' ','')) and (approval.get('wholeCity') or distance(point,[city['point']['longitude'],city['point']['latitude']])<=1500 or any(shape.properties.get('osmSourceCode')==city['sourceCode'] and shape.covers(point) for shape in RES_SHAPES))),None)
    if duplicate:
        duplicate['aliases'].extend([english,arabic,original])
        decision.update(decision='exclude',rule='duplicate-populated-place',duplicateOf=duplicate['sourceCode'],notes='Same named settlement already represented by '+duplicate['sourceCode']+'. '+approval['notes'])
        DECISIONS.append(decision)
        continue
    decision.update(decision='include',rule='ocha-populated-place',notes=approval['notes'])
    DECISIONS.append(decision)
    CITIES.append(decision)

ADM3 = load(D / 'ocha-cod-ab/egy_admin3-covered.geojson.gz')['features']

ADM3_ROWS = []

ADM3_REVIEW = []

for f in ADM3:
    props = f['properties']
    shape = Shape(f['geometry'])
    area = props['coverageArea']
    p = [props['center_lon'], props['center_lat']]
    w, s, e, n = shape.bounds
    residential = any((r.properties['area'] == area and (not (r.bounds[2] < w or r.bounds[0] > e or r.bounds[3] < s or (r.bounds[1] > n))) and (prepared_intersects(ctx, shape.prepared, r.geom) == 1) for r in RES_SHAPES))
    populated_osm = any((c['sourceCode'].startswith('OSM:') and shape.covers([c['point']['longitude'], c['point']['latitude']]) for c in CITIES))
    locality_q = REVIEW.get('adm3HabitationEvidence', {}).get(props['adm3_pcode'])
    if locality_q:
        locality = WD[locality_q['wikidata']]
        if len(locality['points']) != 1 or not shape.covers(list(next(iter(locality['points'])))):
            raise ValueError('Reviewed locality does not corroborate inhabited ADM3 ' + props['adm3_pcode'])
    populated = populated_osm or bool(locality_q) or any((x['properties'].get('adm3_pcode') == props['adm3_pcode'] or shape.covers(x['geometry']['coordinates']) for x in PP))
    decision = {'sourceCode': 'PUPZY:adm3-' + props['adm3_pcode'].lower(), 'coverageArea': area, 'decision': 'exclude', 'reviewed': False, 'rule': 'adm3-uninhabited', 'notes': 'No residential-landuse intersection and no populated-place evidence.'}
    if not residential and (not populated):
        ADM3_ROWS.append(decision)
        continue
    if re.search('خارج.*زمام', props['adm3_name1']):
        decision.update(rule='adm3-covered-unnamed-unit', notes='Outside-zemam administrative label is not a resident area name; existing named City points occupy this unit.')
        ADM3_ROWS.append(decision)
        continue
    a = clean(props['adm3_name1'])
    b, how = translate(a)
    if not b:
        ADM3_REVIEW.append({'sourceCode': decision['sourceCode'], 'nameArabic': a, 'unknownTokens': UNRESOLVED_NAMES.get(a, []), 'districtSourceCode': props['adm2_pcode']})
        decision.update(rule='adm3-unresolved-name', notes='Needs individual transliteration review.')
        ADM3_ROWS.append(decision)
        continue
    gov = locate(p, A1, 'adm1_pcode')
    raw_parent = locate(p, A2, 'adm2_pcode')
    if gov != props['adm1_pcode']:
        decision.update(rule='adm3-centre-outside-governorate', notes='Source centre does not fall in its declared OCHA governorate.')
        ADM3_ROWS.append(decision)
        ADM3_REVIEW.append({**decision, 'nameArabic': a, 'point': p})
        continue
    parent, prov = parent_for(p, gov, raw_parent, b + ' ' + a)
    if not parent:
        decision.update(rule='adm3-parent-beyond-40km', notes='Requires lead parent decision.')
        ADM3_ROWS.append(decision)
        ADM3_REVIEW.append({**decision, 'nameArabic': a, 'point': p})
        continue
    match = DIST_NAMES.get((gov, norm(short_ar(a)).replace(' ', '')), []) or DIST_NAMES.get((gov, norm(b).replace(' ', '')), [])
    if match:
        decision.update(decision='merge', mergeInto=parent if parent in match else match[0], nameEnglish=b, nameArabic=a, aliases=[], rule='adm3-district-identity', notes='Same named district; source ADM3 spelling becomes a district alias.')
        ADM3_ROWS.append(decision)
        continue
    duplicate = next((c for c in CITIES if c['governorateCode'] == gov and (norm(short_ar(c['nameArabic'])).replace(' ', '') == norm(short_ar(a)).replace(' ', '') or norm(c['nameEnglish']) == norm(b)) and shape.covers([c['point']['longitude'], c['point']['latitude']])), None)
    if duplicate:
        duplicate['aliases'].extend([a, b])
        decision.update(rule='adm3-covered-same-name', notes='Same named locality already included at ' + duplicate['sourceCode'], duplicateOf=duplicate['sourceCode'])
        ADM3_ROWS.append(decision)
        continue
    covered = any((shape.covers([c['point']['longitude'], c['point']['latitude']]) for c in CITIES)) or any((shape.covers([r['longitude'], r['latitude']]) for r in DIST.values()))
    rule = 'adm3-fill' if not covered else 'adm3-populated-name'
    aliases = []
    if b.isdecimal() or len(b) < 3:
        b = 'Quarter ' + b + ' (' + DIST[parent]['nameEnglish'] + ')'
        aliases.append(a)
    decision.update(decision='include', nameEnglish=b, nameArabic=a, governorateCode=gov, districtSourceCode=parent, aliases=aliases, point={'longitude': p[0], 'latitude': p[1], 'evidence': 'OCHA ADM3 ' + props['adm3_pcode'] + ' center_lon/center_lat'}, parentEvidence='OCHA ADM2 ' + str(raw_parent) + '; source ADM3 parent ' + props['adm2_pcode'] + '; ' + prov['parentRule'], rule=rule, notes=rule + '; populated by residential landuse or populated-place evidence; individual name/sample review pending.', provenance={**prov, 'nameSource': how, 'coverageArea': area, 'inclusionRule': rule, 'adm3SourceCode': props['adm3_pcode'], 'populatedEvidence': {'residential': residential, 'populatedPlace': populated}})
    ADM3_ROWS.append(decision)
    CITIES.append(decision)

DECISIONS.extend(ADM3_ROWS)

save(OUT / 'bulk-decisions.json', DECISIONS)

save(OUT / 'adm3-name-residue.json', ADM3_REVIEW)

save(OUT / 'translation-residue.json', UNRESOLVED_NAMES)

save(OUT / 'candidate-builtup.geojson.gz', {'type': 'FeatureCollection', 'metadata': {'reviewed': False, 'notes': 'All clipped OSM landuse=residential polygons only; ADM3 City fill retained separately.'}, 'features': RES})

print('ADM3', dict(collections.Counter((r['rule'] for r in ADM3_ROWS))), 'name residue', len(ADM3_REVIEW), 'total named inclusions', len(CITIES))

# Stable audit samples are generated from decisions, not cherry-picked to appear correct.
randomizer = random.Random(20261109)

for label, rows in [('included', [r for r in DECISIONS if r['decision'] == 'include']), ('excluded', [r for r in DECISIONS if r['decision'] == 'exclude'])]:
    sample = randomizer.sample(rows, min(300, len(rows)))
    save(OUT / ('sample-' + label + '.json'), sample)
    lines = []
    for r in sample:
        e = OSM.get(r['sourceCode'], {})
        t = e.get('tags', {})
        lines.append(' | '.join([r['sourceCode'], r['rule'], str(r.get('coverageArea')), r.get('nameEnglish', t.get('name:en', '')), r.get('nameArabic', t.get('name', '')), str(r.get('districtSourceCode', ''))]))
    (OUT / ('sample-' + label + '.txt')).write_text('\n'.join(lines) + '\n')

# Standard numeric/ordinal display forms identify the same numbered ward.
NUMBER_NAME_REVIEW=[]
ordinal_words=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth','twentieth']
for row in [row for row in DECISIONS if row['decision']=='include']:
    if not re.search(r'^(?:شياخة\s+)?(?:الحي|الحى|حي|حى)\s+',row['nameArabic']):
        continue
    match=re.match(r'^District (\d{1,2})(.*)$',row['nameEnglish'],re.I)
    if match:
        number=int(match.group(1));tail=match.group(2)
    else:
        match=re.match(r'^('+'|'.join(ordinal_words)+r') District(.*)$',row['nameEnglish'],re.I)
        if not match:
            continue
        number=ordinal_words.index(match.group(1).lower())+1;tail=match.group(2)
    suffix='th' if 10<number%100<14 else {1:'st',2:'nd',3:'rd'}.get(number%10,'th')
    old=row['nameEnglish'];row['nameEnglish']=str(number)+suffix+' District'+tail
    if row['nameEnglish']!=old:
        row['aliases'].append(old)
        row['provenance']['nameDisplayRule']='Standard numeric ordinal for a sourced literal district name; original spelling retained.'
        NUMBER_NAME_REVIEW.append({'sourceCode':row['sourceCode'],'before':old,'after':row['nameEnglish'],'arabic':row['nameArabic']})
save(OUT/'number-name-review.json',NUMBER_NAME_REVIEW)

# Final identity deduplication and descriptive disambiguation; never synthetic numeric suffixes.
kept = []

IDENTITY_REVIEW = []

IDENTITY_INDEX = collections.defaultdict(list)
CITY_INDEX = {}
NAME_INDEX = collections.defaultdict(list)
PLACE_POLYGONS = {shape.properties['osmSourceCode']:shape for shape in RES_SHAPES if shape.properties.get('osmSourceCode')}
for row in [r for r in DECISIONS if r['decision'] == 'include']:
    key = (row['governorateCode'], norm(row['nameEnglish']), row['districtSourceCode'])
    is_city = row.get('provenance', {}).get('osmPlaceType') == 'city'
    # A shared ADM2 and name do not prove identity. Never discard a required ADM3 fill.
    duplicate = next((prior for prior in IDENTITY_INDEX[key] if row['rule'] != 'adm3-fill' and distance([row['point']['longitude'],row['point']['latitude']],[prior['point']['longitude'],prior['point']['latitude']]) < 1500),None)
    approved_merge=REVIEW.get('identityMerges',{}).get(row['sourceCode'])
    if approved_merge:
        duplicate=next(prior for prior in kept if prior['sourceCode']==approved_merge['keep'])
    identity_rule=('reviewed-whole-place-identity' if approved_merge else 'close-same-name') if duplicate else None
    if row['rule'] != 'adm3-fill' and not duplicate:
        row_polygon=PLACE_POLYGONS.get(row['sourceCode'])
        point=[row['point']['longitude'],row['point']['latitude']]
        duplicate=next((prior for prior in NAME_INDEX[key[:2]] if (row_polygon and row_polygon.covers([prior['point']['longitude'],prior['point']['latitude']])) or (PLACE_POLYGONS.get(prior['sourceCode']) and PLACE_POLYGONS[prior['sourceCode']].covers(point))),None)
        if duplicate:
            identity_rule='named-source-polygon-contains-point'
    if is_city and not duplicate:
        duplicate = CITY_INDEX.get(key[:2])
        if duplicate:
            identity_rule='same-whole-city'
    if duplicate:
        duplicate['aliases'].extend([row['nameEnglish'], row['nameArabic'], *row['aliases']])
        IDENTITY_REVIEW.append({'kind':'duplicate','kept':duplicate['sourceCode'],'removed':row['sourceCode'],'name':row['nameEnglish'],'district':row['districtSourceCode'],'identityRule':identity_rule,'sourcePointDistanceKm':round(distance([row['point']['longitude'],row['point']['latitude']],[duplicate['point']['longitude'],duplicate['point']['latitude']])/1000,3)})
        row.update(decision='exclude',rule='duplicate-reviewed-identity',notes=identity_rule+'; aliases retained on '+duplicate['sourceCode'],duplicateOf=duplicate['sourceCode'])
    else:
        kept.append(row)
        IDENTITY_INDEX[key].append(row)
        NAME_INDEX[key[:2]].append(row)
        if is_city:
            CITY_INDEX[key[:2]]=row

groups=collections.defaultdict(list)
for row in kept:
    groups[(row['governorateCode'],row['nameEnglish'].lower())].append(row)
# Freeze source names before adding context so display names never recursively reference one another.
base_names={row['sourceCode']:row['nameEnglish'] for row in kept}
for same_names in groups.values():
    if len(same_names)<2:
        continue
    used=set()
    for row in same_names:
        old=base_names[row['sourceCode']]
        parent=row['districtSourceCode']
        context=DIST[parent]['nameEnglish']
        proof={'district':parent}
        siblings=[other for other in same_names if other['districtSourceCode']==parent]
        if len(siblings)>1:
            point=[row['point']['longitude'],row['point']['latitude']]
            references=[]
            for other in kept:
                if other is row or other['governorateCode']!=row['governorateCode'] or other in same_names:
                    continue
                km=distance(point,[other['point']['longitude'],other['point']['latitude']])/1000
                references.append((km,other['sourceCode'],other))
            for km,_,other in sorted(references,key=lambda value:(value[0],value[1])):
                reference=base_names[other['sourceCode']]
                if km<=5:
                    candidate_context=context+', near '+reference
                else:
                    dx=(point[0]-other['point']['longitude'])*math.cos(math.radians(point[1]))
                    dy=point[1]-other['point']['latitude']
                    direction=['north','north-east','east','south-east','south','south-west','west','north-west'][round(math.degrees(math.atan2(dx,dy))/45)%8]
                    candidate_context=context+', '+direction+' of '+reference
                if candidate_context not in used:
                    context=candidate_context
                    proof.update(contextCitySourceCode=other['sourceCode'],contextPointDistanceKm=round(km,3))
                    break
            else:
                raise ValueError('No source-backed name disambiguation for '+row['sourceCode'])
        used.add(context)
        row['nameEnglish']=old+' ('+context+')'
        row['aliases'].append(old)
        row['provenance']['nameDisambiguation']=proof
        IDENTITY_REVIEW.append({'kind':'disambiguation','sourceCode':row['sourceCode'],'before':old,'after':row['nameEnglish'],'arabic':row['nameArabic'],**proof})

def ordinal_aliases(row):
    # Only literal district names, never brands such as District 5 Compound.
    arabic=row['nameArabic']
    english=row['nameEnglish']
    if not re.search(r'^(?:شياخة\s+)?(?:الحي|الحى|حي|حى)\s+',arabic):
        return []
    translated_digits=arabic.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩','0123456789'))
    match=re.search(r'^(?:شياخة\s+)?(?:الحي|الحى|حي|حى)\s+(\d{1,2})(?!\d)',translated_digits)
    if not match:
        match=re.search(r'^(?:District\s+(\d{1,2})|(\d{1,2})(?:st|nd|rd|th) District)',english,re.I)
    if not match:
        return []
    number=int(next(value for value in match.groups() if value))
    if not 1<=number<=35:
        return []
    suffix='th' if 10<number%100<14 else {1:'st',2:'nd',3:'rd'}.get(number%10,'th')
    ordinal_words={1:'First',2:'Second',3:'Third',4:'Fourth',5:'Fifth',6:'Sixth',7:'Seventh',8:'Eighth',9:'Ninth',10:'Tenth',11:'Eleventh',12:'Twelfth',13:'Thirteenth',14:'Fourteenth',15:'Fifteenth',16:'Sixteenth',17:'Seventeenth',18:'Eighteenth',19:'Nineteenth',20:'Twentieth',30:'Thirtieth'}
    english_word=ordinal_words.get(number) or ({2:'Twenty',3:'Thirty'}[number//10]+'-'+ordinal_words[number%10])
    result=['District '+str(number),str(number)+suffix+' District','الحي '+str(number),'الحي '+str(number).translate(str.maketrans('0123456789','٠١٢٣٤٥٦٧٨٩'))]
    result.extend([english_word+' District',english_word.replace('-',' ')+' District'])
    small={1:'الأول',2:'الثاني',3:'الثالث',4:'الرابع',5:'الخامس',6:'السادس',7:'السابع',8:'الثامن',9:'التاسع',10:'العاشر'}
    if number<=10:
        word=small[number]
    elif number<20:
        word=('الحادي' if number==11 else small[number-10])+' عشر'
    else:
        tens={20:'العشرون',30:'الثلاثون'}[number//10*10]
        word=tens if number%10==0 else ('الحادي' if number%10==1 else small[number%10])+' و'+tens
    result.extend(['الحي '+word,'الحي '+word.replace('ون','ين')])
    return result

def clean_aliases(row):
    seen = {row['nameEnglish'].strip().lower(), row['nameArabic'].strip().lower()}
    result = []
    for value in row.get('aliases', []):
        value = clean(value)
        if not value or value.lower() in seen or len(value) > 100 or NOISE.search(value):
            continue
        seen.add(value.lower())
        result.append(value)
    return result

for row in kept:
    b = row['nameEnglish']
    a = row['nameArabic']
    alternatives = [''.join((c for c in unicodedata.normalize('NFKD', b) if not unicodedata.combining(c))), *ordinal_aliases(row)]
    if re.match('^Al[ -]', b, re.I):
        alternatives.append(re.sub('^Al[ -]', 'El ', b, flags=re.I))
    if re.match('^El[ -]', b, re.I):
        alternatives.append(re.sub('^El[ -]', 'Al ', b, flags=re.I))
    if 'Gabir' in b:
        alternatives.append(b.replace('Gabir', 'Gaber'))
    if 'Gaber' in b:
        alternatives.append(b.replace('Gaber', 'Gabir'))
    if 'Mohandes' in b or norm(a) == 'مهندسين':
        alternatives += ['Mohandessin', 'Mohandiseen', 'Mohandeseen']
    row['nameEnglish'] = re.sub('\\b(?:Compund|Copmound)\\b', 'Compound', re.sub('\\b(?:Resosrt|Ressort)\\b', 'Resort', re.sub('\\bMeduim\\b', 'Medium', re.sub('\\b(?:El|Al) (?:El|Al)\\b', 'El', b))), flags=re.I)
    if row['nameEnglish'].islower() or row['nameEnglish'].isupper():
        row['nameEnglish'] = row['nameEnglish'].title()
    row['nameEnglish'] = row['nameEnglish'].replace('_', ' ')
    row['nameEnglish'] = ' '.join((word.title() if word.isupper() and len(word) > 3 else word for word in row['nameEnglish'].split()))
    alternatives += [a.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')), a.translate(str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩'))]
    row['aliases'].extend(alternatives)
    row['aliases'] = clean_aliases(row)

# Preserve attested Arabic spacing variants: OCHA often glues words together.
# This is name enrichment, not a change to the agreed Flutter normalization.
ARABIC_VARIANTS = collections.defaultdict(set)
for element in OSM.values():
    for key in ['name', 'name:ar', 'alt_name', 'alt_name:ar', 'official_name:ar']:
        for value in element.get('tags', {}).get(key, '').split(';'):
            if ar(value):
                ARABIC_VARIANTS[norm(clean(value)).replace(' ', '')].add(clean(value))
for entity in WD.values():
    for value in entity['ar'] | entity['arAlias']:
        ARABIC_VARIANTS[norm(value).replace(' ', '')].add(value)
for row in [*DIST.values(), *kept]:
    for value in [row['nameArabic'], *row.get('aliases', [])]:
        if ar(value):
            row.setdefault('aliases', []).extend(sorted(ARABIC_VARIANTS.get(norm(value).replace(' ', ''), [])))
    row['aliases'] = clean_aliases(row)

# The starter requests are an acceptance input, not a source of invented coordinates.
starter_path = D / 'starter-requests.json'

if not starter_path.exists():
    save(starter_path, {'metadata': {'source': 'Original client task and hand-curated starter checklist', 'date': '2026-11-09'}, 'records': [r for r in OV['decisions'] if not r.get('reviewed')]})

STARTER_REVIEW = []

for request in load(starter_path)['records']:
    area = request['coverageArea']
    wanted = [request['nameEnglish'], request['nameArabic']]
    choices = [r for r in kept if r['coverageArea'] == area] + [r for r in DIST.values() if r['governorateCode'] in {'greater-cairo': ['EG01', 'EG21', 'EG14', 'EG13'], 'alexandria': ['EG02', 'EG18', 'EG33'], 'port-said-region': ['EG03', 'EG19', 'EG11']}[area]]
    target = next((r for r in choices if any((norm(w) == norm(n) for w in wanted for n in [r['nameEnglish'], r['nameArabic'], *r.get('aliases', [])]))), None)
    if not target:
        target = next((r for r in choices if any((len(norm(w)) > 3 and norm(w) in norm(n) for w in wanted for n in [r['nameEnglish'], r['nameArabic']]))), None)
    if target:
        target.setdefault('aliases', []).extend(wanted)
        target['aliases'] = clean_aliases(target)
        STARTER_REVIEW.append({'requestedEnglish': wanted[0], 'requestedArabic': wanted[1], 'sourceCode': target['sourceCode'], 'area': area})
    else:
        STARTER_REVIEW.append({'requestedEnglish': wanted[0], 'requestedArabic': wanted[1], 'area': area, 'unresolved': True})

# Reviewed missing-search variants: explicit source identities/components only.
by_identity = {r['sourceCode']: r for r in [*DIST.values(), *kept]}

for approval in REVIEW.get('aliasReview', []):
    target = by_identity.get(approval['sourceCode'])
    if not target:
        raise ValueError('Reviewed alias target missing ' + approval['sourceCode'])
    target.setdefault('aliases', []).extend(approval['aliases'])
    target['aliases'] = clean_aliases(target)

# District aliases accumulated during starter matching are emitted as reviewed editorial edits.
edits = []

old_edits = {e['sourceCode']: e for e in OV['districtEdits']}

for code, record in DIST.items():
    if code in old_edits or record.get('aliases'):
        edit = old_edits.get(code, {'sourceCode': code, 'nameEnglish': record['nameEnglish'], 'aliases': [], 'notes': 'Source-backed starter spelling aliases; district identity and coordinate unchanged.'})
        edit = {**edit, 'aliases': list(dict.fromkeys([*edit['aliases'], *record.get('aliases', [])]))}
        if code in REVIEW.get('districtNames',{}):
            edit = {**edit,'nameEnglish':REVIEW['districtNames'][code]['nameEnglish'],'notes':REVIEW['districtNames'][code]['notes']}
        edits.append(edit)

save(OUT / 'district-edits.json', edits)

save(OUT / 'bulk-decisions.json', DECISIONS)

save(OUT / 'identity-review.json', IDENTITY_REVIEW)

save(OUT / 'starter-review.json', STARTER_REVIEW)

print('Final included', len(kept), 'identity decisions', len(IDENTITY_REVIEW), 'starter unresolved', sum((bool(r.get('unresolved')) for r in STARTER_REVIEW)))

randomizer = random.Random(20261109)

for label, rows in [('included', [r for r in DECISIONS if r['decision'] == 'include']), ('excluded', [r for r in DECISIONS if r['decision'] == 'exclude'])]:
    sample = randomizer.sample(rows, min(300, len(rows)))
    save(OUT / ('sample-' + label + '.json'), sample)
    lines = []
    for r in sample:
        t = OSM.get(r['sourceCode'], {}).get('tags', {})
        lines.append(' | '.join([r['sourceCode'], r['rule'], str(r.get('coverageArea')), r.get('nameEnglish', t.get('name:en', '')), r.get('nameArabic', t.get('name', '')), str(r.get('districtSourceCode', ''))]))
    (OUT / ('sample-' + label + '.txt')).write_text('\n'.join(lines) + '\n')

save(OUT / 'curated-name-review.json', [{'sourceCode': r['sourceCode'], 'english': r['nameEnglish'], 'arabic': r['nameArabic'], 'rule': r['rule']} for r in kept if r.get('provenance', {}).get('nameSource') == 'curated'])

save(OUT / 'merge-review.json', [r for r in DECISIONS if r['decision'] == 'merge'])
