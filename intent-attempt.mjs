import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex'),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Artifact provenance/completion checks. This does not grade meaning, repair output or execute a query.
export function inspectAttempt(attempt,{question,phase,freeze,freeze_sha256,runtime,bindings}){
 const budget=freeze.predeclared_request_budgets.find(x=>x.case_id===question.id),errors=[];
 const check=(condition,code)=>{if(!condition)errors.push(code);};
 check(attempt?.protocol_version===runtime.protocol_version,'protocol_version');
 check(attempt?.case_id===question.id,'case_id');check(attempt?.phase===phase,'phase');
 check(attempt?.question_sha256===hash(question.question),'question_sha256');
 check(attempt?.freeze_sha256===freeze_sha256,'freeze_sha256');
 check(attempt?.model_digest===runtime.model_digest,'model_digest');
 check(same(attempt?.runtime_identity,{version:runtime.ollama_version,model:runtime.model,digest:runtime.model_digest}),'runtime_identity');
 check(Boolean(budget)&&attempt?.request_sha256===budget.request_sha256,'request_sha256');
 check(Boolean(attempt?.request)&&hash(JSON.stringify(attempt.request))===budget?.request_sha256,'actual_request_sha256');
 check(same(attempt?.budget,budget),'request_budget');
 for(const [key,value]of Object.entries(bindings))check(attempt?.[key]===value,key);
 const binding_valid=errors.length===0;
 check(attempt?.http_request_attempted===true,'request_not_dispatched');
 check(attempt?.transport_terminal_established===true,'durable_terminal_evidence');
 check(attempt?.status==='complete','transport_status');check(attempt?.http_status===200,'http_status');
 let decoded;try{decoded=JSON.parse(attempt?.raw_response_text);}catch{check(false,'raw_transport_json');}
 check(decoded!==null&&typeof decoded==='object'&&!Array.isArray(decoded)&&same(decoded,attempt?.api_response),'raw_transport_agreement');
 check(attempt?.api_response?.model===runtime.model,'response_model');
 check(attempt?.api_response?.done===true,'completion_not_established');
 check(attempt?.api_response?.done_reason!=='length','output_truncated');
 check(!attempt?.api_response?.thinking,'unexpected_thinking');
 check(typeof attempt?.raw_output==='string'&&attempt.raw_output===attempt?.api_response?.response,'raw_output_agreement');
 return {binding_valid,transport_complete:errors.length===0,provenance_valid:errors.length===0,provenance_errors:errors};
}
