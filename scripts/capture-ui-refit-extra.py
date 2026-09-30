"""Two additional native CPU views using existing UI only; no existing media regeneration."""
import asyncio,hashlib,json,subprocess,urllib.request
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1];URL='http://127.0.0.1:5162'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
async def main():
    old=json.loads((ROOT/'evidence/ui-refit/media-manifest.json').read_text())
    prior={e['path']:(e['bytes'],e['sha256'])for e in old['files']if e['path'].startswith('docs/')or e['path']in old['runtime_sources']}
    source=ROOT/'data/Steel_industry_data.csv';source_sha=sha(source);assert source_sha=='9b1cee6f9cb9cd9df2b95814ca90a9a2ff15b7f5f1fba0fae3c643e82072eacc'
    server=subprocess.Popen(['node','ui-v2/server.mjs'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    checks=[];shots=[]
    async def screenshot(page,name):
        await page.locator('#result-panel').evaluate("e=>e.scrollIntoView({block:'start'})")
        target=ROOT/'docs/ui-refit'/f'{name}.png'
        assert not target.exists(),'Refuse to overwrite an existing capture'
        await page.screenshot(path=str(target))
        shots.append({'path':str(target.relative_to(ROOT)),'bytes':target.stat().st_size,'sha256':sha(target),'provenance':'Actual native Chrome against unchanged admitted source and UI; existing allowlisted operations only; no model call or previous media regeneration'})
    async def run(page,start,end,operation,week):
        await page.locator('#operation').select_option(operation)
        await page.locator('#start').fill(start);await page.locator('#end').fill(end)
        await page.locator('#week').select_option(week);await page.locator('#load').select_option('ALL')
        await page.locator('#confirm').check();await page.locator('#run').click()
        await expect(page.locator('#run')).to_be_enabled();await expect(page.locator('#result-state')).to_contain_text('EXECUTED')
        return json.loads(await page.locator('#operation-answer').inner_text())
    try:
        for _ in range(80):
            try:urllib.request.urlopen(URL+'/api/admission',timeout=1).close();break
            except Exception:await asyncio.sleep(.1)
        async with async_playwright()as p:
            browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--disable-gpu'])
            ctx=await browser.new_context(viewport={'width':1440,'height':1100},timezone_id='UTC')
            page=await ctx.new_page();errors=[];queries=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:queries.append(r.url)if'/api/'in r.url else None)
            await page.goto(URL);await expect(page.locator('#identity')).to_contain_text('Verified original CSV')
            admission=await page.evaluate("fetch('/api/admission').then(r=>r.json())")
            answer=await run(page,'2018-01-06','2018-01-07','sum_source_usage_kwh','Weekday')
            assert answer['status']=='empty_selection'and answer['answer']['row_count']==0 and answer['answer']['usage_kwh_exact']is None and answer['answer']['value']is None
            await expect(page.locator('#row-scope')).to_contain_text('No selected source rows')
            values=await page.locator('#result-metrics .metric strong').all_text_contents()
            assert values==['No numeric answer','0','0','0'],values
            assert len(json.loads(await page.locator('#filter-preview').inner_text()))==7
            assert admission['audit']['rows_per_day']['2018-01-06']==96
            await screenshot(page,'11-covered-empty-selection')
            checks.append({'check':'Valid covered Jan6 source scope AND Weekday filter selects zero rows; empty sum remains null','status':'passed','query':json.loads(await page.locator('#filter-preview').inner_text()),'source_day_original_rows':96,'answer':answer,'visible_metrics':values,'source_count_is_not_missing_measurement':True})
            answer=await run(page,'2018-11-07','2018-11-08','count_source_rows','ALL')
            await expect(page.locator('#rows [data-row="95"]')).to_have_text('csv-line-29857')
            row=page.locator('#rows tr').last
            await expect(row).to_contain_text('07/11/2018 00:00')
            await row.locator('button').click();await expect(page.locator('#source-row')).to_be_focused()
            raw=json.loads(await page.locator('#source-row').inner_text())
            assert raw['row_id']=='csv-line-29857'and raw['source_span']['line_start']==29857
            assert raw['source_fields']['date']=='07/11/2018 00:00'and raw['source_fields']['Usage_kWh']=='0'and raw['usage_status']=='valid'
            assert answer['answer']['row_count']==96
            await expect(page.locator('#energy-chart-panel')).to_be_hidden()
            jump=next(e for e in admission['audit']['negative_order_jumps']if e['row_id']=='csv-line-29857')
            assert jump['previous_source_date']=='07/11/2018 23:45'and jump['source_date']=='07/11/2018 00:00'
            await screenshot(page,'12-stored-source-value-zero')
            checks.append({'check':'Known stored source value 0 remains valid with exact row/file pointer and original 23:45 to 00:00 order','status':'passed','data_row_number':29856,'file_line':29857,'row_id':raw['row_id'],'source_date':raw['source_fields']['date'],'stored_source_value':raw['source_fields']['Usage_kWh'],'usage_status':raw['usage_status'],'source_span':raw['source_span'],'original_order_audit_finding':jump,'query':json.loads(await page.locator('#filter-preview').inner_text()),'physical_zero_consumption':'not verified','arithmetic_model_credit':0})
            assert not errors,errors
            assert not any('generate'in u or'11434'in u for u in queries)
            await ctx.close();await browser.close()
    finally:server.terminate();server.wait(timeout=5)
    assert sha(source)==source_sha
    for path,(size,digest)in prior.items():assert (ROOT/path).stat().st_size==size and sha(ROOT/path)==digest,path
    out={'kind':'Two additional actual local CPU Chrome views using existing admitted source/UI; not GitHub CI Chrome runs','captured_ui_source_reference_commit':'3f5a28c931586b24151dd8dfcae8ab0af001ddc2','model_calls_added':0,'existing_screenshots_regenerated':False,'video_regenerated':False,'runtime_sources_changed':False,'source_csv_sha256':source_sha,'checks_passed':2,'checks':checks,'screenshots':shots}
    target=ROOT/'evidence/ui-refit/additional-views.json';assert not target.exists();target.write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps({'checks_passed':2,'additional_native_screenshots':2,'model_calls_added':0,'prior_media_and_runtime_unchanged':True}),flush=True)
if __name__=='__main__':asyncio.run(main())
