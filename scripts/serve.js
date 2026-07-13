import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectSnapshot } from '../src/rpc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const maxBodyBytes = 64 * 1024;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

export function createServer(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? root);
  const apiEnabled = options.apiEnabled !== false;
  const indexPath = options.indexPath ?? '/public/index.html';
  return http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response, { rootDir, apiEnabled, indexPath });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: {
          message: error.message
        }
      });
    }
  });
}

async function handleRequest(request, response, options) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (options.apiEnabled && url.pathname === '/api/health') {
    writeJson(response, 200, {
      ok: true,
      product: 'FiberScope'
    });
    return;
  }

  if (options.apiEnabled && url.pathname === '/api/collect') {
    await handleCollect(request, response);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    writeJson(response, 405, {
      ok: false,
      error: {
        message: 'Method not allowed'
      }
    });
    return;
  }

  const pathname = url.pathname === '/' ? options.indexPath : url.pathname;
  const resolved = path.resolve(options.rootDir, `.${decodeURIComponent(pathname)}`);

  if (!isInside(resolved, options.rootDir)) {
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
    response.end(request.method === 'HEAD' ? null : data);
  });
}

async function handleCollect(request, response) {
  if (request.method !== 'POST') {
    writeJson(response, 405, {
      ok: false,
      error: {
        message: 'Method not allowed'
      }
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch (error) {
    writeJson(response, 400, {
      ok: false,
      error: {
        message: error.message
      }
    });
    return;
  }

  const options = sanitizeCollectOptions(payload);
  if (!options.ok) {
    writeJson(response, 400, {
      ok: false,
      error: {
        message: options.error
      }
    });
    return;
  }

  const snapshot = await collectSnapshot(options.value);
  writeJson(response, 200, {
    ok: true,
    snapshot
  });
}

export function sanitizeCollectOptions(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      error: 'Request body must be a JSON object.'
    };
  }

  const rpcUrl = String(payload.rpcUrl ?? '').trim();
  if (!rpcUrl) {
    return {
      ok: false,
      error: 'Missing rpcUrl.'
    };
  }

  let parsed;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    return {
      ok: false,
      error: 'rpcUrl must be a valid URL.'
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      ok: false,
      error: 'rpcUrl must use http or https.'
    };
  }

  return {
    ok: true,
    value: {
      rpcUrl,
      authToken: cleanOptional(payload.authToken),
      graphLimit: clampInteger(payload.graphLimit, 1, 1000, 200),
      graphPages: clampInteger(payload.graphPages, 1, 50, 5),
      amount: cleanOptional(payload.amount),
      targetPubkey: cleanOptional(payload.targetPubkey),
      selfRebalance: Boolean(payload.selfRebalance),
      maxFeeAmount: cleanOptional(payload.maxFeeAmount)
    }
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBodyBytes) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      resolve(body || '{}');
    });
    request.on('error', reject);
  });
}

function cleanOptional(value) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function isInside(file, rootDir) {
  const relative = path.relative(rootDir, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const staticMode = args.includes('--static');
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const port = Number(process.env.PORT ?? positional[0] ?? 4173);
  const rootDir = staticMode ? path.resolve(positional[1] ?? 'dist') : root;
  const server = createServer({
    rootDir,
    apiEnabled: !staticMode,
    indexPath: staticMode ? '/index.html' : '/public/index.html'
  });

  server.listen(port, '127.0.0.1', () => {
    const mode = staticMode ? 'static preview' : 'dashboard';
    console.log(`FiberScope ${mode}: http://127.0.0.1:${port}/`);
  });
}
