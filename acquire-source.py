"""One official public source download; originals are immutable and hash-pinned."""
import hashlib,json,urllib.request,zipfile,io
from pathlib import Path
ROOT=Path(__file__).resolve().parent
URL='https://archive.ics.uci.edu/static/public/851/steel+industry+energy+consumption.zip'
ZIP_SHA='d82d28b33780ff1582507fcf08ae764ff648af459d58234370c551e62aadeaef'
CSV_SHA='9b1cee6f9cb9cd9df2b95814ca90a9a2ff15b7f5f1fba0fae3c643e82072eacc'
folder=ROOT/'data';folder.mkdir(exist_ok=True)
archive=folder/'steel-industry-energy-consumption.zip'
if archive.exists():raw=archive.read_bytes()
else:
    with urllib.request.urlopen(URL,timeout=40)as response:raw=response.read(524289)
    if len(raw)>524288:raise ValueError('Archive exceeds declared bound')
    if hashlib.sha256(raw).hexdigest()!=ZIP_SHA:raise ValueError('Official ZIP identity mismatch; admission stopped')
    with archive.open('xb')as f:f.write(raw)
assert hashlib.sha256(raw).hexdigest()==ZIP_SHA
with zipfile.ZipFile(io.BytesIO(raw))as z:
    csvs=[n for n in z.namelist()if n.endswith('.csv')]
    assert len(csvs)==1 and z.getinfo(csvs[0]).file_size<8000000
    csv=z.read(csvs[0]);assert hashlib.sha256(csv).hexdigest()==CSV_SHA
    target=folder/'Steel_industry_data.csv'
    if target.exists():assert target.read_bytes()==csv
    else:
        with target.open('xb')as f:f.write(csv)
receipt={'archive_url':URL,'archive_bytes':len(raw),'archive_sha256':ZIP_SHA,'csv_member':csvs[0],'csv_bytes':len(csv),'csv_sha256':CSV_SHA,'original_modified':False,'dataset_page':'https://archive.ics.uci.edu/dataset/851/steel+industry+energy+consumption','doi':'10.24432/C52G8C','attribution':'V E, S., Shin, C., & Cho, Y. (2021). Steel Industry Energy Consumption. UCI Machine Learning Repository.','license':'CC BY 4.0','license_url':'https://creativecommons.org/licenses/by/4.0/','historical_source_year':2018}
(folder/'admission.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));print(csv[:650].decode('utf-8'))
