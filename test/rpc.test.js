import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectSnapshot } from '../src/rpc.js';

test('collects paginated graph nodes and channels', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push({ method: body.method, params: body.params });
    const result = resultFor(body.method, body.params?.[0] ?? {});
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const snapshot = await collectSnapshot({
      rpcUrl: 'http://fiber.local',
      graphLimit: 2,
      graphPages: 3
    });

    assert.equal(snapshot.meta.graphLimit, 2);
    assert.equal(snapshot.meta.graphPages, 3);
    assert.equal(snapshot.rpc.graph_nodes.result.nodes.length, 3);
    assert.equal(snapshot.rpc.graph_nodes.result.pages, 2);
    assert.equal(snapshot.rpc.graph_nodes.result.truncated, false);
    assert.equal(snapshot.rpc.graph_channels.result.channels.length, 3);
    assert.equal(snapshot.rpc.graph_channels.result.pages, 2);

    const graphNodeCalls = calls.filter((call) => call.method === 'graph_nodes');
    const graphChannelCalls = calls.filter((call) => call.method === 'graph_channels');
    assert.deepEqual(graphNodeCalls.map((call) => call.params[0]), [
      { limit: '0x2' },
      { limit: '0x2', after: 'node-cursor-2' }
    ]);
    assert.deepEqual(graphChannelCalls.map((call) => call.params[0]), [
      { limit: '0x2' },
      { limit: '0x2', after: 'channel-cursor-2' }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('marks graph pagination as truncated when max pages are reached', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    const result = body.method === 'graph_nodes'
      ? {
          nodes: [{ pubkey: `node-${body.params?.[0]?.after ?? 'first'}` }],
          last_cursor: `next-${body.id}`
        }
      : resultFor(body.method, body.params?.[0] ?? {});

    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const snapshot = await collectSnapshot({
      rpcUrl: 'http://fiber.local',
      graphLimit: 1,
      graphPages: 2
    });

    assert.equal(snapshot.rpc.graph_nodes.result.nodes.length, 2);
    assert.equal(snapshot.rpc.graph_nodes.result.pages, 2);
    assert.equal(snapshot.rpc.graph_nodes.result.truncated, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function resultFor(method, params) {
  if (method === 'node_info') {
    return {
      version: '0.8.0',
      pubkey: '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      node_name: 'test-node',
      peers_count: '0x1',
      channel_count: '0x1',
      pending_channel_count: '0x0'
    };
  }

  if (method === 'list_peers') {
    return { peers: [{ pubkey: '03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] };
  }

  if (method === 'list_channels') {
    return { channels: [] };
  }

  if (method === 'graph_nodes') {
    if (!params.after) {
      return {
        nodes: [{ pubkey: 'node-1' }, { pubkey: 'node-2' }],
        last_cursor: 'node-cursor-2'
      };
    }
    return {
      nodes: [{ pubkey: 'node-3' }],
      last_cursor: 'node-cursor-3'
    };
  }

  if (method === 'graph_channels') {
    if (!params.after) {
      return {
        channels: [{ channel_outpoint: 'channel-1' }, { channel_outpoint: 'channel-2' }],
        last_cursor: 'channel-cursor-2'
      };
    }
    return {
      channels: [{ channel_outpoint: 'channel-3' }],
      last_cursor: 'channel-cursor-3'
    };
  }

  return {};
}
