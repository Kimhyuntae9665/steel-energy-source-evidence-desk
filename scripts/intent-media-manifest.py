"""Identity metadata for actual CPU screenshots and original editable generic diagrams."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];docs=ROOT/'docs/intent-v1'
files=[]
for path in sorted(docs.rglob('*')):
    if path.suffix not in ['.png','.svg','.mp4']:continue
    relative=path.relative_to(ROOT).as_posix()
    kind='Actual stored three-call development output; capture CPU-only with zero new inference'if'/actual-stored-development/'in relative else'Synthetic CPU transport UI regression, not a model result'if'/cpu-mock-transport/'in relative else'Preserved before-repair CPU screenshot'if'/before-mobile-repair/'in relative else'Original generic component diagram'if any(name in relative for name in ['optional-branch','architecture-current'])else'Actual CPU browser/source authority evidence; no inference'
    files.append({'path':relative,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'provenance':kind})
out={'model_generation_calls':3,'capture_inference_calls':0,'files':files,'library_status':'No confirmed Library media IDs; desktop upload helper cannot start because Python runtime is unavailable. Public repository artifacts have verified identities.'}
(ROOT/'evidence/intent-v1/media-manifest.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'media_files':len(files),'model_generation_calls':0}))
