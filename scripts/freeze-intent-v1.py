"""CPU-only protocol freeze. Fails instead of replacing an existing freeze."""
import hashlib,json,subprocess
from pathlib import Path
import importlib.util
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'experiments/query-intent-v1'
spec=importlib.util.spec_from_file_location('intent_payload',ROOT/'scripts/intent-payload.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
sha=lambda b:hashlib.sha256(b).hexdigest()
critical=['experiments/query-intent-v1/prompt.txt','experiments/query-intent-v1/schema.json','experiments/query-intent-v1/runtime.json','experiments/query-intent-v1/questions-development.json','experiments/query-intent-v1/questions-exposed-conformance.json','experiments/query-intent-v1/expected-queries.json','experiments/query-intent-v1/protocol.md','scripts/intent-payload.py','scripts/run-intent-v1.py','scripts/grade-intent-v1.mjs','intent-validation.mjs','intent-store.mjs','intent-attempt.mjs','intent-grading.mjs','strict-json.mjs','core.mjs','policy.mjs','query-policy.json','data/source-dictionary.json']
budgets=[]
for phase in ['development','exposed-conformance']:
    questions=json.loads((E/f'questions-{phase}.json').read_text())['questions'];budgets.extend(module.payload_for(q)[1]for q in questions)
baseline='703b7210469a34471452dea0b87a791deb0919c7';protected=[]
for name in subprocess.run(['git','ls-tree','-r','--name-only',baseline],cwd=ROOT,check=True,capture_output=True,text=True).stdout.splitlines():
    if name.startswith(('data/','docs/','evidence/'))or name in ['core.mjs','policy.mjs','query-policy.json']:
        original=subprocess.run(['git','show',baseline+':'+name],cwd=ROOT,check=True,capture_output=True).stdout;current=(ROOT/name).read_bytes();assert current==original, 'CPU baseline changed: '+name;protected.append({'path':name,'sha256':sha(current)})
runtime=json.loads((E/'runtime.json').read_text())
out={'protocol_version':runtime['protocol_version'],'frozen_before_inference':True,'cpu_baseline_commit':baseline,'planned_initial_calls':3,'conditional_separate_exposed_conformance_calls':9,'model_calls_at_freeze':0,'model_digest':runtime['model_digest'],'source_csv_sha256':sha((ROOT/'data/Steel_industry_data.csv').read_bytes()),'source_dictionary_sha256':sha((ROOT/'data/source-dictionary.json').read_bytes()),'query_policy_sha256':sha((ROOT/'query-policy.json').read_bytes()),'method_file_sha256':{name:sha((ROOT/name).read_bytes())for name in critical},'protected_cpu_baseline_files':protected,'predeclared_request_budgets':budgets,'minimum_conservative_context_headroom':min(x['conservative_context_headroom']for x in budgets),'measured_tokenization':False}
with (E/'freeze.json').open('x')as file:json.dump(out,file,indent=2);file.write('\n')
print(json.dumps({'frozen':True,'initial_calls':3,'conditional_exposed_calls':9,'minimum_conservative_context_headroom':out['minimum_conservative_context_headroom'],'freeze_sha256':sha((E/'freeze.json').read_bytes()),'method_files':len(critical),'protected_cpu_baseline_files':len(protected)}))
