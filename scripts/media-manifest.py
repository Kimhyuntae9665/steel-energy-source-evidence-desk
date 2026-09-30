import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
files=[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted((ROOT/'docs').glob('*'))if p.suffix in ['.png','.mp4','.svg']]
video=json.loads(subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_name,width,height','-show_entries','format=duration,size','-of','json',str(ROOT/'docs/cpu-demo.mp4')],check=True,capture_output=True,text=True).stdout)
out={'kind':'Actual CPU native browser captures and original architecture artwork','model_calls':0,'no_live_data':True,'source_csv_sha256':'9b1cee6f9cb9cd9df2b95814ca90a9a2ff15b7f5f1fba0fae3c643e82072eacc','video_capture':'Native browser frames sampled at5fps; system CPU FFmpeg; no simulated model output','video':video,'files':files}
(ROOT/'evidence/media-manifest.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'media_files':len(files),'video_seconds':video['format']['duration']}))
