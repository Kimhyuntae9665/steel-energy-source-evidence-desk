"""Refresh presentation/media identity only; no source download or model call."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
report=json.loads((ROOT/'evidence/ui-refit/browser-checks.json').read_text())
runtime_sources=['ui-v2/index.html','ui-v2/style.css','ui-v2/server.mjs','app.mjs','intent-app.mjs','display.mjs','server.mjs']
reused_sources=['app.mjs','intent-app.mjs','display.mjs','server.mjs']
paths=[entry['path']for entry in report['screenshots']]+runtime_sources+['scripts/ui-refit-media-manifest.py','scripts/browser-ui-refit.py','test/ui-refit.test.mjs','docs/ui-refit/feature-inventory.md','evidence/ui-refit/browser-checks.json','docs/architecture.png','docs/architecture.svg','docs/intent-v1/architecture-current.png','docs/intent-v1/architecture-current.svg','docs/cpu-demo.mp4','docs/intent-v1/actual-stored-development/stored-intent-cpu-demo.mp4']
files=[]
for path in paths:
    p=ROOT/path;data=p.read_bytes()
    historical=path.startswith('docs/')and not path.startswith('docs/ui-refit/')
    files.append({'path':path,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'state':'historical unchanged'if historical else'reused unchanged UI/runtime'if path in reused_sources else'current UI v2','provenance':'Original repository native browser/video or generic artwork; unchanged historical bytes'if historical else'Original delegated frontend/server bytes actually served by the overlay; unchanged from the captured UI commit'if path in reused_sources else'Versioned UI source or actual native Chrome engineering capture; no fabricated or newly generated model outputs'})
out={'base_commit':'29ccb12c1a205512f4dd468c7aed9714e5150cda','captured_ui_source_reference_commit':'1edbc90393c0a4b2d323e3421920deefcaaa851f','runtime_sources':runtime_sources,'backend_method_identity':'Additional immutable parser/policy/intent-store modules are bound by experiments/query-intent-v1/freeze.json; their digests remain unchanged.','model_calls_added':0,'frozen_total_model_calls':12,'new_native_screenshots':10,'new_video':False,'existing_videos':'Historical presentations; no UI v2 footage, no target import or operational-action proof','native_chrome_checks':16,'chrome_execution':'Local installed Chrome; separate from GitHub CPU CI','library_upload':'No new upload attempted; no new Library IDs','files':files}
(ROOT/'evidence/ui-refit/media-manifest.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'identity_files':len(files),'new_screenshots':10,'model_calls_added':0}))
