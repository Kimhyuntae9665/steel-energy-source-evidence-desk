import {createServer} from 'node:http';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {loadDataset,auditDataset,SOURCE_CSV_SHA256} from './core.mjs';
import {executeQuery,QUERY_POLICY_SHA256} from './policy.mjs';
import {parseStrictJSON} from './strict-json.mjs';
const root=new URL('.',import.meta.url),csv=new URL('data/Steel_industry_data.csv',root);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function createDesk({sourcePath=csv}={}){
  const dataset=await loadDataset({path:sourcePath}),audit=auditDataset(dataset),admission=JSON.parse(readFileSync(new URL('data/admission.json',root),'utf8')),dictionaryPath=new URL('data/source-dictionary.json',root),dictionarySha=hash(readFileSync(dictionaryPath));
  const queries=new Map(),rowsById=new Map(dataset.rows.map(r=>[r.row_id,r]));
  const stable=()=>{if(hash(readFileSync(sourcePath))!==SOURCE_CSV_SHA256||hash(readFileSync(dictionaryPath))!==dictionarySha||hash(readFileSync(new URL('query-policy.json',root)))!==QUERY_POLICY_SHA256)throw Object.assign(Error('Admitted source, dictionary or query policy changed. Re-admission is required; cached evidence is unavailable.'),{code:'SOURCE_HASH_MISMATCH'});};
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  return createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/'))stable();
    if(req.method==='GET'&&url.pathname==='/api/admission')return send(res,200,{admission,audit,source_dictionary_sha256:dictionarySha,query_policy_sha256:QUERY_POLICY_SHA256,source_label_interpretation:'Verbatim source calendar labels; no timezone or physical interval assignment.',model_calls:0});
    if(req.method==='GET'&&url.pathname==='/api/rows'){
      const result=queries.get(url.searchParams.get('query_fingerprint'));if(!result)return send(res,409,{error:'STALE_QUERY',message:'Run the confirmed filter again before inspecting rows.'});
      const label=url.searchParams.get('date_label'),offsetText=url.searchParams.get('offset')??'0';if(!/^\d{1,6}$/.test(offsetText))throw Object.assign(Error('Invalid row offset'),{code:'INVALID_FILTER'});
      if(label&&!result.selected_date_labels.includes(label))throw Object.assign(Error('Date label is not in this executed query'),{code:'INVALID_FILTER'});
      const selected=(result.selected_row_ids??[]).map(id=>rowsById.get(id)).filter(r=>!label||r.date_label===label),offset=Number(offsetText);
      return send(res,200,{query_fingerprint:result.query_fingerprint,source_csv_sha256:dataset.source_csv_sha256,date_label:label,offset,page_size:96,total_rows:selected.length,rows:selected.slice(offset,offset+96).map(r=>({row_id:r.row_id,source_fields:r.source_fields,raw_csv:r.raw_csv,source_span:r.source_span,field_spans:r.field_spans,field_lexemes:r.field_lexemes,date_status:r.date.status,usage_status:r.usage_status}))});
    }
    if(req.method==='POST'&&['/api/query','/api/receipt'].includes(url.pathname)){
      let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>4096)throw Error('Request exceeds 4096-byte bound');chunks.push(c);}
      const body=parseStrictJSON(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      const allowed=url.pathname==='/api/query'?['query','interpretation_confirmed']:['query','interpretation_confirmed','source_csv_sha256','query_fingerprint'];
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(body,k)))throw Object.assign(Error('Request has missing or unsupported fields'),{code:'INVALID_REQUEST_SHAPE'});
      if(!body||body.interpretation_confirmed!==true)throw Object.assign(Error('Confirm verbatim source-label interpretation before execution.'),{code:'INTERPRETATION_REQUIRED'});
      const raw=executeQuery(dataset,body.query,{dictionary_sha256:dictionarySha}),selected=(raw.selected_row_ids??[]).map(id=>rowsById.get(id));
      const result={...raw,source_csv_sha256:dataset.source_csv_sha256,selected_date_labels:[...new Set(selected.map(r=>r.date_label))].sort(),row_count:raw.receipt.selected_row_count??null,usage_kwh:raw.answer.usage_kwh_exact??null,query_fingerprint:raw.receipt.query_fingerprint};
      if(url.pathname==='/api/receipt'){
        if(body.source_csv_sha256!==dataset.source_csv_sha256||body.query_fingerprint!==result.query_fingerprint)return send(res,409,{error:'STALE_RECEIPT_BINDING',message:'Displayed source/filter/row scope does not match this request. Inspect again.'});
        return send(res,200,{receipt:result.receipt,acknowledgment:{source_label_interpretation_confirmed:true,export_state:'prepared_and_acknowledged',download_completion:'not_established',target_action:'none',model_calls:0}});
      }
      queries.set(result.query_fingerprint,result);if(queries.size>12)queries.delete(queries.keys().next().value);return send(res,200,result);
    }
    const files={'/':['index.html','text/html'],'/app.mjs':['app.mjs','text/javascript'],'/style.css':['style.css','text/css']};
    if(req.method!=='GET'||!files[url.pathname])return send(res,404,{error:'NOT_FOUND'});
    const [file,type]=files[url.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'"});res.end(readFileSync(new URL(file,root)));
  }catch(e){send(res,e.code==='SOURCE_HASH_MISMATCH'?409:400,{error:e.code??'INVALID_REQUEST',message:e.message});}});
}
if(process.argv[1]===fileURLToPath(import.meta.url))(await createDesk()).listen(Number(process.env.P12_PORT??5120),'127.0.0.1',()=>console.log('P12 CPU energy evidence desk ready'));
