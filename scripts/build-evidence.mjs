import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {loadDataset,auditDataset} from '../core.mjs';
import {executeQuery,QUERY_POLICY_SHA256} from '../policy.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),dataset=await loadDataset(),audit=auditDataset(dataset);
const base={schema_version:'P12-UCI851-QUERY-1',operation:'sum_source_usage_kwh',source_labeled_date_from:null,source_labeled_date_to_exclusive:null,source_weekstatus:null,source_load_type:null,unavailable_topic:null};
const cases=[
 ['D1','development',{},'ok','959636.71'],
 ['D2','development',{operation:'count_by_source_load_type'},'ok',null],
 ['D3','development',{operation:'describe_source_time_order'},'ok',null],
 ['E1','declared_evaluation',{source_labeled_date_from:'2018-01-01',source_labeled_date_to_exclusive:'2018-02-01'},'ok','126238.29'],
 ['E2','declared_evaluation',{source_labeled_date_from:'2018-01-15',source_labeled_date_to_exclusive:'2018-01-16'},'ok','3968.64'],
 ['E3','declared_evaluation',{operation:'compare_source_weekstatus_sums'},'ok','959636.71'],
 ['E4','declared_evaluation',{operation:'report_missing_or_unresolved_field',unavailable_topic:'period_coverage',source_labeled_date_from:'2018-02-29',source_labeled_date_to_exclusive:'2018-03-01'},'invalid_calendar_date',null],
 ['E5','declared_evaluation',{operation:'report_missing_or_unresolved_field',unavailable_topic:'period_coverage',source_labeled_date_from:'2026-09-30',source_labeled_date_to_exclusive:'2026-10-01'},'period_not_in_historical_source',null],
 ['E6','declared_evaluation',{operation:'report_missing_or_unresolved_field',unavailable_topic:'co2_mass'},'unit_and_derivation_unresolved',null],
 ['E7','declared_evaluation',{operation:'report_missing_or_unresolved_field',unavailable_topic:'energy_per_tonne'},'production_quantity_absent',null],
 ['E8','declared_evaluation',{operation:'report_missing_or_unresolved_field',unavailable_topic:'electricity_cost'},'tariff_and_billing_rules_absent',null],
 ['E9','declared_evaluation',{operation:'report_missing_or_unresolved_field',unavailable_topic:'equipment_fault_cause',source_load_type:'Maximum_Load'},'equipment_and_fault_cause_labels_absent',null]
];
mkdirSync(new URL('../evidence/',import.meta.url),{recursive:true});
const outcomes=cases.map(([id,split,changes,status,sum])=>{
 const query={...base,...changes},r=executeQuery(dataset,query);assert.equal(r.status,status,id);assert.equal(r.answer.usage_kwh_exact,sum,id);
 if(id==='D2')assert.deepEqual(r.answer.groups.map(g=>g.count),[18072,9696,7272]);
 if(id==='D3')assert.equal(r.answer.negative_order_jump_count,365);
 if(id==='E3')assert.deepEqual(r.answer.groups.map(g=>g.sum),['842501.16','117135.55']);
 const {groups,negative_order_jumps,...answer}=r.answer;
 return {id,split,canonical_query:r.canonical_query,status:r.status,reason:r.reason,answer:{...answer,...(groups?{groups:groups.map(({contributing_row_ids,...g})=>({...g,contributing_row_count:contributing_row_ids.length}))}:{})},selected_row_count:r.receipt.selected_row_count,contributing_row_count:r.receipt.contributing_row_count,energy_aggregation_performed:r.receipt.energy_aggregation_performed??false,query_fingerprint:r.query_fingerprint,check:'passed'};
});
const {negative_order_jumps,...auditSummary}=audit;
const zero=dataset.rows.find(r=>r.row_id==='csv-line-29857');assert.equal(zero.source_fields.date,'07/11/2018 00:00');assert.equal(zero.usage_status,'valid');assert.equal(zero.source_fields.Usage_kWh,'0');
const ordinals=dataset.rows.map(r=>r.date.calendar_day_number*86400+r.date.seconds_of_day).sort((a,b)=>a-b),gaps=ordinals.slice(1).map((v,i)=>v-ordinals[i]);assert.equal(gaps.length,35039);assert.ok(gaps.every(g=>g===900));
const artifact={evidence_version:'P12-CPU-CONFORMANCE-1',kind:'Executed deterministic source audit and exposed contract checks, not model evaluation',model_calls:0,source_csv_sha256:dataset.source_csv_sha256,source_dictionary_sha256:sha(readFileSync(new URL('../data/source-dictionary.json',import.meta.url))),query_policy_sha256:QUERY_POLICY_SHA256,declared_cases:12,passed:outcomes.length,limitations:'These inputs and expected outcomes were disclosed in the application contract. They are not independently unseen or a generalization score.',audit:auditSummary,stored_source_zero:{row_id:zero.row_id,raw_source_label:zero.source_fields.date,raw_usage_kwh:zero.source_fields.Usage_kWh,physical_zero_verified:false},sorted_naive_labels:{consecutive_gaps:gaps.length,gap_seconds:900,semantics:'Calendar-coordinate diagnostic only; neither timezone nor physical interval verified.'},outcomes};
writeFileSync(new URL('../evidence/cpu-conformance.json',import.meta.url),JSON.stringify(artifact,null,2)+'\n');
const jan=executeQuery(dataset,{...base,source_labeled_date_from:'2018-01-15',source_labeled_date_to_exclusive:'2018-01-16'});
writeFileSync(new URL('../evidence/jan15-receipt.json',import.meta.url),JSON.stringify({receipt:jan.receipt,acknowledgment:{source_label_interpretation_confirmed:true,export_state:'prepared_and_acknowledged',download_completion:'not_established',target_action:'none',model_calls:0}},null,2)+'\n');
console.log(JSON.stringify({declared_conformance_passed:outcomes.length,total_usage_kwh:audit.total_usage_kwh,csv_sha256:dataset.source_csv_sha256,model_calls:0}));
