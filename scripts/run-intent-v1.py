"""Bounded optional inference, never used by the UI server. Explicit handover required.
Uses the existing shared advisory lock/timeout barrier, with no retries or generated code.
"""
import argparse,fcntl,hashlib,importlib.util,json,os,socket,stat,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'experiments/query-intent-v1';HELD=[]
spec=importlib.util.spec_from_file_location('intent_payload',ROOT/'scripts/intent-payload.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
sha=lambda b:hashlib.sha256(b).hexdigest()
def read_api(path,body=None):
    req=urllib.request.Request('http://127.0.0.1:11434'+path,data=json.dumps(body).encode()if body else None,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=15)as r:return json.load(r)
def verify_identity(runtime):
    if read_api('/api/version')['version']!=runtime['ollama_version']:raise RuntimeError('runtime_version_mismatch')
    model=next((m for m in read_api('/api/tags')['models']if m['name']==runtime['model']),None)
    if model is None or model['digest']!=runtime['model_digest']:raise RuntimeError('model_digest_mismatch')
    return {'version':runtime['ollama_version'],'model':model['name'],'digest':model['digest']}
def verify_freeze():
    raw=(E/'freeze.json').read_bytes();freeze=json.loads(raw)
    for name,digest in freeze['method_file_sha256'].items():
        if sha((ROOT/name).read_bytes())!=digest:raise RuntimeError('frozen_method_changed:'+name)
    for entry in freeze['protected_cpu_baseline_files']:
        if sha((ROOT/entry['path']).read_bytes())!=entry['sha256']:raise RuntimeError('protected_cpu_baseline_changed:'+entry['path'])
    if not freeze['frozen_before_inference']:raise RuntimeError('protocol_not_frozen')
    return freeze,sha(raw)
def save(path,record):
    with path.open('x')as f:json.dump(record,f,indent=2,ensure_ascii=False);f.write('\n');f.flush();os.fsync(f.fileno())
def bounded_request(req,runtime,record,barrier,opener=None):
    """One dispatch; every unverified exit retains the shared barrier.

    A fully read HTTP rejection is terminal; a partially read rejection is not.
    finally covers interruption and exceptions inside HTTPError handling too.
    """
    opener=opener or urllib.request.urlopen
    terminal=False
    record['http_request_attempted']=True
    try:
        try:
            response=opener(req,timeout=runtime['timeout_seconds'])
        except urllib.error.HTTPError as error:
            record.update(http_status=error.code,http_rejection=True)
            with error:
                raw=error.read(runtime['response_byte_limit']+1)
            record['raw_response_text']=raw[:runtime['response_byte_limit']].decode('utf-8',errors='replace')
            if len(raw)>runtime['response_byte_limit']:raise RuntimeError('http_error_response_limit_completion_unverified')
            record.update(status='http_rejected',failure='HTTP response rejected frozen request')
            terminal=True
            return None
        with response:
            record['http_status']=response.status
            raw=response.read(runtime['response_byte_limit']+1)
        record['raw_response_text']=raw[:runtime['response_byte_limit']].decode('utf-8',errors='replace')
        if len(raw)>runtime['response_byte_limit']:raise RuntimeError('response_limit_completion_unverified')
        api=json.loads(raw)
        record['api_response']=api
        record['raw_output']=api.get('response')if isinstance(api,dict)else None
        if not isinstance(api,dict):raise RuntimeError('invalid_transport_shape')
        if api.get('done')is not True:raise RuntimeError('model_completion_unverified')
        terminal=True
        return api
    except BaseException as error:
        record['transport_error']={'type':type(error).__name__,'message':str(error)}
        partial=getattr(error,'partial',None)
        if isinstance(partial,bytes):record['partial_response_text']=partial[:runtime['response_byte_limit']].decode('utf-8',errors='replace')
        raise
    finally:
        record['transport_terminal_established']=terminal
        if not terminal:barrier('post_dispatch_completion_unverified')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--lease-authorized',action='store_true');parser.add_argument('--phase',choices=['development','exposed-conformance'],required=True);args=parser.parse_args()
    if not args.lease_authorized:raise RuntimeError('explicit_gpu_handover_required')
    freeze,freeze_sha=verify_freeze();runtime=json.loads((E/'runtime.json').read_text());identity=verify_identity(runtime)
    if args.phase=='exposed-conformance':
        report=json.loads((ROOT/'model-runs/query-intent-v1/development-report.json').read_text())
        if report.get('freeze_sha256')!=freeze_sha or report.get('development_gate_passed')is not True:raise RuntimeError('development_protocol_gate_not_passed')
    questions=json.loads((E/f'questions-{args.phase}.json').read_text())['questions'];expected_ids=runtime['development_case_ids']if args.phase=='development'else runtime['exposed_conformance_case_ids']
    if [q['id']for q in questions]!=expected_ids:raise RuntimeError('declared_case_set_mismatch')
    destination=ROOT/'model-runs/query-intent-v1'/args.phase;destination.mkdir(parents=True,exist_ok=False)
    lock=Path(os.environ.get('AX_LAB_INFERENCE_LOCK',str(Path.home()/'.cache/ax-lab/runtime/inference.lock')))
    if not lock.is_absolute():raise RuntimeError('invalid_lock_path')
    blocked=Path(str(lock)+'.blocked');parent_fd=os.open(lock.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);lease=None;stop=None
    def barrier(reason):
        try:
            fd=os.open(blocked.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent_fd)
            try:os.write(fd,('P12 completion unverified: '+reason+'; independent recovery required.\n').encode());os.fsync(fd)
            finally:os.close(fd)
            os.fsync(parent_fd)
        except FileExistsError:pass
        except OSError:HELD.append(lease)
    try:
        meta=os.fstat(parent_fd)
        if meta.st_uid!=os.geteuid()or stat.S_IMODE(meta.st_mode)&0o077:raise RuntimeError('unsafe_inference_lock_directory')
        fd=os.open(lock.name,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=parent_fd);meta=os.fstat(fd)
        if not stat.S_ISREG(meta.st_mode)or meta.st_uid!=os.geteuid()or stat.S_IMODE(meta.st_mode)&0o077:os.close(fd);raise RuntimeError('unsafe_inference_lock_file')
        lease=os.fdopen(fd,'a');fcntl.flock(lease.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        if os.path.lexists(blocked):raise RuntimeError('inference_blocked_after_timeout')
        for question in questions:
            payload,budget=module.payload_for(question);declared=next(x for x in freeze['predeclared_request_budgets']if x['case_id']==question['id'])
            if budget!=declared:raise RuntimeError('frozen_request_changed')
            record={'protocol_version':runtime['protocol_version'],'phase':args.phase,'case_id':question['id'],'question_sha256':budget['question_sha256'],'freeze_sha256':freeze_sha,'source_csv_sha256':freeze['source_csv_sha256'],'source_dictionary_sha256':freeze['source_dictionary_sha256'],'query_policy_sha256':freeze['query_policy_sha256'],'model_digest':runtime['model_digest'],'runtime_identity':identity,'request_sha256':budget['request_sha256'],'budget':budget,'request':payload,'http_request_attempted':False,'http_status':None,'status':'not_attempted','raw_response_text':None,'raw_output':None,'api_response':None,'retry_calls':0,'demo_calls':0}
            if stop:record['failure']=stop;save(destination/(question['id']+'.json'),record);continue
            started=time.monotonic()
            try:
                identity=verify_identity(runtime);req=urllib.request.Request('http://127.0.0.1:11434'+runtime['endpoint'],data=json.dumps(payload,ensure_ascii=False).encode(),headers={'Content-Type':'application/json'})
                api=bounded_request(req,runtime,record,barrier)
                if api is None:stop='HTTP rejection; no retries or further requests in this batch'
                else:
                    record['status']='complete'if api.get('done_reason')!='length'else'incomplete_output'
                    if api.get('thinking'):record['status']='unexpected_thinking';record['failure']='Nonthinking contract breached; no authority or semantic success credited.'
                    if api.get('prompt_eval_count',budget['input_token_upper_bound']+1)>budget['input_token_upper_bound']:record['status']='input_budget_contract_failed';stop='input_budget_contract_failed'
            except (TimeoutError,socket.timeout,urllib.error.URLError)as e:
                timed=isinstance(e,(TimeoutError,socket.timeout))or isinstance(getattr(e,'reason',None),(TimeoutError,socket.timeout));record.update(status='timeout'if timed else'transport_failed',failure=str(e));stop='Transport failure; independent completion verification required'
            except KeyboardInterrupt as e:record.update(status='interrupted',failure='Interrupted request; completion unverified');stop='Interrupted request; independent completion verification required'
            except Exception as e:record.update(status='failed',failure=str(e));stop=str(e)
            record['elapsed_ms']=round((time.monotonic()-started)*1000,2);save(destination/(question['id']+'.json'),record);print(json.dumps({'case_id':question['id'],'status':record['status'],'http_status':record['http_status']}),flush=True)
    finally:
        if lease is not None and lease not in HELD:lease.close()
        os.close(parent_fd)
if __name__=='__main__':
    try:main()
    finally:
        while HELD:time.sleep(30)
