import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
export function createWebServer({platformOrigin,financeOrigin,hostDirectory='dist/portal',microDirectories={finance:'dist/finance',sample:'dist/sample'}}){
  return http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/internal')){res.writeHead(404);res.end();return;}
    const upstream=url.pathname.startsWith('/api/platform/')?platformOrigin:url.pathname.startsWith('/api/finance/')?financeOrigin:undefined;
    if(upstream){const target=new URL(req.url,upstream);const forwarded=http.request(target,{method:req.method,headers:{...req.headers,host:req.headers.host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});forwarded.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'服务暂时无法连接'}));});req.pipe(forwarded);return;}
    if(url.pathname.startsWith('/api/')){res.writeHead(404);res.end();return;}
    let directory=path.resolve(hostDirectory),relative=url.pathname;
    for(const [code,root] of Object.entries(microDirectories)){const prefix=`/micro/${code}/`;if(url.pathname.startsWith(prefix)){directory=path.resolve(root);relative=url.pathname.slice(prefix.length);break;}}
    let file=path.resolve(directory,'.'+(relative.startsWith('/')?relative:'/'+relative));
    if(!file.startsWith(directory+path.sep)&&file!==directory){res.writeHead(403);res.end();return;}
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    if(!fs.existsSync(file)){if(!url.pathname.startsWith('/micro/')&&!path.extname(url.pathname))file=path.join(directory,'index.html');else{res.writeHead(404);res.end();return;}}
    if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)]??'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
  });
}
