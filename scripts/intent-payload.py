"""Frozen, pure CPU request construction; no transport or oracle import."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];EXPERIMENT=ROOT/'experiments/query-intent-v1'
def payload_for(question):
    if not isinstance(question,dict)or set(question)!={'id','question'}or not isinstance(question['question'],str):raise ValueError('Only an ID and the declared question text may enter request construction')
    runtime=json.loads((EXPERIMENT/'runtime.json').read_text());schema=json.loads((EXPERIMENT/'schema.json').read_text());prompt=(EXPERIMENT/'prompt.txt').read_text();compact=json.dumps(schema,separators=(',',':'),ensure_ascii=False)
    raw=runtime['raw_prompt_format'].format(prompt=prompt,compact_schema=compact,question=question['question'])
    upper=len(raw.encode('utf-8'))+1;headroom=runtime['options']['num_ctx']-upper-runtime['options']['num_predict']-runtime['extra_safety_tokens']
    if headroom<0:raise ValueError('Conservative raw input budget exceeds frozen context; no truncation permitted')
    payload={k:runtime[k]for k in ['model']};payload['prompt']=raw;payload['format']=schema
    for key in ['raw','stream','think','keep_alive','options']:payload[key]=runtime[key]
    digest=hashlib.sha256(json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    return payload,{'case_id':question['id'],'question_sha256':hashlib.sha256(question['question'].encode()).hexdigest(),'request_sha256':digest,'raw_prompt_utf8_bytes':upper-1,'input_token_upper_bound':upper,'output_reserved_tokens':runtime['options']['num_predict'],'extra_safety_tokens':runtime['extra_safety_tokens'],'conservative_context_headroom':headroom,'actual_tokenization_measured':False}
