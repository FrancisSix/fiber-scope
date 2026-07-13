import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createServer, sanitizeCollectOptions } from '../scripts/serve.js';

test('sanitizes dashboard collector options', () => {
  const accepted = sanitizeCollectOptions({
    rpcUrl: ' http://127.0.0.1:8227 ',
    authToken: ' biscuit ',
    graphLimit: '0',
    graphPages: '99',
    amount: '0x1',
    selfRebalance: true
  });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.rpcUrl, 'http://127.0.0.1:8227');
  assert.equal(accepted.value.authToken, 'biscuit');
  assert.equal(accepted.value.graphLimit, 1);
  assert.equal(accepted.value.graphPages, 50);
  assert.equal(accepted.value.selfRebalance, true);

  const rejected = sanitizeCollectOptions({
    rpcUrl: 'file:///tmp/node.sock'
  });

  assert.equal(rejected.ok, false);
});

test('serves live collection API without echoing auth tokens', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const server = createServer();
  const port = await listen(server);

  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push({
      method: body.method,
      authorization: request.headers.authorization
    });
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: resultFor(body.method)
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    });
  };

  try {
    const response = await postJson(port, '/api/collect', {
      rpcUrl: 'http://fiber.local:8227',
      authToken: 'example-biscuit-token',
      amount: '0x1',
      selfRebalance: true,
      graphPages: 2
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.snapshot.meta.source, 'http://fiber.local:8227');
    assert.equal(response.body.snapshot.rpc.node_info.result.node_name, 'live-test-node');
    assert.equal(JSON.stringify(response.body).includes('example-biscuit-token'), false);
    assert.ok(calls.every((call) => call.authorization === 'Bearer example-biscuit-token'));
    assert.ok(calls.some((call) => call.method === 'send_payment'));
  } finally {
    globalThis.fetch = originalFetch;
    await close(server);
  }
});

test('rejects invalid collector RPC URLs', async () => {
  const server = createServer();
  const port = await listen(server);

  try {
    const response = await postJson(port, '/api/collect', {
      rpcUrl: 'ws://127.0.0.1:8227'
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
  } finally {
    await close(server);
  }
});

test('static server does not expose the collector API', async () => {
  const server = createServer({ apiEnabled: false });
  const port = await listen(server);

  try {
    const response = await postJson(port, '/api/collect', {
      rpcUrl: 'http://127.0.0.1:8227'
    });

    assert.equal(response.status, 405);
    assert.equal(response.body.ok, false);
  } finally {
    await close(server);
  }
});

function resultFor(method) {
  if (method === 'node_info') {
    return {
      version: '0.8.0',
      pubkey: '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      node_name: 'live-test-node',
      peers_count: '0x1',
      channel_count: '0x1'
    };
  }

  if (method === 'list_peers') {
    return {
      peers: [{ pubkey: '03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }]
    };
  }

  if (method === 'list_channels') {
    return {
      channels: [{
        pubkey: '03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        state: 'ChannelReady',
        enabled: true,
        local_balance: '0xee6b2800',
        remote_balance: '0xee6b2800'
      }]
    };
  }

  if (method === 'graph_nodes') {
    return {
      nodes: [{ pubkey: '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
      last_cursor: null
    };
  }

  if (method === 'graph_channels') {
    return {
      channels: [{ channel_outpoint: '0xabc:0' }],
      last_cursor: null
    };
  }

  if (method === 'send_payment') {
    return {
      status: 'dry_run_success',
      fee: '0x0',
      routers: []
    };
  }

  return {};
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function postJson(port, path, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          body: JSON.parse(data)
        });
      });
    });

    request.on('error', reject);
    request.end(body);
  });
}
