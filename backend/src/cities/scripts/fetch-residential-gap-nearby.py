import importlib.util,urllib.parse,json
from pathlib import Path
p=Path(__file__).with_name('fetch-residential-gap-research.py');s=importlib.util.spec_from_file_location('fetcher',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.entries=[]
m.D=m.D

gaps=json.load(open(m.B/'output/neighbourhood-cities/lead-residential-gaps.json'))
for a in ['greater-cairo','alexandria','port-said-region']:
 rows=[r for r in gaps if r[1]>2 and r[2]==a]
 q='[out:json][timeout:180];('+''.join(f'nwr(around:1200,{r[5][1]},{r[5][0]})["name"];' for r in rows)+');out center tags;'
 url='https://overpass.kumi.systems/api/interpreter'
 response=m.fetch(url,a+'-nearby-named-retry.json.gz',data=urllib.parse.urlencode({'data':q}).encode())
 print(a,len(response.get('elements',[])) if response else None,flush=True)
