import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {inspectIntent} from './intent-validation.mjs';import {validateQuery} from './policy.mjs';import {inspectAttempt} from './intent-attempt.mjs';
const root=new URL('.',import.meta.url),experiment=new URL('experiments/query-intent-v1/',root),sha=b=>createHash('sha256').update(b).digest('hex'),jsonHash=x=>sha(JSON.stringify(x));
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function currentProtocol(){
 let bytes,freeze;try{bytes=readFileSync(new URL('freeze.json',experiment));freeze=JSON.parse(bytes);for(const [name,digest]of Object.entries(freeze.method_file_sha256))if(sha(readFileSync(new URL(name,root)))!==digest)fail('INTENT_PROTOCOL_STALE','Frozen intent method changed. Stored proposals require a separately versioned protocol.');}catch(e){if(e.code==='INTENT_PROTOCOL_STALE')throw e;fail('INTENT_PROTOCOL_UNAVAILABLE','Frozen intent protocol cannot be read. The manual source query path remains separate.');}
 const questions=[];for(const [filename,phase]of[['questions-development.json','development'],['questions-exposed-conformance.json','exposed-conformance']])for(const q of JSON.parse(readFileSync(new URL(filename,experiment))).questions)questions.push({...q,phase,question_sha256:sha(q.question)});
 return {freeze,freeze_sha256:sha(bytes),questions,runtime:JSON.parse(readFileSync(new URL('runtime.json',experiment)))};
}
function diskAttempt(q){try{return readFileSync(new URL(`model-runs/query-intent-v1/${q.phase}/${q.id}.json`,root));}catch(e){if(e.code==='ENOENT')return null;fail('INTENT_ATTEMPT_UNAVAILABLE','Stored intent attempt cannot be read. Its current review authority is unavailable.');}}
export function createIntentStore(bindings,{readAttempt=diskAttempt}={}){
 const reviews=new Map();
 const protocol=()=>{const p=currentProtocol();for(const key of['source_csv_sha256','source_dictionary_sha256','query_policy_sha256'])if(p.freeze[key]!==bindings[key])fail('INTENT_SOURCE_STALE','Stored intent protocol has a different admitted source, dictionary or policy. Inspect the current source.');return p;};
 function proposal(caseId){
  const p=protocol(),q=p.questions.find(x=>x.id===caseId);if(!q)fail('UNKNOWN_INTENT_CASE','Unknown intent case ID. Only frozen questions are supported in this slice.');
  const bytes=readAttempt(q),method_bindings={...bindings,protocol_version:p.freeze.protocol_version,freeze_sha256:p.freeze_sha256,prompt_sha256:p.freeze.method_file_sha256['experiments/query-intent-v1/prompt.txt'],schema_sha256:p.freeze.method_file_sha256['experiments/query-intent-v1/schema.json'],runtime_sha256:p.freeze.method_file_sha256['experiments/query-intent-v1/runtime.json']};
  const base={case_id:q.id,phase:q.phase,question:q.question,question_sha256:q.question_sha256,method_bindings,live_inference:false};
  if(bytes===null)return {...base,state:'not_run',raw_output:null,inspection:null,proposal_fingerprint:null,provenance:'No attempt exists. No inference is triggered by inspection.'};
  let attempt;try{attempt=JSON.parse(bytes);}catch{return {...base,state:'invalid_attempt_file',raw_output:null,inspection:null,proposal_fingerprint:null,provenance:'Stored artifact is invalid; no authority.'};}
  if(!attempt||typeof attempt!=='object'||Array.isArray(attempt))return {...base,state:'invalid_attempt_file',raw_output:null,inspection:null,proposal_fingerprint:null,provenance:'Stored artifact is not an attempt object; scheduled failure retained, no authority.'};
  const raw_output=attempt.raw_output??null,inspection=inspectIntent(raw_output),authority=inspectAttempt(attempt,{question:q,phase:q.phase,freeze:p.freeze,freeze_sha256:p.freeze_sha256,runtime:p.runtime,bindings});
  const state=!authority.binding_valid?'stale_attempt':!authority.provenance_valid?'failed_attempt':!inspection.execution_allowed?'rejected_proposal':'requires_human_semantic_review';
  const raw_output_sha256=typeof raw_output==='string'?sha(raw_output):null,attempt_sha256=sha(bytes),fingerprintPayload={...base,raw_output_sha256,attempt_sha256,exact_proposed_query:inspection.parsed_query};
  return {...base,state,...authority,http_request_attempted:attempt.http_request_attempted===true,raw_output,raw_output_sha256,attempt_sha256,inspection,proposal_fingerprint:jsonHash(fingerprintPayload),transport_status:attempt.status,http_status:attempt.http_status,failure:attempt.failure??null,provenance:attempt.provenance??'Stored local model attempt; backend inspection is separate from raw model output.'};
 }
 function review(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==3||!['case_id','proposal_fingerprint','semantic_confirmation'].every(k=>Object.hasOwn(body,k)))fail('INVALID_INTENT_REVIEW','Review requires exact case ID, displayed proposal fingerprint and explicit semantic confirmation.');
  if(body.semantic_confirmation!==true)fail('INTENT_SEMANTIC_CONFIRMATION_REQUIRED','Review the original question against all seven fields before confirming.');
  const current=proposal(body.case_id);if(current.proposal_fingerprint!==body.proposal_fingerprint)fail('STALE_INTENT','The inspected proposal was replaced or changed. Fresh inspection is required; acceptance is not transferred.');
  if(current.state!=='requires_human_semantic_review')fail('REJECTED_INTENT','This proposal has transport, structure, policy or binding rejection evidence. It cannot populate an accepted builder.');
  const receipt={review_version:'P12-INTENT-HUMAN-REVIEW-1',case_id:current.case_id,question_sha256:current.question_sha256,proposal_fingerprint:current.proposal_fingerprint,raw_output_sha256:current.raw_output_sha256,method_bindings:current.method_bindings,exact_proposed_query:current.inspection.parsed_query,semantic_confirmation:true,semantic_authority:'local human confirmation of interpretation only',deterministic_execution:'not_started',model_arithmetic_authority:false};const review_fingerprint=jsonHash(receipt);reviews.set(review_fingerprint,{...receipt,review_fingerprint});
  return {query:current.inspection.parsed_query,binding:{case_id:current.case_id,proposal_fingerprint:current.proposal_fingerprint,review_fingerprint},review_receipt:reviews.get(review_fingerprint)};
 }
 function validateBinding(binding,query){
  if(!binding||typeof binding!=='object'||Array.isArray(binding)||Object.keys(binding).length!==3||!['case_id','proposal_fingerprint','review_fingerprint'].every(k=>Object.hasOwn(binding,k)))fail('INVALID_INTENT_BINDING','Exact proposal and human review binding is required.');
  const current=proposal(binding.case_id),review=reviews.get(binding.review_fingerprint);
  if(current.state!=='requires_human_semantic_review'||current.proposal_fingerprint!==binding.proposal_fingerprint||!review||review.proposal_fingerprint!==current.proposal_fingerprint)fail('STALE_INTENT','Stored proposal or local review changed. Inspect and confirm again; previous acceptance is historical.');
  const checked=validateQuery(query);if(!checked.valid||jsonHash(checked.canonical_query)!==jsonHash(validateQuery(review.exact_proposed_query).canonical_query))fail('STALE_INTENT_QUERY','Execution query differs from the seven fields accepted by the human. Changed filters require separate manual provenance or fresh inspection.');
  return review;
 }
 return {proposal,review,validateBinding,list:()=>{const p=protocol();return {protocol_version:p.freeze.protocol_version,freeze_sha256:p.freeze_sha256,live_inference:false,cases:p.questions.map(q=>({id:q.id,phase:q.phase,question:q.question,question_sha256:q.question_sha256})),generation_requests_from_ui:0};}};
}
