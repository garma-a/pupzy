"""Offline release-B place-granularity review. No network and no review signoff writes.

Call apply_reviewed_noise(decisions, osm_elements, districts) once after all source
classes have produced decisions and before final identity/name disambiguation.
It mutates included neighbourhood decisions in place and returns the audit rows.
Official ADM2 district rows are never inputs to exclusion classification.
"""
import re
import unicodedata
from collections import Counter

POLICY_DATE = '2026-11-10'
PHASE_MERGES = {
    'OSM:way/710695666': ('OSM:way/708795681', 'Zenhom redevelopment phase 1 belongs to the already sourced Zenhom neighbourhood.'),
    'OSM:way/710695667': ('OSM:way/708795681', 'Zenhom redevelopment phase 2 belongs to the already sourced Zenhom neighbourhood.'),
    'OSM:way/1366735844': ('OSM:way/647388131', 'Villette villa construction phase 1 belongs to sourced Villette Sodic Compound.'),
    'OSM:way/1366735845': ('OSM:way/647388131', 'Villette villa construction phase 2 belongs to sourced Villette Sodic Compound.'),
    'OSM:way/1366735846': ('OSM:way/647388131', 'Vellette/Villette villa construction phase 3 belongs to sourced Villette Sodic Compound; source Arabic is فيليت.'),
    'OSM:way/683967814': ('OSM:way/684604815', 'Named extension construction phase 2 of sourced Palm Hills Katameya Compound.'),
    'OSM:way/683967827': ('OSM:way/684604815', 'Named extension construction phase 1 of sourced Palm Hills Katameya Compound.'),
    'OSM:way/701115212': ('OSM:way/701115214', 'Kuwaiti Company Housing construction phase 2 belongs to the already sourced whole housing estate.'),
    'OSM:way/701115213': ('OSM:way/701115214', 'Kuwaiti Company Housing construction phase 1 belongs to the already sourced whole housing estate.'),
    'OSM:way/703311878': ('OSM:way/391189174', 'Becho/Bitcho American City phase 1 belongs to the already sourced Bitcho City; Arabic brand بيتشو matches.'),
    'OSM:way/773160725': ('OSM:way/773160727', 'Dar Misr construction phase 1 belongs to sourced Dar Misr in the same Shorouk district.'),
    'OSM:way/879779745': ('OSM:way/699182641', 'Dar Misr construction phase 2 belongs to sourced Dar Misr in the same 10th of Ramadan district.'),
}
FACILITIES = {
    'OSM:node/300754111':'SmartVillage is a business/technology office park; a village-shaped brand does not establish a residential area.',
    'OSM:way/544180779':'NabcontractBuildings names a contractor building block without independent residential-area identity; do not promote the company block.',
    'OSM:way/801292949':'InternationalPark is park/recreation premises, not the named residential area in its own right.',
    'OSM:node/2595101907': 'Police Academy is an educational/security institution; the nearby named residential districts remain separate.',
    'OSM:way/25580181': 'The source label names a contracting company, without a housing/estate identity.',
    'OSM:way/700684901': 'Al Ahly Club source labels identify the club premises, without independent residential area evidence.',
    'OSM:way/700795803': 'Cairo Airport names transport premises, not a residential neighbourhood.',
    'OSM:way/711387169': 'Al Seka Al Hadid Club names club premises, without independent residential area evidence.',
    'WD:Q110420027': 'The Wikidata label identifies the Olympic sports complex; a city-shaped brand is not residential locality evidence.',
    'WD:Q110420273': 'The Wikidata label identifies the Arts and Culture complex; a city-shaped brand is not residential locality evidence.',
}
INSTITUTION = re.compile(r'armed forces|officers?|teachers?|teaching staff|petrol(?:eum)?|army|police|university|syndicate|association|employees?|company|authority|insurance|government|council|guard|presiden|intelligence|aviation|egypt air|electricity|industrial|coca cola|minist|judges|justice|القوات|ضباط|ظباط|المعلمين|التدريس|البترول|الجيش|الشرطة|الجامع|النقاب|جمعي|العاملين|الشرك|هيئ|التامين|التأمين|الحكوم|مجلس|الحرس|الرئاس|المخابرات|الطيران|مصر للطيران|الكهرباء|الصناعي|كوكاكولا|الوزراء|القضاء', re.I)
HOUSING = re.compile(r'housing|buildings|towers?|residen|compound|مساكن|اسكان|إسكان|عمارات|عماير|أبراج|ابراج|كمبوند', re.I)


