"""Check the deployed project site, then optionally submit its URL to IndexNow.

IndexNow's public verification file proves control of this project path.
This is not a Google/Bing account credential. Never claim submission is indexing.
"""
import argparse
import json
from pathlib import Path
import re
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET

root=Path(__file__).resolve().parents[1]
site=json.loads((root/'package.json').read_text(encoding='utf-8'))['homepage']
parser=argparse.ArgumentParser()
parser.add_argument('--submit',action='store_true')
options=parser.parse_args()
files=list((root/'docs').glob('indexnow-*.txt'))
if len(files)!=1:raise RuntimeError('Expected one IndexNow verification file')
key=files[0].read_text(encoding='utf-8').strip()
if not re.fullmatch('[a-f0-9]{32}',key):raise RuntimeError('Invalid IndexNow verification key')
key_url=urllib.parse.urljoin(site,files[0].name)
headers={'User-Agent':'PDFSandwich-site-maintenance'}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=45) as response:
        return response.read().decode('utf-8')
if get(key_url).strip()!=key:raise RuntimeError('Deploy the verification file before submitting')
html=get(site)
if f'rel="canonical" href="{site}"' not in html:raise RuntimeError('Deployed canonical URL is stale')
sitemap=ET.fromstring(get(urllib.parse.urljoin(site,'sitemap.xml')))
urls=[n.text for n in sitemap.findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
if urls!=[site]:raise RuntimeError('Unexpected sitemap URLs')
report={'site':site,'deployedFilesVerified':True,'submitted':False}
if options.submit:
    body={'host':urllib.parse.urlparse(site).hostname,'key':key,'keyLocation':key_url,'urlList':urls}
    request=urllib.request.Request('https://api.indexnow.org/indexnow',data=json.dumps(body).encode(),
                                  headers={**headers,'Content-Type':'application/json; charset=utf-8'},method='POST')
    with urllib.request.urlopen(request,timeout=45) as response:
        if response.status not in (200,202):raise RuntimeError('Unexpected IndexNow response')
        report.update(submitted=True,httpStatus=response.status,indexed='not confirmed')
print(json.dumps(report))
