"""Independent CPU audit: standard csv/Decimal and integer hundredths, not app imports."""
import csv,hashlib,json
from collections import Counter
from datetime import datetime
from decimal import Decimal
from pathlib import Path
root=Path(__file__).resolve().parents[1];path=root/'data/Steel_industry_data.csv';raw=path.read_bytes()
assert hashlib.sha256(raw).hexdigest()=='9b1cee6f9cb9cd9df2b95814ca90a9a2ff15b7f5f1fba0fae3c643e82072eacc'
rows=list(csv.DictReader(raw.decode('utf-8-sig').splitlines()));dates=[datetime.strptime(r['date'],'%d/%m/%Y %H:%M')for r in rows]
def summary(predicate):
    chosen=[r for r in rows if predicate(r)];values=[Decimal(r['Usage_kWh'])for r in chosen];decimal=sum(values,Decimal(0));hundredths=sum(int(v*100)for v in values);assert all(v*100==int(v*100)for v in values);assert decimal==Decimal(hundredths)/100
    return {'rows':len(chosen),'source_label_dates':len({r['date'][:10]for r in chosen}),'exact_usage_kwh':f'{decimal:.2f}','integer_hundredths':hundredths}
out={'kind':'Independent standard-library Decimal/integer-hundredths computation; not publisher labels or model grading','csv_sha256':hashlib.sha256(raw).hexdigest(),'model_calls':0,'all':summary(lambda r:True),'January':summary(lambda r:r['date'][3:10]=='01/2018'),'Jan15':summary(lambda r:r['date'][:10]=='15/01/2018'),'Jan1':summary(lambda r:r['date'][:10]=='01/01/2018'),'Weekday':summary(lambda r:r['WeekStatus']=='Weekday'),'Weekend':summary(lambda r:r['WeekStatus']=='Weekend'),'load_counts':dict(Counter(r['Load_Type']for r in rows)),'raw_label_order_reversals':sum(b<a for a,b in zip(dates,dates[1:])),'all_days_96_rows':set(Counter(r['date'][:10]for r in rows).values())=={96},'stored_source_zeros':[{'data_row':i+1,'file_line':i+2,'raw_label':r['date'],'Usage_kWh':r['Usage_kWh']}for i,r in enumerate(rows)if Decimal(r['Usage_kWh'])==0]}
assert out['all']['exact_usage_kwh']=='959636.71'and out['raw_label_order_reversals']==365
(root/'evidence/independent-arithmetic.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out['all']))
