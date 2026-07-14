import { createHash } from 'node:crypto';

export function buildSanitizedReplay(snapshot, options = {}) {
  const source = snapshot?.meta?.source ?? options.rpcUrl ?? 'unknown';
  const rpc = structuredClone(snapshot?.rpc ?? {});
  const nodeInfo = rpc.node_info?.result ?? {};
  const ownPubkey = nodeInfo.pubkey ?? null;
  const aliasPubkey = createPubkeyAlias(ownPubkey);

  const peers = rpc.list_peers?.result?.peers ?? [];
  const allChannels = rpc.list_channels?.result?.channels ?? [];
  const replayChannels = allChannels.filter((channel) => channelState(channel) !== 'Closed');
  const graphNodes = rpc.graph_nodes?.result?.nodes ?? [];
  const graphChannels = rpc.graph_channels?.result?.channels ?? [];

  if (rpc.node_info?.result) {
    rpc.node_info.result.addresses = [];
    delete rpc.node_info.result.default_funding_lock_script;
  }

  if (rpc.list_peers?.result) {
    rpc.list_peers.result.peers = peers.map((peer) => ({
      ...peer,
      pubkey: aliasPubkey(peer.pubkey),
      address: '[redacted]'
    }));
  }

  if (rpc.list_channels?.result) {
    rpc.list_channels.result.channels = replayChannels.map((channel) => sanitizeChannel(channel, aliasPubkey));
    rpc.list_channels.result.replay_summary = {
      listed_channels: allChannels.length,
      included_non_closed_channels: replayChannels.length,
      excluded_closed_channels: allChannels.length - replayChannels.length
    };
  }

  if (rpc.graph_nodes?.result) {
    rpc.graph_nodes.result.nodes = graphNodes.map((node) => ({
      ...node,
      pubkey: aliasPubkey(node.pubkey),
      addresses: []
    }));
  }

  if (rpc.graph_channels?.result) {
    rpc.graph_channels.result.channels = graphChannels.map((channel) => ({
      ...channel,
      channel_outpoint: aliasHex('graph-outpoint', channel.channel_outpoint),
      node1: aliasPubkey(channel.node1),
      node2: aliasPubkey(channel.node2)
    }));
  }

  return {
    meta: {
      ...snapshot.meta,
      network: options.network ?? snapshot?.meta?.network ?? 'testnet',
      source: options.sourceLabel ?? 'replay:fiber-docs-public-node-2',
      title: 'Sanitized real FNN public-node capture',
      description: 'Bounded replay captured from the Fiber documentation public testnet node.',
      replay: {
        kind: 'real_capture',
        sanitized: true,
        bounded: Boolean(
          rpc.graph_nodes?.result?.truncated || rpc.graph_channels?.result?.truncated
        ),
        sourceEndpoint: source,
        sourceDocument: 'nervos/fiber/docs/public-nodes.md',
        nodeLabel: nodeInfo.node_name ?? 'documented public Fiber node',
        fnnVersion: nodeInfo.version ?? 'unknown',
        fnnCommit: nodeInfo.commit_hash ?? null,
        observedCounts: {
          connectedPeers: peers.length,
          nodeReportedChannels: parseRpcInteger(nodeInfo.channel_count),
          listedChannels: allChannels.length,
          includedChannels: replayChannels.length,
          excludedClosedChannels: allChannels.length - replayChannels.length,
          graphNodes: graphNodes.length,
          graphChannels: graphChannels.length
        },
        pagination: {
          graphNodes: paginationSummary(rpc.graph_nodes?.result, snapshot?.meta?.graphLimit),
          graphChannels: paginationSummary(rpc.graph_channels?.result, snapshot?.meta?.graphLimit)
        },
        redactions: [
          'peer and graph addresses',
          'counterparty pubkeys',
          'channel and transaction identifiers',
          'closed channel records',
          'pending TLC details'
        ]
      }
    },
    intent: {
      amount: null,
      targetPubkey: null,
      selfRebalance: false
    },
    rpc
  };
}

function sanitizeChannel(channel, aliasPubkey) {
  return {
    ...channel,
    channel_id: aliasHex('channel-id', channel.channel_id),
    channel_outpoint: aliasHex('channel-outpoint', channel.channel_outpoint),
    pubkey: aliasPubkey(channel.pubkey),
    pending_tlcs: [],
    latest_commitment_transaction_hash: aliasOptionalHex(
      'commitment-transaction',
      channel.latest_commitment_transaction_hash
    ),
    shutdown_transaction_hash: aliasOptionalHex(
      'shutdown-transaction',
      channel.shutdown_transaction_hash
    )
  };
}

function createPubkeyAlias(ownPubkey) {
  const aliases = new Map();
  return (pubkey) => {
    if (!pubkey || pubkey === ownPubkey) return pubkey;
    if (!aliases.has(pubkey)) {
      aliases.set(pubkey, `02${digest(`pubkey:${pubkey}`).slice(0, 64)}`);
    }
    return aliases.get(pubkey);
  };
}

function aliasOptionalHex(namespace, value) {
  return value ? aliasHex(namespace, value) : value;
}

function aliasHex(namespace, value) {
  if (!value) return value;
  return `0x${digest(`${namespace}:${value}`)}`;
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function channelState(channel) {
  return channel?.state?.state_name ?? channel?.state?.stateName ?? channel?.state ?? 'unknown';
}

function paginationSummary(result = {}, fallbackLimit = null) {
  return {
    pages: Number(result.pages ?? 0),
    limit: Number(fallbackLimit ?? 0),
    included: Array.isArray(result.nodes)
      ? result.nodes.length
      : Array.isArray(result.channels)
        ? result.channels.length
        : 0,
    truncated: Boolean(result.truncated)
  };
}

function parseRpcInteger(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value, value.startsWith('0x') ? 16 : 10);
  return Number.isFinite(parsed) ? parsed : null;
}
