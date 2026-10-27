import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
export function createStaticServer(hostRoot,microRoots={}) {
  return http.createServer((req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname);
      const micro=Object.entries(microRoots).find(([prefix])=>pathname.startsWith(prefix));
      const base=path.resolve(micro?micro[1]:hostRoot);
      let relative=micro?pathname.slice(micro[0].length):pathname.slice(1);
      if(!relative||relative.endsWith('/'))relative+='index.html';
      let filename=path.resolve(base,relative);
      if(!filename.startsWith(base+path.sep)){res.writeHead(403).end();return;}
      if(!fs.existsSync(filename)&&!micro&&!path.extname(relative))filename=path.join(base,'index.html');
      if(!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404).end();return;}
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
      res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'});
      fs.createReadStream(filename).pipe(res);
    }catch{res.writeHead(400).end();}
  });
}
