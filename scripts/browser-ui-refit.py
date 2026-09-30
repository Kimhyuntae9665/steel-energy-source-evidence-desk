"""Actual Chrome checks for UI v2; uses owned admission copies and stored actual proposals only."""
import asyncio, hashlib, json, os, shutil, subprocess, tempfile, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
PORT=5162
URL=f'http://127.0.0.1:{PORT}'
CHECKS=[]
SHOTS=[]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(name,details=None):
    CHECKS.append({'check':name,'status':'passed','details':details})
    print(json.dumps({'check':name,'status':'passed'}),flush=True)
async def shot(page,name,target=None,full=False):
    if target:await page.locator(target).evaluate("e=>e.scrollIntoView({block:'start'})")
    p=ROOT/'docs/ui-refit'/f'{name}.png'
    await page.screenshot(path=str(p),full_page=full)
    SHOTS.append({'path':str(p.relative_to(ROOT)),'sha256':sha(p),'bytes':p.stat().st_size,'provenance':'Actual native Chrome, UI v2, admitted original UCI bytes or owned-copy read fault, stored actual model output only. No generation.'})
async def ready(page):
    await page.goto(URL)
    await expect(page.locator('#identity')).to_contain_text('Verified original CSV')
    await expect(page.locator('#intent-case option')).to_have_count(13)
async def run(page,start='2018-01-15',end='2018-01-16',operation='sum_source_usage_kwh',topic='',week='ALL',load='ALL'):
    await page.locator('#operation').select_option(operation)
    await page.locator('#start').fill(start);await page.locator('#end').fill(end)
    await page.locator('#week').select_option(week);await page.locator('#load').select_option(load)
    if operation=='report_missing_or_unresolved_field':await page.locator('#topic').select_option(topic)
    await page.locator('#confirm').check();await page.locator('#run').click()
    await expect(page.locator('#run')).to_be_enabled()
    await expect(page.locator('#result-state')).to_contain_text('EXECUTED')
