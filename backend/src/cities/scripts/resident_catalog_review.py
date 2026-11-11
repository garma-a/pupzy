"""Lead round8: resident names, same-place identity and honest picker granularity."""
import re,unicodedata,collections,math,difflib
from geo_offline import Shape

DATE='2026-11-11'
# Standalone institutional blocks have no independent neighbourhood evidence.
INSTITUTION=re.compile(r'police|forces|army|air|artillery|presiden|company|authority|insurance|council|intelligence|defense|petroleum|syndicate|cooperatives|القوات|الشرطة|الطيران|المدفعي|الحرس|شركة|الشركة|هيئة|الهيئة|التأمين|التامين|المخابرات|مجلس|النيابة|القضاء|البترول|مصانع|التعاونيات|الامداد|المهمات|مصر التعمير|عثمان أحمد عثمان|المقاولون',re.I)
KNOWN_ESTATE={'OSM:way/37789098','OSM:way/42682258','OSM:way/703299642','OSM:way/715472472','OSM:way/156367204','OSM:way/544180654','OSM:way/682258838','OSM:way/215354869','OSM:way/693486926'}

def norm(v):
 v=re.sub('[ؐ-ًؚ-ٰٟۖ-ۭـ]','',unicodedata.normalize('NFKC',v or '').strip().lower()).translate(str.maketrans('أإآٱةىئؤ٠١٢٣٤٥٦٧٨٩','ااااهييو0123456789'))
 v=re.sub('^(?:el|al)[ -]+','',v);v=re.sub("[-'’]",'',v);v=re.sub(r'\s+',' ',v);return re.sub('^ال','',v).strip()
def alias_norm(v):
 # Match the application/search contract exactly; keep Eastern Arabic digit aliases.
 v=re.sub('[ؐ-ًؚ-ٰٟۖ-ۭـ]','',v.strip().lower()).translate(str.maketrans('أإآٱةىئؤ','ااااهييو'))
 v=re.sub('^(?:el|al)[ -]+','',v);v=re.sub("[-'’]",'',v);v=re.sub(r'\s+',' ',v);return re.sub('^ال','',v).strip()
def base(v):return re.split(r' \(| — ',v)[0].strip()
def ascii_name(v):return unicodedata.normalize('NFKD',v).encode('ascii','ignore').decode().replace('’',"'").strip()
def point(r):return [r['point']['longitude'],r['point']['latitude']] if r.get('point') else [r['longitude'],r['latitude']]
def meters(a,b):
 ax,ay=point(a);bx,by=point(b);rad=math.pi/180;h=math.sin((by-ay)*rad/2)**2+math.cos(ay*rad)*math.cos(by*rad)*math.sin((bx-ax)*rad/2)**2;return 12742017.6*math.atan2(math.sqrt(h),math.sqrt(max(0,1-h)))
def aliases(r):return [r.get('nameEnglish',''),r.get('nameArabic',''),*r.get('aliases',[])]
def identity_labels(r):
 primary=[r['nameEnglish'],r['nameArabic']]
 if not r.get('districtSourceCode'):return {norm(n) for n in primary if n}
 result={norm(base(n)) for n in primary if n}
 for a in r.get('aliases',[]):
  a=base(a)
  if len(a)<3 or re.search(r'[/_,]|قرب|و تشمل|\bnear\b',a,re.I):continue
  result.add(norm(a))
 return result