def normalized(value):
    value = re.sub('[\u064b-\u065f\u0670\u0640]', '', unicodedata.normalize('NFKC', value or '')).lower()
    value = value.translate(str.maketrans('أإآٱةى', 'ااااهي'))
    return re.sub(r'\s+', ' ', value).strip()


def institutional_housing(row):
    text = ' '.join([row.get('nameEnglish', ''), row.get('nameArabic', '')])
    return bool(INSTITUTION.search(text) and HOUSING.search(text))


def exclusion_reason(row, tags=None):
    """Reject the class from any source, including contradictory place=* tags."""
    tags = tags or {}
    english = row.get('nameEnglish', '')
    arabic = row.get('nameArabic', '')
    text = ' '.join([english, arabic, tags.get('name:en', ''), tags.get('name:ar', ''), tags.get('name', '')])
    code = row['sourceCode']
    if code in FACILITIES:
        return 'nonresidential-institution-or-premises', FACILITIES[code]
    if tags.get('landuse') == 'military' or re.search(r'\boctagon\b|مركز قيادة الدولة', text, re.I):
        return 'military-premises', 'Recorded military landuse/headquarters identity; place=neighbourhood does not convert military premises into a residential area.'
    if tags.get('landuse') == 'industrial' or re.search(r'industrial (?:area|zone)|industries zone|\b\d+ factory area|(?:المنطق[ةه]|منطق[ةه]) الصناعي[ةه]|منطق[ةه] الصناعات|منطق[ةه] ال[أا]لف مصنع', text, re.I):
        return 'industrial-premises', 'Industrial zone/area identity or industrial source landuse, rather than a named residential settlement. Staff housing explicitly named Housing remains a separate class.'
    bare = [english.split(' (', 1)[0], arabic.split(' —', 1)[0], tags.get('name:en', ''), tags.get('name:ar', ''), tags.get('name', '')]
    if any(re.fullmatch(r'(?:village|قري[ةه]|القري[ةه])\s*[0-9٠-٩]+(?:\s*[/_-]\s*[0-9٠-٩]+)*', value.strip(), re.I) for value in bare):
        return 'bare-coded-reclamation-village', 'Only a numeric reclamation-village code is recorded. No reviewed independent full settlement name is supplied; qualified Banger El Sokkar villages and named Abis villages are unaffected.'
    if re.search(r'(?:company|bank).*(?:buildings?|towers?)|(?:buildings?|towers?).*(?:company|bank)|(?:ابراج|أبراج|عمارات|عماير).*?(?:بنك|البنك|شرك[ةه]|الشرك[ةه])', text, re.I):
        return 'bank-or-company-building-blocks', 'Bank/company tower or building-block label; a residential polygon and place tag alone do not establish a commonly used neighbourhood identity.'
    if tags.get('residential') == 'university' or re.search(r'\bstudents? dormitor|المدينة الجامعية طلبة', text, re.I):
        return 'single-student-accommodation', 'University/student dormitory accommodation, not a commonly named residential neighbourhood.'
    if tags.get('amenity') == 'school' or tags.get('leisure') in {'golf_course', 'stadium', 'sports_centre'}:
        return 'school-or-sports-premises', 'Recorded school/sporting premises; institutional land use cannot be promoted merely through place=*.'
    if re.search(r'^Villa\s+(?!Compound)', english, re.I) or re.match(r'^فيلا\s+', arabic):
        return 'single-private-villa', 'Private single-villa label, not settlement evidence, despite the source place classification.'
    if re.search(r'\bphase\b|مرحل[ةه]', text, re.I):
        return 'unreviewed-project-phase', 'A construction phase is not independently selectable. Use a deliberately reviewed whole-project merge/name; no enclosing name is invented.'
    if re.fullmatch(r'first|second|third|fourth|أول|اول|ثان|ثانى|ثاني|ثالث|رابع',english.strip(),re.I) or re.fullmatch(r'أول|اول|ثان|ثانى|ثاني|ثالث|رابع',arabic.strip()):
        return 'bare-administrative-ordinal','Unqualified ordinal, with no named resident locality; use the existing properly named district/neighbourhood instead.'
    if re.search(r'^Zone\s+[a-z0-9]+$', english, re.I) or re.search(r'^(?:\d+\s+buildings?(?:\s+project)?|(?:the\s+)?(?:ten|seven|nine) buildings project|buildings\s+\d+)', english, re.I):
        return 'bare-code-or-building-count', 'Bare zone/building-count identifier, below a named neighbourhood; no independently established full area name.'
    return None


