import test from 'node:test';import assert from 'node:assert/strict';import {inspectAttempt} from '../intent-attempt.mjs';import {gradeRawIntent} from '../intent-grading.mjs';import {inspectIntent} from '../intent-validation.mjs';import {fixtureAttempt} from './intent-fixtures.mjs';
const fields=['schema_version','operation','source_labeled_date_from','source_labeled_date_to_exclusive','source_weekstatus','source_load_type','unavailable_topic'];
test('only fully bound, dispatched and durably completed raw artifacts can receive semantic credit',()=>{
 const {attempt,context,label}=fixtureAttempt();assert.equal(inspectAttempt(attempt,context).provenance_valid,true);
 const mutations=[a=>a.freeze_sha256='old',a=>a.question_sha256='old',a=>a.case_id='D2',a=>a.phase='wrong',a=>a.model_digest='old',a=>a.runtime_identity.version='wrong',a=>a.source_csv_sha256='old',a=>a.request.prompt+='changed',a=>a.request_sha256='old',a=>a.http_request_attempted=false,a=>a.http_status=500,a=>a.status='timeout',a=>a.api_response.done=false,a=>a.api_response.done_reason='length',a=>a.raw_response_text='{}',a=>a.raw_output=JSON.stringify({...label.query,operation:'count_source_rows'}),a=>a.api_response.thinking='unexpected',a=>delete a.raw_response_text];
 for(const mutate of mutations){const changed=structuredClone(attempt);mutate(changed);const authority=inspectAttempt(changed,context);assert.equal(authority.provenance_valid,false);const grade=gradeRawIntent({...authority,inspection:inspectIntent(changed.raw_output)},label,fields);assert.equal(grade.exact_raw_intent,false);assert.equal(grade.field_matches_count,0);}
 const fabricated={status:'complete',raw_output:attempt.raw_output};assert.equal(inspectAttempt(fabricated,context).provenance_valid,false);
});
test('correct raw invalid-calendar intent is graded separately from policy rejection, with no numeric credit',()=>{
 const {attempt,context,label}=fixtureAttempt('E4'),inspection=inspectIntent(attempt.raw_output),grade=gradeRawIntent({...inspectAttempt(attempt,context),inspection},label,fields);
 assert.equal(grade.exact_raw_intent,true);assert.equal(grade.field_matches_count,7);assert.equal(grade.policy_state,'invalid_calendar_date');assert.equal(grade.backend_execution_allowed,false);assert.equal(grade.model_arithmetic_credit,0);
});