def apply_resident_review(districts,decisions,osm,adm3,headlines,policy):
 audit=[];owners={};gov_names={r['governorateCode']:r['governorate'] for r in districts};all_by={r['sourceCode']:r for r in [*districts,*decisions]}
 distinct=policy.get('round9',{}).get('distinctSourcePlaces',{})
 def event(r,action,reason,**extra):audit.append({'sourceCode':r['sourceCode'],'action':action,'reason':reason,**extra})
 def rename(r,en,ar,why):
  old=[r['nameEnglish'],r['nameArabic']];r.setdefault('aliases',[]).extend(old);r.update(nameEnglish=en,nameArabic=ar)
  if old!=[en,ar]:event(r,'rename',why,before=old,after=[en,ar])
 def exclude(r,why,kind='noise'):
  event(r,'exclude-'+kind,why,nameEnglish=r.get('nameEnglish'),nameArabic=r.get('nameArabic'));r.update(decision='exclude',rule='resident-review-'+kind,notes=why)
 for restoration in policy.get('round9',{}).get('restorations',[]):
  event(all_by[restoration['sourceCode']],'restore-reviewed-real-place',restoration['basis'])
 # An explicit lead headline supersedes the previous business-park exclusion.
 smart=all_by.get('OSM:node/300754111')
 if smart:
  smart.update(decision='include',rule='lead-headline-established-area',notes='Lead headline explicitly requests the established Smart Village geographic community; predominantly office/technology use is disclosed. Exact recorded OSM place point.');smart.setdefault('provenance',{})['headlineAreaException']='Named technology community explicitly included by lead headline list; not a bank/company building.'
 for r in decisions:
  if r['decision']!='include':continue
  code=r['sourceCode'];en=base(r['nameEnglish']);ar=base(r['nameArabic']);raw=osm.get(code,{}).get('tags',{});text=' '.join([en,ar])
  if code.endswith('-residential-reference'):
   exclude(r,'Lead rejects unnamed extra representative points; no separate sourced local name at this exact spot.','synthetic-representative');continue
  if raw.get('capital')=='yes' or raw.get('capital_ISO3166-1'):
   exclude(r,'National capital city node is not a neighbourhood; Downtown Cairo already represents the central area.');continue
  if re.search(r'^(?:حوض\s*[0-9٠-٩]+|Hod\s*\d+)\b',text,re.I):
   exclude(r,'Numeric cadastral basin label without independent resident-area evidence.');continue
  if en=='Finance and Business Centre':
   exclude(r,'Institutional/business-centre label; no explicit named housing estate in the source.');continue
  if en=='Club' and code not in policy.get('nameCorrections',{}):
   exclude(r,'Bare club label without a reviewed residential district qualifier.');continue
  bank_estate=code in distinct and re.match(r'^مساكن\s+بنك',raw.get('name:ar') or raw.get('name','')) and raw.get('landuse')=='residential'
  if re.search(r'\bbank\b|(?:^|\s)(?:بنك|البنك)(?:\s|$)',text,re.I) and not bank_estate:
   exclude(r,'Bank/office label without independently established housing-estate identity.');continue
  if re.fullmatch(r'[0-9٠-٩\s]+|[ء-ي]|[0-9٠-٩]+\s*[ء-يA-Za-z]|[ء-يA-Za-z]\s*[0-9٠-٩]+',ar.replace('ـ','')) or re.fullmatch(r'(?:Area\s+\d+[A-Z]?|[A-Z]\s+Zone|Zone\s+[A-Z0-9]+)',en,re.I):
   exclude(r,'Bare numeric/letter/zone code has no resident area name.');continue
  if re.search(r'\bUtilities\b|^كمبوند الخدمات$',text,re.I):exclude(r,'Utilities label has no verified independent residential name.');continue
  if re.search(r'\b(?:water|sewage|lift)\s+station\b|محطة (?:مياه|رفع)',text,re.I):exclude(r,'Utility station is infrastructure premises, not a neighbourhood.');continue
  if re.search(r'\b(?:buildings?|towers?)\b',en,re.I) and INSTITUTION.search(text) and code not in KNOWN_ESTATE:
   exclude(r,'Institutional building/tower block without independently established area identity. Staff housing explicitly named Housing is reviewed separately.');continue
  if re.fullmatch(r'(?:El Shams Club|Golf Club)',en,re.I):exclude(r,'Club/golf premises, no independent residential-area identity.');continue
  if re.fullmatch(r'Tourist Village\s+[0-9]+',en,re.I):
   if r['districtSourceCode'] in {'EG2107','EG2121'}:
    rename(r,en+' (October)',ar+' — 6 أكتوبر','Actual named October tourist-village residential quarter; city context retained.');continue
   else:exclude(r,'Uncorroborated numbered tourist-village label.');continue
  clean_ar=re.sub(r'^(?:كمبوند|كومبوند|كومباوند)\s+','',ar)
  if raw.get('place') not in {'village','hamlet'}:clean_ar=re.sub(r'^قرية\s+','',clean_ar)
  clean_en=re.sub(r'^(?:Compound|Comound)\s+|\s+(?:Compound|Comound)$','',en,flags=re.I)
  if raw.get('place') not in {'village','hamlet'}:clean_en=re.sub(r'^(?:Village|The village of)\s+|\s+Village$','',clean_en,flags=re.I)
  if code in distinct:clean_en=en;clean_ar=ar
  rename(r,ascii_name(clean_en),clean_ar,'Unique resident base, ASCII English and generic compound/resort prefix review.')
 for restoration in policy.get('round9',{}).get('restorations',[]):
  rename(all_by[restoration['sourceCode']],restoration['nameEnglish'],restoration['nameArabic'],'Reviewed settlement/estate identity and its real city qualifier supersede generic prefix cleanup.')
 for code,names in policy.get('nameCorrections',{}).items():
  row=all_by.get(code)
  if row and row.get('decision','include')=='include':rename(row,*names,'Reviewed real project/resort primary name; developer/type words stay aliases.')
 for decision in policy.get('aliasDecisions',[]):
  row=all_by[decision['sourceCode']]
  row.setdefault('aliases',[]).extend(decision['aliases'])
  event(row,'exact-name-alias',decision['basis'],entry=decision['entry'],aliases=decision['aliases'])
 # Restore plain source-bound names on district rows, then apply the fixed lead names.
 for r in districts:r['nameEnglish']=ascii_name(r['nameEnglish'])
 for en,ar,gov in headlines['entries']:
  explicit=policy.get('headlineOwners',{}).get(en+'|'+gov)
  rows=[r for r in [*districts,*decisions] if r.get('decision','include')=='include' and gov_names[r['governorateCode']]==gov]
  choices=[r for r in rows if r['sourceCode'] not in distinct and (norm(base(r['nameEnglish']))==norm(en) or norm(base(r['nameArabic']))==norm(ar))]
  if explicit:choices=[all_by[explicit]] if all_by.get(explicit,{}).get('decision','include')=='include' else []
  if not choices:event({'sourceCode':'HEADLINE:'+en},'unresolved-headline','No defensible source row',english=en,arabic=ar,governorate=gov);continue
  def rank(r):
   code=r['sourceCode'];return (0 if not r.get('districtSourceCode') else 1 if code.startswith('OSM:node/') else 2 if code.startswith('OSM:relation/') else 3 if code.startswith('OSM:') else 5 if code.startswith('PUPZY:adm3-') else 4,code)
  keep=min(choices,key=rank);rename(keep,en,ar,'Exact lead headline display; source strings remain untouched aliases.');owners[keep['sourceCode']]=(en,ar,gov)
  for other in choices:
   if other is keep or not other.get('districtSourceCode'):continue
   keep.setdefault('aliases',[]).extend(aliases(other))
   other.update(decision='exclude',rule='resident-headline-whole-place-merge',duplicateOf=keep['sourceCode'],notes='Lead headline identifies one whole place across source centres; source aliases retained on '+keep['sourceCode'])
   event(other,'merge','Same explicit whole-place headline; retain the selected best-evidenced City even when source centres differ by more than2.5km.',keep=keep['sourceCode'],distanceMeters=round(meters(other,keep),2))

 # Remove parent/subarea shorthand before treating every remaining exact alias as identity evidence.
 live=[*districts,*[r for r in decisions if r['decision']=='include']]
 canonical_aliases=collections.defaultdict(list)
 for row in live:
  principal=[row['nameEnglish'],row['nameArabic']]
  for label in [*principal,*[a for a in row.get('aliases',[]) if any(difflib.SequenceMatcher(None,alias_norm(a),alias_norm(p)).ratio()>=.8 for p in principal)]]:
   canonical_aliases[row['governorateCode'],alias_norm(label)].append(row)
 def body(label):
  label=re.sub(r'^(?:قرية|مدينة|مساكن|كمبوند|Village|City|Housing|Compound)\s+|\s+(?:Village|City|Housing|Compound)$','',base(label),flags=re.I)
  return alias_norm(label).replace(' ','')
 protected_alias_owners={'WD:Q4803317','PUPZY:hadara-alexandria','EG3307','WD:Q96395299','OSM:node/768590261'}
 for row in live:
  if row['sourceCode'] in protected_alias_owners:continue
  rejected=[];own={body(row['nameEnglish']),body(row['nameArabic'])}
  for label in row.get('aliases',[]):
   for other in canonical_aliases[row['governorateCode'],alias_norm(label)]:
    if row is other:continue
    theirs={body(other['nameEnglish']),body(other['nameArabic'])}
    if own & theirs:continue
    is_parent=(not row.get('districtSourceCode') and other.get('districtSourceCode')==row['sourceCode']) or (not other.get('districtSourceCode') and row.get('districtSourceCode')==other['sourceCode'])
    is_part=any(a and b and a!=b and (a in b or b in a) for a in own for b in theirs)
    if is_parent or is_part:rejected.append(label);break
  if rejected:
   row['aliases']=[a for a in row.get('aliases',[]) if a not in rejected]
   event(row,'remove-parent-area-alias','Parent/subarea shorthand is not a synonym for this different named place; exact aliases must not mask missing areas.',aliases=rejected)
 # Union geographically close same-name identities across district boundaries.
 rows=[*districts,*[r for r in decisions if r['decision']=='include']];by={r['sourceCode']:r for r in rows};parent={k:k for k in by}
 def leader(k):
  while parent[k]!=k:parent[k]=parent[parent[k]];k=parent[k]
  return k
 groups=collections.defaultdict(list)
 for r in rows:
  for label in identity_labels(r):groups[r['governorateCode'],label].append(r)
 a3={f['properties']['adm3_pcode']:Shape(f['geometry']) for f in adm3}
 for group in groups.values():
  for i,a in enumerate(group):
   for b in group[:i]:
    # Proximity nominates possible duplicates; a reviewed separate settlement
    # or estate polygon is not made identical by generic-name aliases.
    if a['sourceCode'] in distinct or b['sourceCode'] in distinct:continue
    if not a.get('districtSourceCode') and not b.get('districtSourceCode'):continue
    close=meters(a,b)<=2500
    for unit,other in [(a,b),(b,a)]:
     if unit['sourceCode'].startswith('PUPZY:adm3-'):
      shape=a3.get(unit.get('provenance',{}).get('adm3SourceCode'))
      close=close or (shape and shape.covers(point(other))) or meters(unit,other)<=1500
    if close:parent[leader(a['sourceCode'])]=leader(b['sourceCode'])
 components=collections.defaultdict(list)
 for r in rows:components[leader(r['sourceCode'])].append(r)
 for group in components.values():
  if len(group)<2:continue
  def rank(r):
   code=r['sourceCode'];return (0 if not r.get('districtSourceCode') else 1 if code in owners else 2 if code.startswith('OSM:node/') else 3 if code.startswith('OSM:relation/') else 4 if code.startswith('OSM:') else 6 if code.startswith('PUPZY:adm3-') else 5,code)
  # Districts are distinct upstream identities and retain UUIDs; merge neighbourhood duplicates only.
  keep=min(group,key=rank)
  for r in group:
   if r is keep or not r.get('districtSourceCode'):continue
   if r['sourceCode'] in owners and keep['sourceCode'] in owners and owners[r['sourceCode']]!=owners[keep['sourceCode']]:continue
   keep.setdefault('aliases',[]).extend(aliases(r));r.update(decision='exclude',rule='resident-reviewed-same-place-merge',duplicateOf=keep['sourceCode'],notes='Lead same-name/proximity or same-ADM3-polygon identity; aliases merged onto '+keep['sourceCode']);event(r,'merge','Same normalized place within2.5km or matching ADM3 containment, regardless of district.',keep=keep['sourceCode'],distanceMeters=round(meters(r,keep),2))
 # One real parent qualifier at most. The best-known place gets the plain form.
 rows=[*districts,*[r for r in decisions if r['decision']=='include']];govs=collections.defaultdict(list)
 for r in rows:govs[r['governorateCode']].append(r)
 for gov,items in govs.items():
  used_en=set();used_ar=set()
  items.sort(key=lambda r:(0 if r['sourceCode'] in owners else 1 if not r.get('districtSourceCode') else 2 if r['sourceCode'].startswith('OSM:node/') else 3,r['sourceCode']))
  for r in items:
   en=r['nameEnglish'];ar=r['nameArabic'];key=(norm(en),norm(ar))
   if norm(en) in used_en or norm(ar) in used_ar:
    if not r.get('districtSourceCode'):event(r,'district-collision','Distinct official district requires explicit local disambiguation.');continue
    p=all_by[r['districtSourceCode']];pe=re.sub('[()]','',p['nameEnglish']);pa=re.sub('[()]','',p['nameArabic']);en=base(en)+' ('+pe+')';ar=base(ar)+' — '+pa
    if norm(en) in used_en or norm(ar) in used_ar:exclude(r,'Distinct same-parent source has no verified local qualifier; do not invent near/reference labels.','unqualified-collision');continue
    rename(r,en,ar,'One actual district qualifier for a distinct same-name place.')
   used_en.add(norm(r['nameEnglish']));used_ar.add(norm(r['nameArabic']))
 # A distinct City's canonical name must not be shadowed by another area's alias.
 final_rows=[*districts,*[r for r in decisions if r['decision']=='include']]
 canonical=collections.defaultdict(set)
 for row in final_rows:
  for label in [row['nameEnglish'],row['nameArabic']]:canonical[row['governorateCode'],alias_norm(label)].add(row['sourceCode'])
 protected={'WD:Q4803317','PUPZY:hadara-alexandria','EG3307','WD:Q96395299','OSM:node/768590261'}
 for row in final_rows:
  if row['sourceCode'] in protected:continue
  remove=[a for a in row.get('aliases',[]) if any(code!=row['sourceCode'] for code in canonical[row['governorateCode'],alias_norm(a)])]
  if row['sourceCode']=='PUPZY:adm3-eg021703':remove.extend(a for a in row.get('aliases',[]) if alias_norm(a) in {'باكوس','bacos','bakos','bacchus'})
  if remove:
   row['aliases']=[a for a in row.get('aliases',[]) if a not in remove];event(row,'remove-shadowing-alias','Alias is another distinct City primary name; preserve source facts in provenance, not false picker matches.',aliases=remove)
 for r in [*districts,*[r for r in decisions if r['decision']=='include']]:
  western=r['nameArabic'].translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'))
  western=re.sub(r'^(\d+)\s+(بنجر السكر)$',r'\2 \1',western)
  rename(r,r['nameEnglish'],western,'Western Arabic display digits; original digit forms remain aliases. Place number follows Banger El Sokkar.')
  cleaned=[];seen={alias_norm(r['nameEnglish']),alias_norm(r['nameArabic'])}
  for name in r.get('aliases',[]):
   if not name or re.search(r'\bnear\b|قرب|([a-z])\1\1|\ballamein\b',name,re.I):continue
   key=alias_norm(name)
   if key not in seen and len(name)<=100:cleaned.append(name);seen.add(key)
  r['aliases']=cleaned
 return {'reviewed':True,'date':DATE,'counts':dict(collections.Counter(e['action'] for e in audit)),'events':audit,'headlineOwners':owners}
