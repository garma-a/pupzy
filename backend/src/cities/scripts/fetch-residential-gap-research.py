#!/usr/bin/env python3
"""Developer-only network evidence collector; never imported by builds/tests."""
import urllib.request, urllib.parse, time, json, gzip, hashlib, datetime
from pathlib import Path
B=Path(__file__).resolve().parents[3]
D=B/'src/cities/data/neighbourhoods/research-blocks'
entries=json.loads((D/'manifest-entries.json').read_text()) if (D/'manifest-entries.json').exists() else []

def fetch(url,path,data=None,license='ODbL 1.0',attribution='© OpenStreetMap contributors'):
    dest=D/path
    if dest.exists():return json.loads(gzip.decompress(dest.read_bytes()))
    req=urllib.request.Request(url,data=data,headers={'User-Agent':'PupzyNeighbourhoodDatasetReview/2026-11-10 (offline catalog research; https://github.com/Pupzy)', 'Accept':'application/json'})
    when=datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        with urllib.request.urlopen(req,timeout=70) as response:
            raw=response.read();status=response.status
    except urllib.error.HTTPError as e:
        raw=e.read();status=e.code
    except Exception as e:
        print('network error',path,str(e),flush=True);return None
    blob=gzip.compress(raw,mtime=0);dest.write_bytes(blob)
    entry={'path':str(dest.relative_to(B)),'endpoint':url,'retrievalDate':when,'license':license,'licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','attribution':attribution,'status':'fetched' if status==200 else 'http-error-'+str(status),'sha256':hashlib.sha256(blob).hexdigest(),'sizeBytes':len(blob),'uncompressedSha256':hashlib.sha256(raw).hexdigest(),'uncompressedSizeBytes':len(raw),'representation':'Untouched HTTP response, deterministic gzip (mtime=0)'}
    if data:entry['requestBody']=data.decode()
    entries.append(entry);(D/'manifest-entries.json').write_text(json.dumps(entries,indent=2,ensure_ascii=False)+'\n')
    try:return json.loads(raw)
    except ValueError:return None

if __name__=='__main__':
    gaps=json.load(open(B/'output/neighbourhood-cities/lead-residential-gaps.json'))
    chosen=[x for x in gaps if x[1]>4]
    for n,row in enumerate(chosen):
        count,worst,area,code,name,(lon,lat)=row
        url='https://nominatim.openstreetmap.org/reverse?'+urllib.parse.urlencode({'lat':lat,'lon':lon,'format':'jsonv2','zoom':16,'accept-language':'ar,en','namedetails':1,'addressdetails':1})
        result=fetch(url,code.replace(':','-').replace('/','-')+'-reverse.json.gz')
        print(n+1,code,result.get('display_name') if result else None,flush=True)
        time.sleep(1.1)
