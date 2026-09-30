import {selectedDateMetric} from './display.mjs';
const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let admission=null,result=null,page=null,offset=0,dirty=true,queryGeneration=0,rowGeneration=0,busy=false,history=[],activeIntent=null;
let focusGeneration=0;document.addEventListener('focusin',()=>++focusGeneration);
export function preserveSubmittingFocus(){const origin=document.activeElement,generation=focusGeneration;return()=>{if(generation===focusGeneration&&document.activeElement===document.body&&origin?.isConnected&&!origin.disabled)origin.focus({preventScroll:true});};}
export const sourceAuthorityAvailable=()=>Boolean(admission);
export const reportIntentFailure=error=>failure(error);
export function stageIntent(review){const q=review.query;for(const [id,field]of[['operation','operation'],['start','source_labeled_date_from'],['end','source_labeled_date_to_exclusive'],['week','source_weekstatus'],['load','source_load_type'],['topic','unavailable_topic']])$(id).value=q[field]??(['week','load'].includes(id)?'ALL':'');proposed();activeIntent=review.binding;$('intent-active-binding').textContent=JSON.stringify({origin:'Human-reviewed stored model intent; execution not started',review_receipt:review.review_receipt},null,2);$('status').textContent='Human-reviewed intent populated the visible builder. Confirm source-label interpretation before deterministic execution.';controls();}
const filter=()=>({schema_version:'P12-UCI851-QUERY-1',operation:$('operation').value,source_labeled_date_from:$('start').value||null,source_labeled_date_to_exclusive:$('end').value||null,source_weekstatus:$('week').value==='ALL'?null:$('week').value,source_load_type:$('load').value==='ALL'?null:$('load').value,unavailable_topic:$('topic').value||null});
const metrics=(target,items)=>$(target).innerHTML=items.map(([value,label])=>`<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
function controls(){
  $('run').disabled=!admission||busy||!$('confirm').checked;$('receipt').disabled=!admission||busy||dirty||!$('confirm').checked||!result?.canonical_query;
  $('day').disabled=!admission||busy||!result?.selected_date_labels.length;$('previous').disabled=!admission||busy||!page||offset===0;$('next').disabled=!admission||busy||!page||offset+96>=page.total_rows;
  $('topic').disabled=$('operation').value!=='report_missing_or_unresolved_field';
}
function proposed(){activeIntent=null;document.dispatchEvent(new CustomEvent('p12:manual-change'));$('intent-active-binding').textContent='Current builder origin: manual. No model review binding is carried into changed fields.';dirty=true;$('confirm').checked=false;$('filter-preview').textContent=JSON.stringify(filter(),null,2);$('status').textContent=result?'Proposed filters changed. The chart/ledger still belong to the previous executed query; confirm and run again.':'Confirm the source-label interpretation, then run this exact filter.';$('result-state').textContent=result?'PREVIOUS EXECUTED QUERY':'NO EXECUTED QUERY';controls();}
 $('operation').addEventListener('change',()=>{if($('operation').value!=='report_missing_or_unresolved_field')$('topic').value='';proposed();});
for(const id of ['start','end','load','week','operation','topic'])$(id).addEventListener('change',proposed);
for(const id of ['start','end'])$(id).addEventListener('input',proposed);
$('confirm').onchange=controls;
async function json(path,body){let r,data;try{r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});data=await r.json();}catch{throw Error('SOURCE_UNAVAILABLE: Server admission or evidence cannot be read. Cached evidence is historical.');}if(!r.ok)throw Error(data.error+': '+data.message);return data;}
function failure(error){$('status').textContent=error.message;if(['SOURCE_HASH_MISMATCH','SOURCE_UNAVAILABLE'].some(code=>error.message.startsWith(code))){admission=null;activeIntent=null;++queryGeneration;++rowGeneration;dirty=true;$('confirm').checked=false;$('identity').textContent='HISTORICAL admitted source snapshot · current authority unavailable. '+($('identity').dataset.admittedSnapshot??'');$('result-state').textContent='HISTORICAL SOURCE SNAPSHOT · CURRENT AUTHORITY UNAVAILABLE · RE-ADMISSION REQUIRED';document.dispatchEvent(new CustomEvent('p12:authority-revoked'));controls();}else if(['STALE_INTENT','STALE_INTENT_QUERY','INTENT_PROTOCOL_STALE','INTENT_PROTOCOL_UNAVAILABLE','INTENT_SOURCE_STALE','INTENT_ATTEMPT_UNAVAILABLE'].some(code=>error.message.startsWith(code))){activeIntent=null;++queryGeneration;++rowGeneration;dirty=true;$('confirm').checked=false;$('result-state').textContent=result?'PREVIOUS INTENT OR QUERY · FRESH INSPECTION REQUIRED':'NO CURRENT INTENT AUTHORITY';document.dispatchEvent(new CustomEvent('p12:intent-revoked'));controls();}}
function draw(){
  const days=result.daily??[],max=Math.max(1,...days.map(d=>Number(d.usage_kwh??d.sumUsage))),x0=70,y0=265,w=1100,h=230;
  let svg='<title>Usage_kWh summed by verbatim source calendar label</title><desc>Half-night labels are not repaired. Exact values and original rows are in the source ledger and receipt.</desc>';
  for(let i=0;i<=4;i++){const y=y0-h*i/4;svg+=`<line x1="${x0}" x2="1170" y1="${y}" y2="${y}" stroke="#c4d3dc"/><text x="8" y="${y+5}">${Math.ceil(max*i/4)}</text>`;}
  svg+='<text x="8" y="20">kWh</text>';
  let previousMonth='';
  days.forEach((d,i)=>{const x=x0+i*w/Math.max(1,days.length),height=Number(d.usage_kwh??d.sumUsage)/max*h,month=d.date_label.slice(0,7),rawLabel=d.date_label.split('-').reverse().join('/');if(month!==previousMonth){svg+=`<text x="${x}" y="292">${month}</text>`;previousMonth=month;}svg+=`<rect data-day="${d.date_label}" tabindex="0" role="button" aria-label="Inspect raw source date label ${rawLabel}, ${esc(d.usage_kwh??'incomplete')} kWh, ${d.row_count} source rows" x="${x}" y="${y0-height}" width="${Math.max(1,w/Math.max(1,days.length)-.6)}" height="${height}" fill="#195d7c"><title>Raw source date label ${rawLabel}: ${esc(d.usage_kwh??'incomplete')} kWh · ${d.row_count} rows</title></rect>`;});
  $('chart').innerHTML=svg;$('empty-message').textContent=result.status==='empty_selection'?'EMPTY: no source rows match the confirmed filter. An empty query is distinct from missing measurements.':result.status==='incomplete_usage'?'MISSING OR INVALID: the selected rows cannot establish a complete energy sum.':days.length?'':'No daily energy series is produced by this operation.';
  for(const rect of $('chart').querySelectorAll('[data-day]')){const inspect=()=>{$('day').value=rect.dataset.day;offset=0;loadRows();};rect.onclick=inspect;rect.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect();}};}
}
function renderResult(){
  $('result-panel').hidden=false;$('result-state').textContent='EXECUTED · '+result.status.toUpperCase();
  $('executed-filter').textContent='Executed source filter: '+JSON.stringify(result.canonical_query)+' · source SHA256 '+result.source_csv_sha256;
  metrics('result-metrics',[[result.answer.value??'No numeric answer','Declared operation value; exact kWh for sum'],[result.receipt.selected_row_count??'Not selected','Selected source rows (scope evidence)'],[result.receipt.contributing_row_count??'Not evaluated','Rows contributing to this operation'],[selectedDateMetric(result),'Matching source-label dates, not elapsed days']]);
  $('operation-answer').textContent=JSON.stringify({status:result.status,reason:result.reason,answer:result.answer},null,2);
  $('executed-intent-review').textContent=result.intent_review_receipt?JSON.stringify({origin:'Human-confirmed stored model intent; arithmetic performed only by CPU',intent_review_receipt:result.intent_review_receipt},null,2):'Execution origin: manual query. No model proposal is credited.';
  $('energy-chart-panel').hidden=result.canonical_query?.operation!=='sum_source_usage_kwh';$('chart').parentElement.hidden=result.status!=='ok';
  $('day').innerHTML=result.selected_date_labels.map(d=>`<option value="${d}">${d}</option>`).join('');
  $('receipt-scope').textContent='Exact receipt scope: '+(result.receipt.selected_row_count??'unknown')+' selected source rows; '+(result.receipt.contributing_row_count??'unknown')+' contribute to this operation. The ledger is a 96-row page of selected evidence, not the full export scope.';
  $('receipt-binding').textContent=JSON.stringify({source_csv_sha256:result.source_csv_sha256,source_dictionary_sha256:result.receipt.source_dictionary_sha256,canonical_query:result.canonical_query,query_policy_sha256:result.receipt.query_policy_sha256,query_fingerprint:result.query_fingerprint,excluded_invalid_date_rows:result.receipt.excluded_invalid_date_rows,arithmetic:'exact decimal integers when energy aggregation is declared',carbon_status:'unit_and_derivation_unresolved'},null,2);
  $('history').innerHTML=history.map((entry,i)=>`<div class="history-item"><strong>${i===history.length-1?'Most recent':'Earlier'} executed query</strong><p>${esc(JSON.stringify(entry.filter))} · ${entry.row_count??'scope not selected'} rows${entry.usage_kwh===null?'':` · ${esc(entry.usage_kwh)} kWh`} · ${esc(entry.status)}</p><p>Source ${entry.source_csv_sha256} · query ${entry.query_fingerprint}</p></div>`).join('');
  $('source-row').textContent='Choose a source row to inspect immutable evidence.';draw();offset=0;controls();loadRows();
}
async function loadRows(){
  const generation=++rowGeneration,query=result?.query_fingerprint;if(!query||!result.selected_date_labels.length){page=null;$('rows').innerHTML='';$('row-scope').textContent='No selected source rows. Invalid scope and empty selection are distinct states.';controls();return;}
  try{
    const data=await json('/api/rows?query_fingerprint='+query+'&date_label='+$('day').value+'&offset='+offset);
    if(generation!==rowGeneration||query!==result?.query_fingerprint)return;page=data;
    $('row-scope').textContent=`${data.date_label}: showing original rows ${data.offset+1}–${Math.min(data.offset+96,data.total_rows)} of ${data.total_rows}; source order retained.`;
    const columns=['date','Usage_kWh','NSM','WeekStatus','Day_of_week','Load_Type'];
    $('rows').innerHTML='<thead><tr><th>Source row ID</th>'+columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'<th>Original byte span</th></tr></thead><tbody>'+data.rows.map((r,i)=>`<tr><td><button data-row="${i}">${esc(r.row_id)}</button></td>`+columns.map(c=>'<td>'+esc(r.source_fields[c])+'</td>').join('')+`<td>[${r.source_span.byte_start}, ${r.source_span.byte_end})</td></tr>`).join('')+'</tbody>';
    for(const button of $('rows').querySelectorAll('[data-row]'))button.onclick=()=>{$('source-row').textContent=JSON.stringify(data.rows[Number(button.dataset.row)],null,2);$('source-row').parentElement.open=true;$('source-row').focus();};controls();
  }catch(e){if(generation===rowGeneration)failure(e);}
}
$('day').onchange=()=>{offset=0;loadRows();};$('previous').onclick=()=>{offset=Math.max(0,offset-96);loadRows();};$('next').onclick=()=>{offset+=96;loadRows();};
$('query-form').onsubmit=async e=>{
  e.preventDefault();if(!admission||!$('confirm').checked||busy)return;
  const generation=++queryGeneration,submitted=filter(),submittedBinding=activeIntent,restoreFocus=preserveSubmittingFocus();++rowGeneration;busy=true;controls();$('status').textContent='Executing deterministic source query…';
  try{const data=await json('/api/query',{query:submitted,interpretation_confirmed:true,...(submittedBinding?{intent_binding:submittedBinding}:{})});if(generation!==queryGeneration)return;result=data;dirty=JSON.stringify(filter())!==JSON.stringify(submitted)||!$('confirm').checked||activeIntent!==submittedBinding;history.push({filter:data.canonical_query,row_count:data.row_count,usage_kwh:data.usage_kwh,status:data.status,source_csv_sha256:data.source_csv_sha256,query_fingerprint:data.query_fingerprint});renderResult();$('status').textContent=dirty?'Query completed for the earlier submitted filter; proposed inputs have since changed. Confirm and run again.':data.status==='ok'?'Declared source operation complete. Carbon total remains unresolved.':data.status+'; no unsupported numeric answer is produced.';if(dirty)$('result-state').textContent='PREVIOUS EXECUTED QUERY';}catch(e){failure(e);}finally{busy=false;controls();restoreFocus();}
};
$('receipt').onclick=async()=>{
  if(!result||dirty||busy||!$('confirm').checked)return;const bound=result,restoreFocus=preserveSubmittingFocus();busy=true;controls();
  try{const data=await json('/api/receipt',{query:bound.canonical_query,interpretation_confirmed:true,source_csv_sha256:bound.source_csv_sha256,query_fingerprint:bound.query_fingerprint,...(bound.intent_binding?{intent_binding:bound.intent_binding}:{})});if(bound!==result||dirty||!$('confirm').checked)return;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='source-query-receipt.json';a.click();URL.revokeObjectURL(url);$('status').textContent='Exact-row receipt prepared. Server acknowledgment does not prove download completion or authorize an operational action.';}catch(e){failure(e);}finally{busy=false;controls();restoreFocus();}
};
try{
  admission=await json('/api/admission');const a=admission.audit,source=admission.admission;
  $('identity').textContent='Verified original CSV '+source.csv_bytes+' bytes · SHA256 '+source.csv_sha256+' · archive '+source.archive_bytes+' bytes';
  $('identity').dataset.admittedSnapshot=$('identity').textContent;
  metrics('audit-metrics',[[a.row_count,'Original source rows'],[a.date_count,'Verbatim date labels'],[a.negative_order_jump_count,'Raw label-order reversals reproduced'],[a.week_status_conflict_count,'WeekStatus/calendar-label disagreements']]);
  $('order-warning').textContent=`${a.negative_order_jump_count} raw label-order reversals: each labeled day places 00:00 after 23:45. Preserve that original position. ${a.every_date_has_96_rows?'Every source date has 96 rows.':'Source date counts vary.'} Timezone and physical intervals remain unspecified.`;
  $('audit-detail').textContent=JSON.stringify(a,null,2);proposed();
}catch(e){$('status').textContent='Admission blocked: '+e.message;$('identity').textContent='Source not admitted.';controls();}
