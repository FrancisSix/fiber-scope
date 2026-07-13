import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT ?? process.argv[2] ?? 4173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const pathname = url.pathname === '/' ? '/public/index.html' : url.pathname;
  const resolved = path.resolve(root, `.${decodeURIComponent(pathname)}`);

  if (!resolved.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': types[path.extname(resolved)] ?? 'application/octet-stream'
    });
    response.end(data);
  });
});

server.listen(port, () => {
  console.log(`FiberScope dashboard: http://127.0.0.1:${port}/`);
});
