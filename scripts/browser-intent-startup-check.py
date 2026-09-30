"""Delayed actual SOURCE_UNAVAILABLE during optional startup, before/after repair. CPU only."""
import asyncio,hashlib,json,os,shutil,subprocess,tempfile,urllib.request
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1];URL='http://127.0.0.1:5126';BASE='0dbe617c0a14a3d619ce5fda1e675b6787b593b5'
async def main():
    legacy=subprocess.run(['git','show',BASE+':intent-app.mjs'],cwd=ROOT,check=True,capture_output=True).stdout;original=ROOT/'data/Steel_industry_data.csv';original_sha=hashlib.sha256(original.read_bytes()).hexdigest();checks=[]
    with tempfile.TemporaryDirectory(prefix='p12-startup-owned-')as directory:
        copy=Path(directory)/'source.csv';shutil.copyfile(original,copy);held=copy.with_suffix('.held')
        server=subprocess.Popen(['node','--input-type=module','-e',"import {createDesk} from './server.mjs';(await createDesk({sourcePath:process.env.P12_COPY,readIntentAttempt:()=>null})).listen(5126,'127.0.0.1')"],cwd=ROOT,env=dict(os.environ,P12_COPY=str(copy)),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(80):
                try:urllib.request.urlopen(URL+'/api/admission',timeout=1).close();break
                except Exception:await asyncio.sleep(.1)
            async with async_playwright()as p:
                browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--disable-gpu'])
                for before in [True,False]:
                    context=await browser.new_context(viewport={'width':1440,'height':1050});page=await context.new_page();gate=asyncio.Event();issued=asyncio.Event();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                    if before:await page.route('**/intent-app.mjs',lambda route:route.fulfill(status=200,content_type='text/javascript',body=legacy))
                    async def delay(route):issued.set();await gate.wait();response=await route.fetch();await route.fulfill(response=response)
                    await page.route('**/api/intent-cases',delay);await page.goto(URL,wait_until='commit');await expect(page.locator('#identity')).to_contain_text('Verified original CSV');await asyncio.wait_for(issued.wait(),5)
                    await page.locator('#start').fill('2018-01-15');await page.locator('#end').fill('2018-01-16');await page.locator('#confirm').check();await page.locator('#run').click();await expect(page.locator('#result-state')).to_contain_text('EXECUTED');await expect(page.locator('#receipt')).to_be_enabled();await expect(page.locator('#row-scope')).to_contain_text('96');cached=await page.locator('#operation-answer').text_content();receipt=await page.locator('#receipt-binding').text_content()
                    copy.rename(held);gate.set();await expect(page.locator('#intent-state')).to_contain_text('SOURCE_UNAVAILABLE');await asyncio.sleep(.05)
                    state={'before_repair':before,'state':await page.locator('#result-state').text_content(),'confirmation':await page.locator('#confirm').is_checked(),'receipt_enabled':await page.locator('#receipt').is_enabled(),'query_enabled':await page.locator('#run').is_enabled(),'cached_exact_answer_unchanged':await page.locator('#operation-answer').text_content()==cached,'cached_receipt_sha256':hashlib.sha256(receipt.encode()).hexdigest(),'source_file_fault':'owned copy renamed, original unchanged','model_calls':0}
                    if before:assert state['state']=='EXECUTED · OK'and state['confirmation']and state['receipt_enabled'];state['outcome']='reproduced stale authority display'
                    else:assert 'HISTORICAL'in state['state']and not state['confirmation']and not state['receipt_enabled']and not state['query_enabled'];await expect(page.locator('#identity')).to_contain_text('HISTORICAL');assert state['cached_exact_answer_unchanged'];state['outcome']='shared revocation preserves historical evidence'
                    assert not errors;await page.locator('#result-panel').evaluate("e=>e.scrollIntoView({block:'start'})");target=ROOT/'docs/intent-v1/startup-repair';target.mkdir(parents=True,exist_ok=True);await page.screenshot(path=str(target/('before-repair.png'if before else'after-repair.png')));checks.append(state);held.rename(copy);await context.close()
                await browser.close()
        finally:
            if held.exists():held.rename(copy)
            server.terminate();server.wait(timeout=5)
    assert hashlib.sha256(original.read_bytes()).hexdigest()==original_sha
    destination=ROOT/'evidence/intent-v1/startup-repair.json';destination.write_text(json.dumps({'kind':'Actual delayed startup admission failure engineering regression','before_commit':BASE,'model_calls':0,'frozen_protocol_changed':False,'original_source_sha256':original_sha,'checks':checks},indent=2)+'\n');print(json.dumps({'before_failure_reproduced':True,'after_regression_passed':True,'model_calls':0}))
if __name__=='__main__':asyncio.run(main())
