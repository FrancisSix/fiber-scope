import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { inspectSnapshot } from '../src/core.js';
import { buildSanitizedReplay } from '../src/replay.js';

test('builds a bounded replay without counterparty identifiers', () => {
  const ownPubkey = `02${'aa'.repeat(32)}`;
  const peerPubkey = `03${'bb'.repeat(32)}`;
  const snapshot = {
    meta: {
      source: 'http://public-node.example:8227',
      capturedAt: '2026-07-14T00:00:00.000Z',
      graphLimit: 10,
      graphPages: 1
    },
    rpc: {
      node_info: {
        ok: true,
        result: {
          pubkey: ownPubkey,
          node_name: 'public-node',
          version: '0.9.0-rc7',
          channel_count: '0x1',
          addresses: ['/ip4/127.0.0.1/tcp/8119'],
          default_funding_lock_script: { args: '0xsecret' }
        }
      },
      list_peers: {
        ok: true,
        result: {
          peers: [{ pubkey: peerPubkey, address: '/ip4/10.0.0.1/tcp/8119' }]
        }
      },
      list_channels: {
        ok: true,
        result: {
          channels: [
            channel(peerPubkey, 'ChannelReady', '0xchannel-ready'),
            channel(peerPubkey, 'Closed', '0xchannel-closed')
          ]
        }
      },
      graph_nodes: {
        ok: true,
        result: {
          nodes: [{ pubkey: peerPubkey, addresses: ['/ip4/10.0.0.1/tcp/8119'] }],
          pages: 1,
          truncated: true
        }
      },
      graph_channels: {
        ok: true,
        result: {
          channels: [{ channel_outpoint: '0xgraph', node1: ownPubkey, node2: peerPubkey }],
          pages: 1,
          truncated: true
        }
      }
    }
  };

  const replay = buildSanitizedReplay(snapshot);
  const serialized = JSON.stringify(replay);

  assert.equal(replay.meta.replay.kind, 'real_capture');
  assert.equal(replay.meta.replay.bounded, true);
  assert.equal(replay.meta.replay.observedCounts.listedChannels, 2);
  assert.equal(replay.meta.replay.observedCounts.includedChannels, 1);
  assert.equal(replay.rpc.node_info.result.pubkey, ownPubkey);
  assert.deepEqual(replay.rpc.node_info.result.addresses, []);
  assert.equal(replay.rpc.list_channels.result.channels.length, 1);
  assert.equal(replay.rpc.list_channels.result.channels[0].pending_tlcs.length, 0);
  assert.equal(serialized.includes(peerPubkey), false);
  assert.equal(serialized.includes('/ip4/10.0.0.1'), false);
  assert.equal(serialized.includes('0xchannel-ready'), false);
  assert.equal(serialized.includes('0xchannel-closed'), false);

  const inspection = inspectSnapshot(replay);
  assert.equal(inspection.evidence.kind, 'real_capture');
  assert.equal(inspection.evidence.label, 'Real FNN replay');
  assert.equal(inspection.evidence.sanitized, true);
});

test('keeps the committed real-node replay sanitized and inspectable', () => {
  const replay = JSON.parse(fs.readFileSync(new URL(
    '../fixtures/real-public-node-replay.json',
    import.meta.url
  ), 'utf8'));
  const peers = replay.rpc.list_peers.result.peers;
  const channels = replay.rpc.list_channels.result.channels;
  const graphNodes = replay.rpc.graph_nodes.result.nodes;
  const inspection = inspectSnapshot(replay);

  assert.equal(replay.meta.replay.kind, 'real_capture');
  assert.equal(replay.meta.replay.sanitized, true);
  assert.equal(replay.meta.replay.bounded, true);
  assert.match(replay.meta.replay.fnnVersion, /^0\.9\./);
  assert.ok(peers.length > 0);
  assert.ok(channels.length > 0);
  assert.ok(graphNodes.length > 0);
  assert.ok(peers.every((peer) => peer.address === '[redacted]'));
  assert.ok(graphNodes.every((node) => node.addresses.length === 0));
  assert.ok(channels.every((item) => item.state.state_name !== 'Closed'));
  assert.ok(channels.every((item) => item.pending_tlcs.length === 0));
  assert.equal(inspection.evidence.kind, 'real_capture');
  assert.equal(inspection.metrics.graphNodeCount, replay.meta.replay.observedCounts.graphNodes);
  assert.equal(inspection.metrics.graphChannelCount, replay.meta.replay.observedCounts.graphChannels);
});

function channel(pubkey, stateName, channelId) {
  return {
    channel_id: channelId,
    channel_outpoint: `${channelId}:0`,
    pubkey,
    state: { state_name: stateName },
    pending_tlcs: [{ payment_hash: '0xpayment' }],
    latest_commitment_transaction_hash: '0xcommitment',
    shutdown_transaction_hash: null
  };
}