def apply_reviewed_noise(decisions, osm_elements=None, districts=None):
    """Mutate decisions before disambiguation; return an exact per-row audit."""
    osm_elements = osm_elements or {}
    districts = districts or {}
    included = {row['sourceCode']: row for row in decisions if row['decision'] == 'include'}
    audit = []
    for row in list(included.values()):
        code = row['sourceCode']
        raw = osm_elements.get(code, {})
        tags = raw.get('tags', {})
        before = {key: row.get(key) for key in ['nameEnglish', 'nameArabic', 'aliases', 'governorateCode', 'districtSourceCode']}
        if code in PHASE_MERGES:
            target_code, reason = PHASE_MERGES[code]
            target = included.get(target_code)
            if not target or target['governorateCode'] != row['governorateCode'] or target['districtSourceCode'] != row['districtSourceCode']:
                raise ValueError('Reviewed project-phase target missing/different parent: ' + code)
            target.setdefault('aliases', []).extend([row['nameEnglish'], row['nameArabic'], *row.get('aliases', [])])
            row.update(decision='exclude', rule='reviewed-whole-project-phase-merge', notes=reason + ' Aliases retained on ' + target_code, duplicateOf=target_code)
            audit.append({'sourceCode': code, 'action': 'merge', 'rule': row['rule'], 'mergeInto': target_code, 'reason': reason, 'before': before, 'sourceTags': tags})
            continue
        if code == 'OSM:node/13346917626':
            old = [row['nameEnglish'], row['nameArabic']]
            row.update(nameEnglish='Dar Masr Al Andalus', nameArabic='دار مصر الأندلس')
            row.setdefault('aliases', []).extend(old)
            row.setdefault('provenance', {})['wholeProjectNameReview'] = 'Full named Dar Masr Al Andalus estate from source phase label; phase number omitted. Same recorded source point, no new coordinate.'
            audit.append({'sourceCode': code, 'action': 'rename-whole-project', 'rule': 'reviewed-whole-project-name', 'reason': row['provenance']['wholeProjectNameReview'], 'before': before, 'sourceTags': tags})
            continue
        rejected = exclusion_reason(row, tags)
        if rejected:
            rule, reason = rejected
            row.update(decision='exclude', rule='reviewed-noise-' + rule, notes=reason)
            row.setdefault('provenance', {})['noiseReview'] = {'date': POLICY_DATE, 'rule': rule, 'sourceTags': tags}
            audit.append({'sourceCode': code, 'action': 'exclude', 'rule': row['rule'], 'reason': reason, 'before': before, 'sourceTags': tags})
    # Retained employee housing must carry explicit parent context in both languages.
    retained = [row for row in decisions if row['decision'] == 'include']
    ordinary = [*districts.values(), *[row for row in retained if not institutional_housing(row)]]
    real_names = {normalized(row.get(key, '')) for row in ordinary for key in ['nameEnglish', 'nameArabic'] if row.get(key)}
    for row in retained:
        if not institutional_housing(row):
            continue
        parent = districts.get(row['districtSourceCode'], {})
        row.setdefault('provenance', {})['institutionalHousingReview'] = {
            'qualificationRequired': True, 'districtSourceCode': row['districtSourceCode'],
            'parentEnglish': parent.get('nameEnglish'), 'parentArabic': parent.get('nameArabic'),
            'policy': 'Named residential estate retained, with explicit parent qualifier in both languages and unique display name per governorate. Preserve the institutional/housing words; never alias a real ordinary neighbourhood name.'}
        removed = [alias for alias in row.get('aliases', []) if normalized(alias) in real_names]
        if removed:
            row['aliases'] = [alias for alias in row['aliases'] if normalized(alias) not in real_names]
            audit.append({'sourceCode': row['sourceCode'], 'action': 'remove-shadowing-aliases', 'rule': 'institutional-housing-no-real-place-shadow', 'removedAliases': removed, 'reason': 'An institutional estate must not claim a canonical ordinary City/district name as an alias.'})
    return audit
