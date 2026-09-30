import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRefitDesk} from '../ui-v2/server.mjs';

test('Versioned UI routes retain original scripts, CSP and admitted CPU query authority',async()=>{
  const desk=await createRefitDesk();
  await new Promise(resolve=>desk.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${desk.address().port}`;
  try {
    const page=await fetch(url),html=await page.text();
    assert.match(html,/에너지 근거 검토/);
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    const baseline=[...readFileSync(new URL('../index.html',import.meta.url),'utf8').matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length);assert.deepEqual(ids.toSorted(),baseline.toSorted());
    assert.equal(page.headers.get('content-security-policy'),"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'");
    assert.equal(await(await fetch(url+'/app.mjs')).text(),readFileSync(new URL('../app.mjs',import.meta.url),'utf8'));
    assert.equal(await(await fetch(url+'/intent-app.mjs')).text(),readFileSync(new URL('../intent-app.mjs',import.meta.url),'utf8'));
    const admission=await(await fetch(url+'/api/admission')).json();
    assert.equal(admission.admission.csv_sha256,'9b1cee6f9cb9cd9df2b95814ca90a9a2ff15b7f5f1fba0fae3c643e82072eacc');
    const query={schema_version:'P12-UCI851-QUERY-1',operation:'sum_source_usage_kwh',source_labeled_date_from:'2018-01-15',source_labeled_date_to_exclusive:'2018-01-16',source_weekstatus:null,source_load_type:null,unavailable_topic:null};
    const result=await(await fetch(url+'/api/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,interpretation_confirmed:true})})).json();
    assert.equal(result.answer.usage_kwh_exact,'3968.64');assert.equal(result.receipt.contributing_row_count,96);
    const unconfirmed=await fetch(url+'/api/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,interpretation_confirmed:false})});
    assert.equal(unconfirmed.status,400);assert.equal((await unconfirmed.json()).error,'INTERPRETATION_REQUIRED');
    assert.equal((await fetch(url+'/unknown')).status,404);
  } finally {await new Promise(resolve=>desk.close(resolve));}
});
