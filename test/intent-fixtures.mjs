// Synthetic CPU transport fixture; never saved as a model result or credited as inference.
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const exp=new URL('../experiments/query-intent-v1/',import.meta.url),sha=x=>createHash('sha256').update(x).digest('hex');
export function fixtureAttempt(caseId='D1',replacementQuery=null){
 const freezeBytes=readFileSync(new URL('freeze.json',exp)),freeze=JSON.parse(freezeBytes),runtime=JSON.parse(readFileSync(new URL('runtime.json',exp))),schema=JSON.parse(readFileSync(new URL('schema.json',exp))),prompt=readFileSync(new URL('prompt.txt',exp),'utf8');
 const phase=caseId.startsWith('D')?'development':'exposed-conformance',question=JSON.parse(readFileSync(new URL(`questions-${phase}.json`,exp))).questions.find(q=>q.id===caseId),label=JSON.parse(readFileSync(new URL('expected-queries.json',exp))).cases.find(q=>q.id===caseId);
 const raw=runtime.raw_prompt_format.replace('{prompt}',prompt).replace('{compact_schema}',JSON.stringify(schema)).replace('{question}',question.question),request={model:runtime.model,prompt:raw,format:schema};for(const key of['raw','stream','think','keep_alive','options'])request[key]=runtime[key];
 const raw_output=JSON.stringify(replacementQuery??label.query),api_response={model:runtime.model,done:true,done_reason:'stop',response:raw_output,prompt_eval_count:1000,eval_count:100};
 const bindings=Object.fromEntries(['source_csv_sha256','source_dictionary_sha256','query_policy_sha256'].map(k=>[k,freeze[k]]));
 const attempt={protocol_version:runtime.protocol_version,case_id:caseId,phase,question_sha256:sha(question.question),freeze_sha256:sha(freezeBytes),model_digest:runtime.model_digest,runtime_identity:{version:runtime.ollama_version,model:runtime.model,digest:runtime.model_digest},request_sha256:sha(JSON.stringify(request)),request,budget:freeze.predeclared_request_budgets.find(x=>x.case_id===caseId),...bindings,http_request_attempted:true,transport_terminal_established:true,http_status:200,status:'complete',api_response,raw_response_text:JSON.stringify(api_response),raw_output,provenance:'SYNTHETIC CPU TRANSPORT FIXTURE: no inference, not a model result'};
 return {attempt,context:{question,phase,freeze,freeze_sha256:sha(freezeBytes),runtime,bindings},query:replacementQuery??label.query,label,bindings};
}
