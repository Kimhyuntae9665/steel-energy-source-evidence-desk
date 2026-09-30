"""Actual stored D1 result UI capture. CPU browser/video only; no inference requests."""
import asyncio,hashlib,json,subprocess,tempfile,urllib.request
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1];DOCS=ROOT/'docs/intent-v1/actual-stored-development';URL='http://127.0.0.1:5125'
async def main():
    DOCS.mkdir(parents=True,exist_ok=True);server=subprocess.Popen(['node','--input-type=module','-e',"import {createDesk} from './server.mjs';(await createDesk()).listen(5125,'127.0.0.1')"],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            try:urllib.request.urlopen(URL+'/api/admission',timeout=1).close();break
            except Exception:await asyncio.sleep(.1)
        async with async_playwright()as p:
            browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--disable-gpu']);context=await browser.new_context(viewport={'width':1440,'height':1050});page=await context.new_page();requests=[];page.on('request',lambda request:requests.append(request.url))
            await page.goto(URL);await expect(page.locator('#identity')).to_contain_text('Verified original CSV');await page.locator('#intent-panel').evaluate('e=>e.open=true');await page.locator('#intent-case').select_option('D1');await page.locator('#intent-inspect').click();await expect(page.locator('#intent-state')).to_contain_text('semantic interpretation requires your review');await page.locator('#intent-raw').evaluate('e=>e.parentElement.open=true');await expect(page.locator('#intent-raw')).to_contain_text('sum_source_usage_kwh');await page.locator('#intent-panel').screenshot(path=str(DOCS/'raw-proposal-human-review.png'))
            with tempfile.TemporaryDirectory(prefix='p12-stored-demo-',dir=ROOT/'private')as temporary:
                frames=Path(temporary);stopped=False
                async def capture():
                    index=0
                    while not stopped:
                        await page.screenshot(path=str(frames/f'frame-{index:05d}.jpg'),type='jpeg',quality=80);index+=1;await asyncio.sleep(.2)
                await page.locator('#intent-panel').evaluate("e=>e.scrollIntoView({block:'start'})");task=asyncio.create_task(capture())
                try:
                    await asyncio.sleep(1);await page.locator('#intent-semantic-confirm').check();await page.locator('#intent-use').click();await expect(page.locator('#intent-active-binding')).to_contain_text('execution not started');await expect(page.locator('#result-panel')).to_be_hidden();await expect(page.locator('#confirm')).not_to_be_checked();await page.locator('#query-form').evaluate("e=>e.scrollIntoView({block:'start'})");await asyncio.sleep(1);await page.locator('#confirm').check();await page.locator('#run').click();await expect(page.locator('#operation-answer')).to_contain_text('959636.71');await expect(page.locator('#executed-intent-review')).to_contain_text('"model_arithmetic_authority": false');await page.locator('#executed-intent-review').evaluate('e=>e.parentElement.open=true');await page.locator('#result-panel').evaluate("e=>e.scrollIntoView({block:'start'})");await page.screenshot(path=str(DOCS/'human-reviewed-cpu-result.png'));await asyncio.sleep(2)
                finally:stopped=True;await task
                subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-framerate','5','-i',str(frames/'frame-%05d.jpg'),'-an','-c:v','libx264','-preset','fast','-crf','27','-pix_fmt','yuv420p','-movflags','+faststart',str(DOCS/'stored-intent-cpu-demo.mp4')],check=True)
            await context.close();await browser.close();assert all(url.startswith(URL+'/')for url in requests);assert not any('/api/generate'in url for url in requests)
        attempt=ROOT/'model-runs/query-intent-v1/development/D1.json';out={'kind':'Actual stored Qwen D1 output followed by human test review and deterministic source query','new_inference_calls':0,'source_model_batch_calls':3,'source_attempt_sha256':hashlib.sha256(attempt.read_bytes()).hexdigest(),'source_protocol_freeze_sha256':hashlib.sha256((ROOT/'experiments/query-intent-v1/freeze.json').read_bytes()).hexdigest(),'model_arithmetic_credit':0,'cpu_source_sum':'959636.71','no_automatic_execution':True,'separate_source_confirmation':True,'files':[{'path':path.relative_to(ROOT).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}for path in sorted(DOCS.iterdir())]};destination=ROOT/'evidence/intent-v1/actual-stored-development.json';destination.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'actual_stored_capture_files':len(out['files']),'new_inference_calls':0}))
    finally:server.terminate();server.wait(timeout=5)
if __name__=='__main__':asyncio.run(main())