async def main():
    (ROOT/'docs/ui-refit').mkdir(parents=True,exist_ok=True)
    (ROOT/'evidence/ui-refit').mkdir(parents=True,exist_ok=True)
    originals={'source':ROOT/'data/Steel_industry_data.csv','dictionary':ROOT/'data/source-dictionary.json','policy':ROOT/'query-policy.json'}
    original_shas={k:sha(v)for k,v in originals.items()}
    with tempfile.TemporaryDirectory(prefix='p12-ui-owned-')as directory:
        copies={k:Path(directory)/v.name for k,v in originals.items()}
        for k,v in copies.items():shutil.copyfile(originals[k],v)
        env=dict(os.environ,P12_COPY=str(copies['source']),P12_DICT=str(copies['dictionary']),P12_POLICY=str(copies['policy']))
        code="import {createRefitDesk} from './ui-v2/server.mjs';(await createRefitDesk({sourcePath:process.env.P12_COPY,dictionaryPath:process.env.P12_DICT,policyPath:process.env.P12_POLICY})).listen(5162,'127.0.0.1');"
        server=subprocess.Popen(['node','--input-type=module','-e',code],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(80):
                try:urllib.request.urlopen(URL+'/api/admission',timeout=1).close();break
                except Exception:await asyncio.sleep(.1)
            async with async_playwright()as p:
                browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--disable-gpu'])
                context=await browser.new_context(viewport={'width':1440,'height':1100},accept_downloads=True,timezone_id='UTC')
                page=await context.new_page();errors=[];requests=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('request',lambda r:requests.append(r.url.split('/api/')[-1]if'/api/'in r.url else'static'))
                await ready(page)
                tokens=await page.evaluate("({bg:getComputedStyle(document.documentElement).backgroundColor,title:getComputedStyle(document.querySelector('.page-title')).fontSize,width:document.querySelector('main').getBoundingClientRect().width,panels:[...document.querySelectorAll('.workspace>section')].map(e=>({w:e.getBoundingClientRect().width,bg:getComputedStyle(e).backgroundColor}))})")
                assert tokens['bg']=='rgb(241, 244, 246)'and tokens['title']=='36px'and tokens['width']==1120
                assert tokens['panels'][0]['w']==tokens['panels'][1]['w']and all(x['bg']=='rgb(255, 255, 255)'for x in tokens['panels'])
                check('Approved exact tokens and equal visible source/result panels',tokens)
                await shot(page,'01-admission-audit')
                await page.locator('#start').fill('2018-01-15');await page.locator('#end').fill('2018-01-16')
                q=json.loads(await page.locator('#filter-preview').inner_text());assert len(q)==7
                await expect(page.locator('#run')).to_be_disabled();await shot(page,'02-manual-date-query')
                await run(page);await expect(page.locator('#rows')).to_contain_text('15/01/2018 00:00')
                await expect(page.locator('#operation-answer')).to_contain_text('3968.64')
                await expect(page.locator('#rows [data-row="95"]')).to_have_text('csv-line-1441')
                check('Seven exact query fields; Jan15 CPU sum 3968.64, 96 original-order rows and midnight retained')
                await page.locator('#rows [data-row="95"]').click()
                await expect(page.locator('#source-row')).to_contain_text('15/01/2018 00:00')
                await page.set_viewport_size({'width':1440,'height':1600})
                await shot(page,'03-jan15-chart-ledger','#result-panel')
                await page.set_viewport_size({'width':1440,'height':1100})
                first=json.loads(await page.locator('#receipt-binding').inner_text())['query_fingerprint']
                async with page.expect_download()as download:await page.locator('#receipt').click()
                data=json.loads(Path(await(await download.value).path()).read_text())
                assert data['receipt']['query_fingerprint']==first and len(data['receipt']['contributing_row_ids'])==96
                assert data['acknowledgment']['download_completion']=='not_established'
                await shot(page,'04-receipt-history','#receipt')
                await page.locator('#confirm').uncheck();await expect(page.locator('#receipt')).to_be_disabled()
                await page.locator('#confirm').focus();await page.keyboard.press('Space');await page.keyboard.press('Tab')
                await expect(page.locator('#run')).to_be_focused();await page.keyboard.press('Enter')
                await expect(page.locator('#run')).to_be_enabled();await expect(page.locator('#run')).to_be_focused()
                assert json.loads(await page.locator('#receipt-binding').inner_text())['query_fingerprint']==first
                check('Actual JSON download exact binding; confirmation withdrawal; Tab/Enter retained focus; repeated fingerprint stable')
                for start,end,state in [('2018-02-29','2018-03-01','invalid_calendar_date'),('2018-02-02','2018-02-01','invalid_date_range'),('2026-09-30','2026-10-01','period_not_in_historical_source'),('2017-12-31','2018-01-02','scope_not_fully_covered')]:
                    await run(page,start,end);await expect(page.locator('#operation-answer')).to_contain_text(state)
                    await expect(page.locator('#result-metrics')).to_contain_text('Not evaluated')
                    if state=='scope_not_fully_covered':await shot(page,'05-partial-not-evaluated','#result-panel')
                await run(page,'2018-01-01','2018-01-02',week='Weekday',load='Maximum_Load')
                await expect(page.locator('#operation-answer')).to_contain_text('empty_selection')
                assert '0' in await page.locator('#result-metrics').inner_text()
                check('Invalid calendar/range/outside/partial preserve Not evaluated; covered empty selection is 0')
                await run(page,'','',operation='report_missing_or_unresolved_field',topic='co2_mass')
                await expect(page.locator('#operation-answer')).to_contain_text('unit_and_derivation_unresolved')
                await expect(page.locator('#energy-chart-panel')).to_be_hidden()
                await shot(page,'06-unresolved-carbon','#result-panel')
                check('Unavailable carbon unit remains unresolved; no chart/number invented')
                await page.locator('#intent-panel').evaluate('e=>e.open=true')
                await page.locator('#intent-case').select_option('D1');await page.locator('#intent-inspect').click()
                await expect(page.locator('#intent-state')).to_contain_text('semantic interpretation requires')
                await expect(page.locator('#intent-fields tr')).to_have_count(7)
                await page.locator('#intent-raw').evaluate('e=>e.parentElement.open=true')
                await shot(page,'07-stored-actual-proposal','#intent-panel')
                await page.locator('#intent-semantic-confirm').check();await page.locator('#intent-use').click()
                await expect(page.locator('#confirm')).not_to_be_checked();await expect(page.locator('#run')).to_be_disabled()
                await page.locator('#confirm').check();await page.locator('#run').click()
                await expect(page.locator('#operation-answer')).to_contain_text('959636.71')
                await expect(page.locator('#executed-intent-review')).to_contain_text('arithmetic performed only by CPU')
                check('Actual stored D1 reviewed; separate source confirmation required; full-source arithmetic credited only to CPU')
                await page.locator('#intent-case').select_option('E3');await page.locator('#intent-inspect').click()
                await expect(page.locator('#intent-fields')).to_contain_text('Weekday')
                await expect(page.locator('#intent-semantic-confirm')).not_to_be_checked()
                await expect(page.locator('#intent-use')).to_be_disabled()
                await shot(page,'08-e3-meaning-not-accepted','#intent-panel')
                check('Stored actual semantically wrong E3 Weekday narrowing withheld human acceptance; no automatic execution')
                await page.locator('#intent-case').select_option('E4');await page.locator('#intent-inspect').click()
                await expect(page.locator('#intent-semantic-confirm')).to_be_disabled();await expect(page.locator('#intent-use')).to_be_disabled()
                await expect(page.locator('#intent-validation')).to_contain_text('invalid_calendar_date')
                check('Actual E4 invalid preserved date receives field-specific policy rejection')
                # Real response is delayed only in Chrome; changing inputs must invalidate it.
                await run(page);gate=asyncio.Event();issued=asyncio.Event()
                async def delayed(route):
                    response=await route.fetch();issued.set();await gate.wait();await route.fulfill(response=response)
                await page.route('**/api/query',delayed)
                await page.locator('#confirm').check();await page.locator('#run').click();await asyncio.wait_for(issued.wait(),5)
                await page.locator('#start').fill('2018-01-01');await page.locator('#end').focus();gate.set()
                await expect(page.locator('#result-state')).to_have_text('PREVIOUS EXECUTED QUERY')
                await expect(page.locator('#receipt')).to_be_disabled();await expect(page.locator('#end')).to_be_focused()
                await page.unroute('**/api/query',delayed)
                check('Delayed changed query remains previous evidence and preserves later focus')
                # Actual read failures on every admission component revoke all actions.
                for key in copies:
                    await ready(page);await run(page);cached=await page.locator('#operation-answer').inner_text()
                    held=copies[key].with_suffix('.held');copies[key].rename(held)
                    try:
                        await page.locator('#receipt').click();await expect(page.locator('#result-state')).to_contain_text('HISTORICAL')
                        await expect(page.locator('#confirm')).not_to_be_checked();await expect(page.locator('#run')).to_be_disabled();await expect(page.locator('#receipt')).to_be_disabled()
                        assert await page.locator('#operation-answer').inner_text()==cached
                        if key=='source':await shot(page,'09-source-unavailable-historical','#result-panel')
                    finally:held.rename(copies[key])
                    check(f'Actual owned {key} read failure revokes authority and retains unchanged historical answer')
                # Admission list delayed at startup; server read fails after a manual result.
                gate=asyncio.Event();issued=asyncio.Event()
                async def startup(route):issued.set();await gate.wait();response=await route.fetch();await route.fulfill(response=response)
                await page.route('**/api/intent-cases',startup);await page.goto(URL,wait_until='commit')
                await expect(page.locator('#identity')).to_contain_text('Verified original CSV');await asyncio.wait_for(issued.wait(),5)
                await run(page);cached=await page.locator('#operation-answer').inner_text()
                held=copies['source'].with_suffix('.held');copies['source'].rename(held)
                try:
                    gate.set();await expect(page.locator('#intent-state')).to_contain_text('SOURCE_UNAVAILABLE')
                    await expect(page.locator('#run')).to_be_disabled();await expect(page.locator('#receipt')).to_be_disabled()
                    await expect(page.locator('#confirm')).not_to_be_checked();assert await page.locator('#operation-answer').inner_text()==cached
                finally:held.rename(copies['source'])
                await page.unroute('**/api/intent-cases',startup)
                check('Actual delayed startup intent-list read failure revokes already executed manual result')
                titles=[]
                for zone in ['UTC','America/New_York']:
                    z=await browser.new_context(timezone_id=zone);zp=await z.new_page();await ready(zp);await run(zp)
                    titles.append(await zp.locator('#chart rect title').first.text_content());await z.close()
                assert titles[0]==titles[1]and'15/01/2018'in titles[0]
                check('Native chart raw tooltip identical across timezones',titles[0])
                mobile=await browser.new_context(viewport={'width':390,'height':844});mp=await mobile.new_page();await ready(mp);await run(mp)
                dims=await mp.evaluate("({page:document.documentElement.scrollWidth,viewport:innerWidth,title:getComputedStyle(document.querySelector('.page-title')).fontSize,titleWidth:document.querySelector('.page-title').scrollWidth,titleClient:document.querySelector('.page-title').clientWidth,chart:document.querySelector('#chart').getBoundingClientRect().width,minText:Math.min(...[...document.querySelectorAll('pre,table,label,.metric span')].filter(e=>e.offsetParent).map(e=>parseFloat(getComputedStyle(e).fontSize)))})")
                assert dims['page']<=390 and dims['title']=='28px'and dims['titleWidth']<=dims['titleClient']and dims['chart']>=1200 and dims['minText']>=14
                await shot(mp,'10-mobile-390',full=True)
                check('Actual 390px single-line Korean title, no page overflow, 14px+ evidence and horizontally scrollable chart/ledger',dims)
                await mobile.close();assert not errors,errors
                assert not any('11434'in x or'generate'in x for x in requests)
                check('No unhandled desktop Chrome exceptions; zero generation requests')
                await context.close();await browser.close()
        finally:server.terminate();server.wait(timeout=5)
    assert {k:sha(v)for k,v in originals.items()}==original_shas
    result={'kind':'Actual local CPU-only Chrome UI v2 engineering checks, not GitHub CI Chrome runs','model_calls_added':0,'synthetic_model_outputs':0,'checks_passed':len(CHECKS),'checks':CHECKS,'source_csv_sha256':original_shas['source'],'screenshots':SHOTS,'video':'No new video; existing videos explicitly historical. Native screenshots contain no fabricated output.'}
    (ROOT/'evidence/ui-refit/browser-checks.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'checks_passed':len(CHECKS),'screenshots':len(SHOTS),'model_calls_added':0}),flush=True)
if __name__=='__main__':asyncio.run(main())
