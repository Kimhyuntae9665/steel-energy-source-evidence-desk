"""Bounded CPU browser checks on owned admission copies; no model or baseline-media calls."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PORT = int(os.environ.get('P12_BROWSER_INTENT_PORT', '5124'))
URL = f'http://127.0.0.1:{PORT}'
DOCS = ROOT / 'docs' / 'intent-v1'
EVIDENCE = ROOT / 'evidence' / 'intent-v1'
CHECKS = []
SCREENSHOTS = []
EXPECTED_SOURCE = '9b1cee6f9cb9cd9df2b95814ca90a9a2ff15b7f5f1fba0fae3c643e82072eacc'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

async def screenshot(page, name, full_page=False):
    target = DOCS / (name + '.png')
    await page.screenshot(path=str(target), full_page=full_page)
    SCREENSHOTS.append({'path': str(target.relative_to(ROOT)), 'sha256': sha(target)})

async def checked(name, action):
    started = time.monotonic()
    try:
        details = await action()
        CHECKS.append({'check': name, 'status': 'passed', 'details': details, 'elapsed_seconds': round(time.monotonic() - started, 3)})
        print(json.dumps({'check': name, 'status': 'passed'}), flush=True)
    except Exception as exc:
        CHECKS.append({'check': name, 'status': 'failed', 'error_type': type(exc).__name__, 'error': str(exc).replace(str(ROOT), '[workspace]'), 'elapsed_seconds': round(time.monotonic() - started, 3)})
        print(json.dumps({'check': name, 'status': 'failed', 'error': str(exc)}), flush=True)

async def ready(page):
    await page.goto(URL)
    await expect(page.locator('#identity')).to_contain_text('Verified original CSV')
    await expect(page.locator('#intent-case option')).to_have_count(13)

async def run(page, start='2018-01-15', end='2018-01-16', week='ALL', load='ALL', operation='sum_source_usage_kwh', topic=''):
    await page.locator('#operation').select_option(operation)
    await page.locator('#start').fill(start)
    await page.locator('#end').fill(end)
    await page.locator('#week').select_option(week)
    await page.locator('#load').select_option(load)
    if operation == 'report_missing_or_unresolved_field':
        await page.locator('#topic').select_option(topic)
    await page.locator('#confirm').check()
    await page.locator('#run').click()
    await expect(page.locator('#run')).to_be_enabled()
    await expect(page.locator('#result-state')).to_contain_text('EXECUTED')
    return json.loads(await page.locator('#operation-answer').inner_text())

async def capture_exact(page):
    await expect(page.locator('#rows [data-row="0"]')).to_be_visible()
    await page.locator('#rows [data-row="0"]').click()
    return {key: await page.locator('#' + key).text_content() for key in ['operation-answer', 'receipt-binding', 'executed-filter', 'source-row', 'row-scope', 'rows']}

async def revoked(page, cached):
    await expect(page.locator('#result-state')).to_contain_text('HISTORICAL SOURCE SNAPSHOT')
    await expect(page.locator('#identity')).to_contain_text('HISTORICAL')
    await expect(page.locator('#status')).to_contain_text('SOURCE_UNAVAILABLE')
    await expect(page.locator('#confirm')).not_to_be_checked()
    await expect(page.locator('#run')).to_be_disabled()
    await expect(page.locator('#receipt')).to_be_disabled()
    await expect(page.locator('#day')).to_be_disabled()
    await expect(page.locator('#previous')).to_be_disabled()
    await expect(page.locator('#next')).to_be_disabled()
    await expect(page.locator('#intent-inspect')).to_be_disabled()
    await expect(page.locator('#intent-use')).to_be_disabled()
    for key, value in cached.items():
        assert await page.locator('#' + key).text_content() == value, f'Historical exact evidence changed: {key}'

async def fixture_checks(originals, requests, page_errors):
    """Explicit in-memory CPU mock transport, never a saved model attempt."""
    mock_docs = DOCS / 'cpu-mock-transport'
    mock_docs.mkdir(exist_ok=True)
    async def mock_screenshot(page, name, full_page=False):
        await screenshot(page, 'cpu-mock-transport/' + name, full_page)
    with tempfile.TemporaryDirectory(prefix='p12-cpu-mock-admission-') as owned:
        copies = {name: Path(owned) / path.name for name, path in originals.items()}
        for name, path in copies.items():
            shutil.copyfile(originals[name], path)
        env = dict(os.environ, P12_OWNED_SOURCE=str(copies['source']), P12_OWNED_DICTIONARY=str(copies['dictionary']), P12_OWNED_POLICY=str(copies['policy']), P12_OWNED_PORT=str(PORT))
        command = "import {createDesk} from './server.mjs';import {fixtureAttempt} from './test/intent-fixtures.mjs';import {createInterface} from 'node:readline';let variant='original';createInterface({input:process.stdin}).on('line',line=>{variant=line;process.stdout.write(JSON.stringify({variant})+'\\n');});const read=q=>{const f=fixtureAttempt(q.id);return JSON.stringify((q.id==='D1'&&variant==='weekend'?fixtureAttempt(q.id,{...f.query,source_weekstatus:'Weekend'}):f).attempt);};(await createDesk({sourcePath:process.env.P12_OWNED_SOURCE,dictionaryPath:process.env.P12_OWNED_DICTIONARY,policyPath:process.env.P12_OWNED_POLICY,readIntentAttempt:read})).listen(Number(process.env.P12_OWNED_PORT),'127.0.0.1');"
        server = subprocess.Popen(['node', '--input-type=module', '-e', command], cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        async def variant(value):
            server.stdin.write(value + '\n')
            server.stdin.flush()
            response = await asyncio.wait_for(asyncio.to_thread(server.stdout.readline), 3)
            assert response.strip(), f'CPU mock memory-switch acknowledgment is empty (owned process exit={server.poll()}).'
            try:
                acknowledged = json.loads(response)
            except json.JSONDecodeError as exc:
                raise AssertionError('CPU mock memory-switch acknowledgment is not JSON.') from exc
            assert acknowledged['variant'] == value
        try:
            for _ in range(80):
                if server.poll() is not None:
                    raise RuntimeError('CPU mock server exited: ' + server.stderr.read(8192).replace(str(ROOT), '[workspace]'))
                try:
                    urllib.request.urlopen(URL + '/api/admission', timeout=1).close()
                    break
                except Exception:
                    await asyncio.sleep(.1)
            else:
                raise RuntimeError('CPU mock server did not become ready within bounded startup wait.')
            async with async_playwright() as p:
                browser = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--disable-gpu'])
                context = await browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True, timezone_id='UTC')
                page = await context.new_page()
                page.on('request', lambda request: requests.append(request.url))
                page.on('pageerror', lambda exc: page_errors.append(str(exc)))
                async def inspect(case='D1', reset=True):
                    if reset:
                        await ready(page)
                    await page.locator('#intent-panel').evaluate('e=>e.open=true')
                    await page.locator('#intent-case').select_option(case)
                    await page.locator('#intent-inspect').click()
                    if case == 'D1':
                        await expect(page.locator('#intent-state')).to_contain_text('semantic interpretation requires your review')
                    else:
                        await expect(page.locator('#intent-state')).to_contain_text('REJECTED_PROPOSAL')
                    await expect(page.locator('#intent-validation')).to_contain_text('SYNTHETIC CPU TRANSPORT FIXTURE')
                async def review():
                    await page.locator('#intent-semantic-confirm').check()
                    async with page.expect_response('**/api/intent-review') as response:
                        await page.locator('#intent-use').click()
                    data = await (await response.value).json()
                    await expect(page.locator('#intent-state')).to_contain_text('populated the builder')
                    return data
                async def reviewed_builder_case():
                    before = len(requests)
                    await inspect()
                    await expect(page.locator('#intent-use')).to_be_disabled()
                    await expect(page.locator('#result-panel')).to_be_hidden()
                    await page.locator('#intent-validation').evaluate('e=>e.parentElement.open=true')
                    await mock_screenshot(page, 'unproven-proposal-desktop')
                    first = await review()
                    await expect(page.locator('#confirm')).not_to_be_checked()
                    await expect(page.locator('#run')).to_be_disabled()
                    await expect(page.locator('#result-panel')).to_be_hidden()
                    assert not any('/api/query' in url for url in requests[before:])
                    await inspect(reset=False)
                    second = await review()
                    assert first['binding'] == second['binding']
                    assert first['review_receipt'] == second['review_receipt']
                    assert first['review_receipt']['model_arithmetic_authority'] is False
                    await page.locator('#confirm').check()
                    await page.locator('#run').click()
                    await expect(page.locator('#run')).to_be_enabled()
                    await expect(page.locator('#operation-answer')).to_contain_text('959636.71')
                    await expect(page.locator('#executed-intent-review')).to_contain_text('"model_arithmetic_authority": false')
                    await page.locator('#result-panel').evaluate("e=>e.scrollIntoView({block:'start'})")
                    await mock_screenshot(page, 'human-reviewed-cpu-execution-desktop')
                    async with page.expect_download() as pending:
                        await page.locator('#receipt').click()
                    download = await pending.value
                    exported = json.loads(Path(await download.path()).read_text())
                    receipt = dict(exported['receipt'])
                    fingerprint = receipt.pop('query_fingerprint')
                    assert hashlib.sha256(json.dumps(receipt, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest() == fingerprint
                    assert receipt['canonical_query'] == first['query']
                    assert exported['intent_review_receipt'] == first['review_receipt']
                    assert exported['acknowledgment']['model_calls_in_this_request'] == 0
                    return {'fixture_provenance': 'SYNTHETIC CPU TRANSPORT FIXTURE', 'review_only_execution_requests': 0, 'repeated_review': 'idempotent', 'separate_source_confirmation': True, 'cpu_exact_usage_kwh': '959636.71', 'export_receipt_fingerprint': fingerprint, 'export_review_binding_exact': True, 'model_result': False}
                await checked('CPU mock: explicit semantic review only stages builder; separate source confirmation executes and exact export binds repeated review', reviewed_builder_case)
                for edit in ['manual_edit', 'question_selection']:
                    async def delayed_review_case(edit=edit):
                        await inspect()
                        gate, issued = asyncio.Event(), asyncio.Event()
                        async def delayed(route):
                            response = await route.fetch()
                            assert response.status == 200
                            issued.set()
                            await gate.wait()
                            await route.fulfill(response=response)
                        await page.route('**/api/intent-review', delayed)
                        try:
                            await page.locator('#intent-semantic-confirm').check()
                            await page.locator('#intent-use').click()
                            await asyncio.wait_for(issued.wait(), 10)
                            if edit == 'manual_edit':
                                await page.locator('#start').fill('2018-01-15')
                                await page.locator('#end').fill('2018-01-16')
                                await page.locator('#end').focus()
                            else:
                                await page.locator('#intent-case').select_option('E4')
                                await page.locator('#intent-case').focus()
                            gate.set()
                            await expect(page.locator('#intent-inspect')).to_be_enabled()
                            await asyncio.sleep(.1)
                            await expect(page.locator('#intent-active-binding')).to_contain_text('manual')
                            await expect(page.locator('#confirm')).not_to_be_checked()
                            await expect(page.locator('#result-panel')).to_be_hidden()
                            if edit == 'manual_edit':
                                await expect(page.locator('#start')).to_have_value('2018-01-15')
                                await expect(page.locator('#end')).to_have_value('2018-01-16')
                                await expect(page.locator('#end')).to_be_focused()
                            else:
                                await expect(page.locator('#start')).to_have_value('')
                                await expect(page.locator('#end')).to_have_value('')
                                await expect(page.locator('#intent-case')).to_have_value('E4')
                                await expect(page.locator('#intent-case')).to_be_focused()
                            return {'intervening_action': edit, 'delayed_review_staged': False, 'execution_started': False, 'later_focus_preserved': True, 'model_result': False}
                        finally:
                            gate.set()
                            await page.unroute('**/api/intent-review', delayed)
                    await checked('CPU mock: delayed review cannot stage after ' + edit + ' and preserves later focus', delayed_review_case)
                async def replaced_case():
                    await variant('original')
                    await inspect()
                    binding_text = await page.locator('#intent-binding').text_content()
                    assert binding_text.strip(), 'Current D1 inspection displayed no exact proposal binding.'
                    old_binding = json.loads(binding_text)
                    await variant('weekend')
                    await page.locator('#intent-semantic-confirm').check()
                    await page.locator('#intent-use').click()
                    await expect(page.locator('#intent-state')).to_contain_text('Fresh inspection required: STALE_INTENT')
                    await expect(page.locator('#intent-semantic-confirm')).not_to_be_checked()
                    await expect(page.locator('#intent-use')).to_be_disabled()
                    await expect(page.locator('#intent-active-binding')).to_contain_text('manual')
                    assert json.loads(await page.locator('#intent-binding').text_content()) == old_binding
                    await page.locator('#intent-inspect').click()
                    await expect(page.locator('#intent-state')).to_contain_text('semantic interpretation requires your review')
                    new_binding = json.loads(await page.locator('#intent-binding').text_content())
                    assert new_binding['proposal_fingerprint'] != old_binding['proposal_fingerprint']
                    await expect(page.locator('#intent-fields tr', has_text='source_weekstatus')).to_contain_text('Weekend')
                    await expect(page.locator('#intent-semantic-confirm')).not_to_be_checked()
                    await expect(page.locator('#intent-use')).to_be_disabled()
                    await expect(page.locator('#week')).to_have_value('ALL')
                    await page.locator('#intent-validation').evaluate('e=>e.parentElement.open=true')
                    await mock_screenshot(page, 'replacement-requires-fresh-review-desktop')
                    await variant('original')
                    return {'old_inspection': 'stale', 'new_fingerprint_changed': True, 'fresh_semantic_confirmation_required': True, 'acceptance_transferred': False, 'replacement_source_weekstatus': 'Weekend', 'model_result': False}
                await checked('CPU mock: in-memory proposal replacement cannot inherit acceptance and requires fresh inspection', replaced_case)
                async def rejected_date_case():
                    await inspect('E4')
                    await expect(page.locator('#intent-fields tr', has_text='source_labeled_date_from')).to_contain_text('2018-02-29')
                    await expect(page.locator('#intent-validation')).to_contain_text('invalid_calendar_date')
                    await expect(page.locator('#intent-validation')).to_contain_text('source_labeled_date_from')
                    await expect(page.locator('#intent-semantic-confirm')).to_be_disabled()
                    await expect(page.locator('#intent-use')).to_be_disabled()
                    await expect(page.locator('#result-panel')).to_be_hidden()
                    await page.locator('#intent-validation').evaluate('e=>e.parentElement.open=true')
                    await mock_screenshot(page, 'invalid-calendar-field-desktop')
                    return {'case': 'E4', 'raw_invalid_date_preserved': '2018-02-29', 'policy_state': 'invalid_calendar_date', 'field': 'source_labeled_date_from', 'review_allowed': False, 'model_result': False}
                await checked('CPU mock: E4 invalid Gregorian label is preserved with field-specific rejection and no review authority', rejected_date_case)
                async def mock_mobile_case():
                    mobile_context = await browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='UTC')
                    mobile = await mobile_context.new_page()
                    mobile.on('request', lambda request: requests.append(request.url))
                    mobile.on('pageerror', lambda exc: page_errors.append(str(exc)))
                    try:
                        await ready(mobile)
                        await mobile.locator('#intent-panel').evaluate('e=>e.open=true')
                        await mobile.locator('#intent-case').select_option('D1')
                        await mobile.locator('#intent-inspect').click()
                        await expect(mobile.locator('#intent-state')).to_contain_text('semantic interpretation requires your review')
                        await mobile.locator('#intent-validation').evaluate('e=>e.parentElement.open=true')
                        await expect(mobile.locator('#intent-validation')).to_contain_text('SYNTHETIC CPU TRANSPORT FIXTURE')
                        dimensions = await mobile.evaluate("({page:document.documentElement.scrollWidth,viewport:innerWidth,min_text:Math.min(...Array.from(document.querySelectorAll('#intent-panel p,#intent-panel label,#intent-panel td,#intent-panel pre')).filter(e=>e.offsetParent).map(e=>parseFloat(getComputedStyle(e).fontSize)))})")
                        await mock_screenshot(mobile, 'unproven-proposal-mobile-390', full_page=True)
                        assert dimensions['page'] <= dimensions['viewport'] == 390 and dimensions['min_text'] >= 14, dimensions
                        return {**dimensions, 'fixture_provenance_visible': True, 'model_result': False}
                    finally:
                        await mobile_context.close()
                await checked('CPU mock: 390px unproven proposal and explicit synthetic provenance remain readable without page overflow', mock_mobile_case)
                await context.close()
                await browser.close()
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)

async def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    prior = EVIDENCE / 'before-mobile-repair/before-mobile-repair.json'
    if prior.exists():
        historical = json.loads(prior.read_text())
        for entry in historical.get('checks', []):
            entry.pop('traceback', None)
        prior.write_text(json.dumps(historical, indent=2) + '\n')
    originals = {'source': ROOT / 'data/Steel_industry_data.csv', 'dictionary': ROOT / 'data/source-dictionary.json', 'policy': ROOT / 'query-policy.json'}
    original_digests = {name: sha(path) for name, path in originals.items()}
    assert original_digests['source'] == EXPECTED_SOURCE
    requests, page_errors = [], []
    await fixture_checks(originals, requests, page_errors)
    with tempfile.TemporaryDirectory(prefix='p12-intent-browser-owned-') as owned:
        owned_root = Path(owned)
        copies = {name: owned_root / path.name for name, path in originals.items()}
        pristine = {name: path.read_bytes() for name, path in originals.items()}
        for name, path in copies.items():
            path.write_bytes(pristine[name])
        def restore(name):
            path = copies[name]
            if path.exists():
                path.chmod(0o600)
            path.write_bytes(pristine[name])
            path.chmod(0o600)
        def fault(name, mode):
            path = copies[name]
            if mode == 'missing':
                path.unlink()
            else:
                path.chmod(0)
                try:
                    path.read_bytes()
                except PermissionError:
                    return
                raise AssertionError('Owned unreadable fixture is still readable; cannot claim permission-denial coverage.')
        env = dict(os.environ, P12_OWNED_SOURCE=str(copies['source']), P12_OWNED_DICTIONARY=str(copies['dictionary']), P12_OWNED_POLICY=str(copies['policy']), P12_OWNED_PORT=str(PORT))
        command = "import {createDesk} from './server.mjs'; (await createDesk({sourcePath:process.env.P12_OWNED_SOURCE,dictionaryPath:process.env.P12_OWNED_DICTIONARY,policyPath:process.env.P12_OWNED_POLICY,readIntentAttempt:()=>null})).listen(Number(process.env.P12_OWNED_PORT),'127.0.0.1');"
        server = subprocess.Popen(['node', '--input-type=module', '-e', command], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            for _ in range(80):
                if server.poll() is not None:
                    raise RuntimeError('Isolated server exited: ' + server.stderr.read(8192).decode(errors='replace'))
                try:
                    urllib.request.urlopen(URL + '/api/admission', timeout=1).close()
                    break
                except Exception:
                    await asyncio.sleep(.1)
            else:
                raise RuntimeError('Isolated server did not become ready within bounded startup wait.')
            async with async_playwright() as p:
                browser = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--disable-gpu'])
                context = await browser.new_context(viewport={'width': 1440, 'height': 1050}, timezone_id='UTC')
                page = await context.new_page()
                page.on('request', lambda request: requests.append(request.url))
                page.on('pageerror', lambda exc: page_errors.append(str(exc)))
                await ready(page)
                for start, end, state in [('2018-02-29', '2018-03-01', 'invalid_calendar_date'), ('2018-02-02', '2018-02-01', 'invalid_date_range'), ('2026-09-30', '2026-10-01', 'period_not_in_historical_source'), ('2017-12-31', '2018-01-02', 'scope_not_fully_covered')]:
                    async def scope_case(start=start, end=end, state=state):
                        answer = await run(page, start=start, end=end)
                        assert answer['status'] == state and answer['answer']['count'] is None and answer['answer']['value'] is None
                        values = await page.locator('#result-metrics .metric strong').all_inner_texts()
                        assert values[2] == 'Not evaluated' and values[3] == 'Not evaluated', values
                        await page.locator('#result-panel').evaluate("e=>e.scrollIntoView({block:'start'})")
                        await screenshot(page, state + '-desktop')
                        return {'state': state, 'contributing_rows_display': values[2], 'matching_date_display': values[3], 'answer_count': answer['answer']['count']}
                    await checked('Preselection nullable counts: ' + state, scope_case)
                async def empty_case():
                    answer = await run(page, start='2018-01-01', end='2018-01-02', week='Weekday', load='Maximum_Load')
                    assert answer['status'] == 'empty_selection' and answer['answer']['row_count'] == 0 and answer['answer']['usage_kwh_exact'] is None
                    values = await page.locator('#result-metrics .metric strong').all_inner_texts()
                    assert values[1:] == ['0', '0', '0'], values
                    await screenshot(page, 'covered-empty-desktop')
                    return {'state': 'empty_selection', 'count_displays': values[1:], 'exact_energy': None}
                await checked('Covered empty AND selection shows zero counts and null energy', empty_case)
                async def offline_case():
                    await page.locator('#intent-panel').evaluate('e=>e.open=true')
                    await page.locator('#intent-case').select_option('D1')
                    before = len(requests)
                    await page.locator('#intent-inspect').focus()
                    await page.keyboard.press('Enter')
                    await expect(page.locator('#intent-state')).to_contain_text('NOT RUN')
                    await expect(page.locator('#intent-inspect')).to_be_focused()
                    await expect(page.locator('#intent-semantic-confirm')).to_be_disabled()
                    await expect(page.locator('#intent-use')).to_be_disabled()
                    await expect(page.locator('#intent-raw')).to_contain_text('Generation requests from UI:0')
                    after = requests[before:]
                    assert any('/api/intent-proposal?id=D1' in url for url in after)
                    assert not any('/api/query' in url or '/api/generate' in url or '/api/intent-review' in url for url in after)
                    await screenshot(page, 'not-run-intent-desktop')
                    return {'stored_attempt': 'injected_absent_not_a_model_fixture', 'intent_state': await page.locator('#intent-state').inner_text(), 'request_paths': [url.removeprefix(URL) for url in after], 'keyboard_focus': 'intent-inspect'}
                await checked('Offline not_run inspection performs no generation or execution and preserves keyboard focus', offline_case)
                for name in copies:
                    for mode in ['missing', 'unreadable']:
                        for endpoint in ['receipt', 'rows']:
                            async def fault_case(name=name, mode=mode, endpoint=endpoint):
                                restore(name)
                                await ready(page)
                                answer = await run(page)
                                assert answer['answer']['usage_kwh_exact'] == '3968.64'
                                cached = await capture_exact(page)
                                try:
                                    fault(name, mode)
                                    if endpoint == 'receipt':
                                        await page.locator('#receipt').click()
                                    else:
                                        await page.locator('#day').dispatch_event('change')
                                    await revoked(page, cached)
                                    if name == 'source' and mode == 'missing' and endpoint == 'receipt':
                                        await page.locator('#result-panel').evaluate("e=>e.scrollIntoView({block:'start'})")
                                        await screenshot(page, 'missing-source-historical-desktop')
                                    return {'owned_file': name, 'fault': mode, 'failing_endpoint': endpoint, 'historical_exact_usage_kwh': '3968.64', 'old_evidence_sha256': hashlib.sha256(json.dumps(cached, sort_keys=True).encode()).hexdigest(), 'authority': 'revoked', 'confirmation': False}
                                finally:
                                    restore(name)
                            await checked(f'Owned {name} {mode} failure on {endpoint} revokes authority and preserves exact historical evidence', fault_case)
                async def late_query_case():
                    await ready(page)
                    await run(page)
                    cached = await capture_exact(page)
                    await page.locator('#intent-panel').evaluate('e=>e.open=true')
                    await page.locator('#intent-case').select_option('D1')
                    gate, issued = asyncio.Event(), asyncio.Event()
                    async def delayed(route):
                        response = await route.fetch()
                        assert response.status == 200
                        body = await response.json()
                        assert body['answer']['usage_kwh_exact'] == '351.86'
                        issued.set()
                        await gate.wait()
                        await route.fulfill(response=response)
                    await page.route('**/api/query', delayed)
                    try:
                        await page.locator('#start').fill('2018-01-01')
                        await page.locator('#end').fill('2018-01-02')
                        await page.locator('#confirm').check()
                        await page.locator('#run').click()
                        await asyncio.wait_for(issued.wait(), 10)
                        fault('source', 'missing')
                        await page.locator('#intent-inspect').click()
                        await revoked(page, cached)
                        await page.locator('#end').focus()
                        gate.set()
                        await asyncio.sleep(.2)
                        await revoked(page, cached)
                        await expect(page.locator('#end')).to_be_focused()
                        await page.locator('#result-panel').evaluate("e=>e.scrollIntoView({block:'start'})")
                        await screenshot(page, 'late-query-after-revocation-desktop')
                        return {'held_valid_query_kwh': '351.86', 'retained_historical_query_kwh': '3968.64', 'revocation_endpoint': 'intent-proposal', 'later_focus': 'end', 'old_response_restored_authority': False}
                    finally:
                        gate.set()
                        await page.unroute('**/api/query', delayed)
                        restore('source')
                await checked('Held valid query response cannot replace cached exact evidence or restore revoked authority', late_query_case)
                async def late_rows_case():
                    await ready(page)
                    await run(page, start='2018-01-15', end='2018-01-17')
                    cached = await capture_exact(page)
                    gate, issued = asyncio.Event(), asyncio.Event()
                    async def delayed(route):
                        response = await route.fetch()
                        assert response.status == 200
                        assert (await response.json())['date_label'] == '2018-01-16'
                        issued.set()
                        await gate.wait()
                        await route.fulfill(response=response)
                    await page.route('**/api/rows?*date_label=2018-01-16&*', delayed)
                    try:
                        await page.locator('#day').select_option('2018-01-16')
                        await asyncio.wait_for(issued.wait(), 10)
                        fault('dictionary', 'missing')
                        await page.locator('#receipt').click()
                        await revoked(page, cached)
                        gate.set()
                        await asyncio.sleep(.2)
                        await revoked(page, cached)
                        await expect(page.locator('#row-scope')).to_contain_text('2018-01-15')
                        await page.locator('#result-panel').evaluate("e=>e.scrollIntoView({block:'start'})")
                        await screenshot(page, 'late-rows-after-revocation-desktop')
                        return {'held_valid_row_date': '2018-01-16', 'retained_historical_row_date': '2018-01-15', 'revocation_endpoint': 'receipt', 'late_ledger_overwrite': False}
                    finally:
                        gate.set()
                        await page.unroute('**/api/rows?*date_label=2018-01-16&*', delayed)
                        restore('dictionary')
                await checked('Held valid row response cannot overwrite historical ledger or restore revoked authority', late_rows_case)
                async def mobile_case():
                    mobile_context = await browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='UTC')
                    mobile = await mobile_context.new_page()
                    mobile.on('request', lambda request: requests.append(request.url))
                    mobile.on('pageerror', lambda exc: page_errors.append(str(exc)))
                    try:
                        await ready(mobile)
                        await mobile.locator('#intent-panel').evaluate('e=>e.open=true')
                        await mobile.locator('#intent-case').select_option('D1')
                        await mobile.locator('#intent-inspect').click()
                        await expect(mobile.locator('#intent-state')).to_contain_text('NOT RUN')
                        dimensions = await mobile.evaluate("({page:document.documentElement.scrollWidth,viewport:innerWidth,min_text:Math.min(...Array.from(document.querySelectorAll('#intent-panel p,#intent-panel label,#intent-panel td,#intent-panel pre')).filter(e=>e.offsetParent).map(e=>parseFloat(getComputedStyle(e).fontSize))),overflow_elements:Array.from(document.querySelectorAll('body *')).filter(e=>e.offsetParent&&e.getBoundingClientRect().right>innerWidth+1&&!e.closest('.grid-scroll,.chart-scroll')).map(e=>({tag:e.tagName,id:e.id,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,scroll_width:e.scrollWidth})).slice(0,20)})")
                        await screenshot(mobile, 'not-run-intent-mobile-390', full_page=True)
                        assert dimensions['page'] <= dimensions['viewport'] == 390, dimensions
                        assert dimensions['min_text'] >= 14, dimensions
                        return dimensions
                    finally:
                        await mobile_context.close()
                await checked('390px offline-intent layout has no page overflow and readable text', mobile_case)
                async def isolation_case():
                    assert not page_errors, page_errors
                    assert all(url.startswith(URL + '/') for url in requests), requests
                    assert not any('/api/generate' in url for url in requests)
                    return {'unhandled_page_errors': page_errors, 'generation_requests': 0, 'request_count': len(requests), 'network_scope': 'owned localhost server only'}
                await checked('CPU browser has no unhandled exceptions or generation/external requests', isolation_case)
                await context.close()
                await browser.close()
        finally:
            for name in copies:
                restore(name)
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
    unchanged = {name: sha(path) == original_digests[name] for name, path in originals.items()}
    assert all(unchanged.values()), 'An original protected input changed.'
    report = {'kind': 'Executed CPU-only native Chrome intent/authority regressions', 'model_calls': 0, 'live_inference': False, 'fixture_note': 'Read-only original inputs copied to isolated owned admission fixtures. Explicit CPU-mock checks inject SYNTHETIC CPU TRANSPORT FIXTURE attempts in memory; no model-runs fixture files. Offline authority checks force absent attempts. No generated model result or baseline media rerun.', 'checks_passed': sum(check['status'] == 'passed' for check in CHECKS), 'checks_failed': sum(check['status'] == 'failed' for check in CHECKS), 'checks': CHECKS, 'screenshots': SCREENSHOTS, 'original_digests': original_digests, 'intent_protocol_freeze_sha256': sha(ROOT / 'experiments/query-intent-v1/freeze.json'), 'original_inputs_unchanged': unchanged, 'protected_baseline_media_touched': False}
    (EVIDENCE / 'browser-checks.json').write_text(json.dumps(report, indent=2) + '\n')
    mock_evidence = EVIDENCE / 'cpu-mock-transport'
    mock_evidence.mkdir(exist_ok=True)
    mock_report = {**report, 'kind': 'Synthetic CPU mock transport UI checks; not a model result', 'checks': [item for item in CHECKS if item['check'].startswith('CPU mock:')], 'screenshots': [item for item in SCREENSHOTS if '/cpu-mock-transport/' in item['path']]}
    mock_report['checks_passed'] = sum(item['status'] == 'passed' for item in mock_report['checks'])
    mock_report['checks_failed'] = sum(item['status'] == 'failed' for item in mock_report['checks'])
    (mock_evidence / 'browser-checks.json').write_text(json.dumps(mock_report, indent=2) + '\n')
    print(json.dumps({'checks_passed': report['checks_passed'], 'checks_failed': report['checks_failed'], 'model_calls': 0}), flush=True)
    if report['checks_failed']:
        raise SystemExit(1)

if __name__ == '__main__':
    asyncio.run(main())
