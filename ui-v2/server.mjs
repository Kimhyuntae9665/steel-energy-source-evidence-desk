// Versioned presentation overlay; the original server, admission and query authority remain unchanged.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createDesk} from '../server.mjs';

export async function createRefitDesk(options={}) {
  const server=await createDesk(options), original=server.listeners('request')[0];
  server.removeListener('request',original);
  server.on('request',(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&['/','/style.css'].includes(pathname)) {
      const file=pathname==='/'?'index.html':'style.css';
      res.writeHead(200,{'Content-Type':(pathname==='/'?'text/html':'text/css')+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'"});
      res.end(readFileSync(new URL(file,import.meta.url)));
    } else original(req,res);
  });
  return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))
  (await createRefitDesk()).listen(Number(process.env.P12_PORT??5162),'127.0.0.1',()=>console.log('P12 CPU UI v2 ready'));
