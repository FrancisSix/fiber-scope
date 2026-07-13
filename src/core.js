export const DOC_REFS = {
  channelRebalancing: 'nervos/fiber/docs/channel-rebalancing.md',
  rpc: 'nervos/fiber/crates/fiber-lib/src/rpc/README.md',
  gossip: 'nervos/fiber/docs/notes/gossip.md',
  auth: 'nervos/fiber/docs/biscuit-auth.md',
  publicNodes: 'nervos/fiber/docs/public-nodes.md',
  migration: 'nervos/fiber/docs/notes/v0.8.0-migration-guide.md'
};

const REQUIRED_METHODS = [
  ['node_info', 'read("node")'],
  ['list_peers', 'read("peers")'],
  ['list_channels', 'read("channels")'],
  ['graph_nodes', 'read("graph")'],
  ['graph_channels', 'read("graph")'],
  ['build_router', 'read("payments")'],
  ['send_payment_dry_run', 'write("payments") for dry-run send_payment']
];

const PENDING_STATES = new Set([
  'NegotiatingFunding',
  'CollaboratingFundingTx',
  'SigningCommitment',
  'AwaitingTxSignatures',
  'AwaitingChannelReady'
]);

export function inspectSnapshot(snapshot, options = {}) {
  const rpc = snapshot?.rpc ?? {};
  const nodeEntry = rpcEntry(rpc, 'node_info');
  const peersEntry = rpcEntry(rpc, 'list_peers');
  const channelsEntry = rpcEntry(rpc, 'list_channels');
  const graphNodesEntry = rpcEntry(rpc, 'graph_nodes');
  const graphChannelsEntry = rpcEntry(rpc, 'graph_channels');
  const dryRunEntry = firstPresent(rpc, [
    'send_payment_dry_run',
    'route_dry_run',
    'dry_run',
    'build_router_dry_run',
    'build_router'
  ]);

  const nodeInfo = responseResult(nodeEntry) ?? {};
  const peers = resultList(peersEntry, 'peers');
  const channels = resultList(channelsEntry, 'channels');
  const graphNodes = resultList(graphNodesEntry, 'nodes');
  const graphChannels = resultList(graphChannelsEntry, 'channels');
  const requestedAmount = parseOptionalAmount(
    options.amount ?? snapshot?.intent?.amount ?? snapshot?.meta?.requestedAmount
  );

  const findings = [];
  const addFinding = (finding) => {
    if (!findings.some((item) => item.id === finding.id)) {
      findings.push({
        docs: [],
        ...finding,
        fingerprint: finding.id
      });
    }
  };

  const authErrors = collectAuthErrors(rpc);
  if (authErrors.length > 0) {
    addFinding({
      severity: 'critical',
      id: 'FS-AUTH-SCOPE-001',
      title: 'RPC token is missing diagnostic read scope',
      evidence: authErrors.map((item) => `${item.method}: ${item.message}`).join('; '),
      impact: 'The dashboard cannot separate connectivity, graph, and liquidity failures when RPC calls are rejected by Biscuit authorization.',
      recommendation: 'Issue a diagnostic Biscuit token with read("node"), read("peers"), read("channels"), read("graph"), and read("payments"). Add write("payments") only when running send_payment dry runs.',
      docs: [DOC_REFS.auth]
    });
  }

  if (isError(nodeEntry) || !hasResult(nodeEntry)) {
    addFinding({
      severity: 'critical',
      id: 'FS-NODE-RPC-001',
      title: 'node_info is unavailable',
      evidence: responseErrorMessage(nodeEntry) || 'No node_info response was captured.',
      impact: 'The tool cannot confirm node identity, chain hash, feature bits, or the pubkey needed for self-payment rebalance checks.',
      recommendation: 'Check the FNN RPC URL, process health, and token scope, then collect node_info again.',
      docs: [DOC_REFS.rpc]
    });
  }

  const migrationMessage = allErrorMessages(rpc).find((message) => /\bpeer_id\b/i.test(message));
  if (migrationMessage || versionBefore(nodeInfo.version, '0.8.0')) {
    addFinding({
      severity: 'warning',
      id: 'FS-MIGRATION-PUBKEY-001',
      title: 'Snapshot looks incompatible with Fiber v0.8 pubkey RPCs',
      evidence: migrationMessage || `node version: ${nodeInfo.version ?? 'unknown'}`,
      impact: 'Fiber v0.8 replaced peer_id parameters with pubkey parameters across channel and peer RPCs.',
      recommendation: 'Use pubkey based RPC parameters and let connect_peer resolve addresses from gossip when possible.',
      docs: [DOC_REFS.migration, DOC_REFS.publicNodes]
    });
  }

  const peerCount = countFromNodeInfo(nodeInfo.peers_count, peers.length);
  if (peerCount === 0 && !isError(peersEntry)) {
    addFinding({
      severity: 'critical',
      id: 'FS-PEER-NONE-001',
      title: 'Node has no connected Fiber peers',
      evidence: `peers_count=${displayCount(nodeInfo.peers_count, peers.length)}, list_peers=${peers.length}`,
      impact: 'Routing, gossip catch-up, and channel operations cannot progress without peer connectivity.',
      recommendation: 'Connect to known public nodes with connect_peer, then wait for gossip to catch up before retrying route dry runs.',
      docs: [DOC_REFS.publicNodes, DOC_REFS.gossip]
    });
  }

  const channelViews = channels.map(normalizeChannel);
  const activeChannels = channelViews.filter((channel) => channel.ready && channel.enabled);
  const pendingChannels = channelViews.filter((channel) => PENDING_STATES.has(channel.stateName));
  const disabledChannels = channelViews.filter((channel) => channel.ready && !channel.enabled);
  const staleChannels = channelViews.filter((channel) => channel.stateName === 'Stale');
  const failedChannels = channelViews.filter((channel) => channel.failureDetail);

  if (channels.length === 0 && !isError(channelsEntry)) {
    addFinding({
      severity: 'critical',
      id: 'FS-CHANNEL-NONE-001',
      title: 'Node has no payment channels',
      evidence: `channel_count=${displayCount(nodeInfo.channel_count, channels.length)}, list_channels=0`,
      impact: 'The node can discover the graph, but it cannot send or receive Fiber payments without at least one funded channel.',
      recommendation: 'Open a public channel to a public node and verify it reaches ChannelReady before attempting payments.',
      docs: [DOC_REFS.publicNodes, DOC_REFS.rpc]
    });
  }

  if (pendingChannels.length > 0) {
    addFinding({
      severity: 'warning',
      id: 'FS-CHANNEL-PENDING-001',
      title: 'Some channels are still opening',
      evidence: summarizeChannels(pendingChannels),
      impact: 'Pending channels will not provide stable routing capacity until their funding flow completes.',
      recommendation: 'Wait for ChannelReady, or inspect failed pending channels with include_closed and only_pending.',
      docs: [DOC_REFS.rpc]
    });
  }

  if (disabledChannels.length > 0) {
    addFinding({
      severity: 'warning',
      id: 'FS-CHANNEL-DISABLED-001',
      title: 'Ready channels are disabled',
      evidence: summarizeChannels(disabledChannels),
      impact: 'Disabled channels remain in the node state but are not usable for forwarding or payment attempts.',
      recommendation: 'Use update_channel to enable channels that should participate in routing.',
      docs: [DOC_REFS.rpc]
    });
  }

  if (staleChannels.length > 0) {
    addFinding({
      severity: 'warning',
      id: 'FS-CHANNEL-STALE-001',
      title: 'Channels need passive audit after restore',
      evidence: summarizeChannels(staleChannels),
      impact: 'Stale channel state can block safe payment operations until the peer audit completes.',
      recommendation: 'Reconnect affected peers and allow Fiber to audit channel state before sending payments.',
      docs: [DOC_REFS.rpc]
    });
  }

  if (failedChannels.length > 0) {
    addFinding({
      severity: 'warning',
      id: 'FS-CHANNEL-FAILED-001',
      title: 'Channel opening failures are present',
      evidence: failedChannels.map((channel) => `${shortPubkey(channel.pubkey)}: ${channel.failureDetail}`).join('; '),
      impact: 'Failed openings can hide funding, parameter, or peer policy issues that will repeat on the next attempt.',
      recommendation: 'Fix the failure_detail cause before retrying the same peer or funding amount.',
      docs: [DOC_REFS.rpc]
    });
  }

  const lowOutbound = activeChannels.filter((channel) => {
    if (channel.total === 0n) return false;
    return channel.localRatio < 0.15 || (requestedAmount !== null && channel.local < requestedAmount);
  });
  if (lowOutbound.length > 0) {
    addFinding({
      severity: 'warning',
      id: 'FS-LIQUIDITY-OUTBOUND-LOW-001',
      title: 'Outbound liquidity is thin on ready channels',
      evidence: summarizeLiquidity(lowOutbound, requestedAmount),
      impact: 'Route search can find a graph path but still fail when the first hop cannot carry the requested amount plus fees.',
      recommendation: 'Try a smaller dry-run amount, open an additional funded channel, or rebalance from an outbound-heavy channel.',
      docs: [DOC_REFS.channelRebalancing, DOC_REFS.rpc]
    });
  }

  const graphChannelCount = graphChannels.length;
  const graphNodeCount = graphNodes.length;
  if (!isError(graphChannelsEntry) && graphChannelCount === 0 && (peerCount > 0 || activeChannels.length > 0)) {
    addFinding({
      severity: 'warning',
      id: 'FS-GOSSIP-CATCHUP-001',
      title: 'No public routing graph is visible yet',
      evidence: `graph_nodes=${graphNodeCount}, graph_channels=${graphChannelCount}, peers=${peerCount}`,
      impact: 'Payments can fail with no-route errors even when local channels are ready, because the node has not applied enough gossip.',
      recommendation: 'Maintain several outbound peer subscriptions and give the node time to active-sync and passively subscribe to gossip updates.',
      docs: [DOC_REFS.gossip]
    });
  }

  const routeSummary = summarizeRoute(dryRunEntry);
  if (routeSummary.status === 'failed') {
    addFinding({
      severity: routeSummary.authLike ? 'critical' : 'warning',
      id: 'FS-ROUTE-DRYRUN-FAILED-001',
      title: 'Route dry run failed',
      evidence: routeSummary.reason,
      impact: routeFailureImpact(routeSummary.reason),
      recommendation: routeFailureRecommendation(routeSummary.reason),
      docs: [DOC_REFS.channelRebalancing, DOC_REFS.rpc, DOC_REFS.gossip]
    });
  } else if (routeSummary.status === 'not_captured') {
    addFinding({
      severity: 'info',
      id: 'FS-ROUTE-DRYRUN-MISSING-001',
      title: 'No route dry run was captured',
      evidence: 'Snapshot does not include send_payment dry_run or build_router output.',
      impact: 'The tool can inspect static node readiness but cannot prove whether a target amount can route.',
      recommendation: 'Run send_payment with dry_run: true before executing the actual payment.',
      docs: [DOC_REFS.channelRebalancing, DOC_REFS.rpc]
    });
  }

  const rebalanceSuggestions = buildRebalanceSuggestions(activeChannels, nodeInfo.pubkey, requestedAmount);
  if (rebalanceSuggestions.length > 0) {
    addFinding({
      severity: 'info',
      id: 'FS-REBALANCE-CANDIDATE-001',
      title: 'Circular rebalance candidate found',
      evidence: rebalanceSuggestions.map((suggestion) => `${shortPubkey(suggestion.outbound.pubkey)} -> ${shortPubkey(suggestion.inbound.pubkey)} for about ${suggestion.amountLabel}`).join('; '),
      impact: 'The node has one outbound-heavy channel and one inbound-heavy channel for the same asset.',
      recommendation: 'Run the generated self-payment dry run, cap fees, then execute only if the route and fee are acceptable.',
      docs: [DOC_REFS.channelRebalancing]
    });
  }

  const orderedFindings = sortFindings(findings);
  const score = computeScore(orderedFindings);
  const status = orderedFindings.some((finding) => finding.severity === 'critical')
    ? 'blocked'
    : orderedFindings.some((finding) => finding.severity === 'warning')
      ? 'degraded'
      : 'ready';

  return {
    product: 'FiberScope',
    status,
    score,
    capturedAt: snapshot?.meta?.capturedAt ?? snapshot?.capturedAt ?? null,
    source: snapshot?.meta?.source ?? 'snapshot',
    intent: {
      amount: requestedAmount === null ? null : toRpcHex(requestedAmount),
      targetPubkey: snapshot?.intent?.targetPubkey ?? snapshot?.meta?.targetPubkey ?? null
    },
    metrics: {
      nodeName: nodeInfo.node_name ?? nodeInfo.nodeName ?? 'unknown',
      version: nodeInfo.version ?? 'unknown',
      pubkey: nodeInfo.pubkey ?? null,
      peerCount,
      listedPeers: peers.length,
      channelCount: channels.length,
      activeChannelCount: activeChannels.length,
      pendingChannelCount: pendingChannels.length,
      graphNodeCount,
      graphChannelCount,
      outboundCapacity: activeChannels.reduce((sum, channel) => sum + channel.local, 0n).toString(),
      inboundCapacity: activeChannels.reduce((sum, channel) => sum + channel.remote, 0n).toString()
    },
    findings: orderedFindings,
    route: routeSummary,
    channels: channelViews,
    rebalanceSuggestions,
    rpcCoverage: buildRpcCoverage(rpc)
  };
}

export function renderConsoleSummary(inspection) {
  const lines = [];
  lines.push(`FiberScope: ${inspection.status.toUpperCase()} (${inspection.score}/100)`);
  lines.push(`Node: ${inspection.metrics.nodeName} ${inspection.metrics.version} ${inspection.metrics.pubkey ? shortPubkey(inspection.metrics.pubkey) : ''}`.trim());
  lines.push(`Peers: ${inspection.metrics.peerCount} | Ready channels: ${inspection.metrics.activeChannelCount}/${inspection.metrics.channelCount} | Graph channels: ${inspection.metrics.graphChannelCount}`);
  lines.push('');

  if (inspection.findings.length === 0) {
    lines.push('No findings.');
  } else {
    lines.push('Findings:');
    for (const finding of inspection.findings) {
      lines.push(`- [${finding.severity.toUpperCase()}] ${finding.id}: ${finding.title}`);
      lines.push(`  Evidence: ${finding.evidence}`);
      lines.push(`  Next: ${finding.recommendation}`);
    }
  }

  if (inspection.rebalanceSuggestions.length > 0) {
    lines.push('');
    lines.push('Rebalance dry-run candidate:');
    lines.push(JSON.stringify(inspection.rebalanceSuggestions[0].automaticDryRun, null, 2));
  }

  return lines.join('\n');
}

export function renderMarkdownReport(snapshot, inspection = inspectSnapshot(snapshot)) {
  const lines = [];
  lines.push('# FiberScope Diagnostic Report');
  lines.push('');
  lines.push(`- Status: **${inspection.status}**`);
  lines.push(`- Score: **${inspection.score}/100**`);
  lines.push(`- Source: \`${inspection.source}\``);
  if (inspection.capturedAt) lines.push(`- Captured: \`${inspection.capturedAt}\``);
  if (inspection.intent.amount) lines.push(`- Target amount: \`${inspection.intent.amount}\``);
  lines.push('');
  lines.push('## Node Snapshot');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Node | ${escapeCell(inspection.metrics.nodeName)} |`);
  lines.push(`| Version | ${escapeCell(inspection.metrics.version)} |`);
  lines.push(`| Pubkey | \`${inspection.metrics.pubkey ?? 'unknown'}\` |`);
  lines.push(`| Peers | ${inspection.metrics.peerCount} |`);
  lines.push(`| Ready channels | ${inspection.metrics.activeChannelCount}/${inspection.metrics.channelCount} |`);
  lines.push(`| Graph nodes/channels | ${inspection.metrics.graphNodeCount}/${inspection.metrics.graphChannelCount} |`);
  lines.push(`| Outbound capacity | ${formatAmount(inspection.metrics.outboundCapacity)} |`);
  lines.push(`| Inbound capacity | ${formatAmount(inspection.metrics.inboundCapacity)} |`);
  lines.push('');

  lines.push('## Findings');
  lines.push('');
  lines.push('| Severity | Fingerprint | Finding | Evidence | Next action |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const finding of inspection.findings) {
    lines.push(`| ${finding.severity} | \`${finding.fingerprint}\` | ${escapeCell(finding.title)} | ${escapeCell(finding.evidence)} | ${escapeCell(finding.recommendation)} |`);
  }
  if (inspection.findings.length === 0) {
    lines.push('| info | `FS-NONE-000` | No findings | Snapshot is route-ready for captured checks. | Keep collecting dry-run evidence before larger payments. |');
  }
  lines.push('');

  if (inspection.rebalanceSuggestions.length > 0) {
    lines.push('## Rebalance Candidates');
    lines.push('');
    for (const suggestion of inspection.rebalanceSuggestions) {
      lines.push(`### ${shortPubkey(suggestion.outbound.pubkey)} -> ${shortPubkey(suggestion.inbound.pubkey)}`);
      lines.push('');
      lines.push(`Suggested amount: \`${suggestion.amountHex}\` (${suggestion.amountLabel})`);
      lines.push('');
      lines.push('Automatic circular dry run:');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(suggestion.automaticDryRun, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('Manual route probe:');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(suggestion.manualBuildRouter, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('## RPC Coverage');
  lines.push('');
  lines.push('| Method | Status | Diagnostic scope |');
  lines.push('| --- | --- | --- |');
  for (const item of inspection.rpcCoverage) {
    lines.push(`| \`${item.method}\` | ${item.status} | \`${item.scope}\` |`);
  }
  lines.push('');
  lines.push('## Source Notes');
  lines.push('');
  lines.push('- Fiber rebalancing uses self-payments with `allow_self_payment: true` and should be tested with `dry_run: true` first.');
  lines.push('- Fiber gossip exposes public topology, not real-time channel balances, so route success still depends on local and remote liquidity.');
  lines.push('- Fiber v0.8 RPCs use pubkeys instead of peer IDs for peer and channel operations.');
  return lines.join('\n');
}

export function diffSnapshots(beforeSnapshot, afterSnapshot, options = {}) {
  const before = inspectSnapshot(beforeSnapshot, options.beforeOptions ?? options);
  const after = inspectSnapshot(afterSnapshot, options.afterOptions ?? options);
  const metricChanges = buildMetricChanges(before, after);
  const beforeFindingIds = new Set(before.findings.map((finding) => finding.id));
  const afterFindingIds = new Set(after.findings.map((finding) => finding.id));
  const resolvedFindings = before.findings.filter((finding) => !afterFindingIds.has(finding.id));
  const introducedFindings = after.findings.filter((finding) => !beforeFindingIds.has(finding.id));
  const persistentFindings = after.findings.filter((finding) => beforeFindingIds.has(finding.id));
  const scoreDelta = after.score - before.score;
  const statusDelta = statusRank(after.status) - statusRank(before.status);

  return {
    product: 'FiberScope',
    before,
    after,
    verdict: diffVerdict(scoreDelta, statusDelta, resolvedFindings, introducedFindings),
    scoreDelta,
    statusChange: {
      before: before.status,
      after: after.status
    },
    routeChange: {
      before: before.route.status,
      after: after.route.status,
      beforeReason: before.route.reason ?? before.route.evidence ?? null,
      afterReason: after.route.reason ?? after.route.evidence ?? null
    },
    metricChanges,
    findings: {
      resolved: resolvedFindings,
      introduced: introducedFindings,
      persistent: persistentFindings
    },
    channels: diffChannels(before.channels, after.channels)
  };
}

export function renderConsoleDiff(diff) {
  const lines = [];
  const scoreSign = diff.scoreDelta > 0 ? '+' : '';
  lines.push(`FiberScope Diff: ${diff.verdict.toUpperCase()} (${scoreSign}${diff.scoreDelta} score)`);
  lines.push(`Status: ${diff.statusChange.before} -> ${diff.statusChange.after}`);
  lines.push(`Route: ${diff.routeChange.before} -> ${diff.routeChange.after}`);
  lines.push('');
  lines.push('Metric changes:');
  for (const metric of diff.metricChanges) {
    lines.push(`- ${metric.label}: ${metric.beforeLabel} -> ${metric.afterLabel} (${metric.deltaLabel})`);
  }
  lines.push('');
  lines.push(`Resolved findings: ${diff.findings.resolved.map((finding) => finding.id).join(', ') || 'none'}`);
  lines.push(`Introduced findings: ${diff.findings.introduced.map((finding) => finding.id).join(', ') || 'none'}`);
  lines.push(`Persistent findings: ${diff.findings.persistent.map((finding) => finding.id).join(', ') || 'none'}`);
  return lines.join('\n');
}

export function renderMarkdownDiff(diff) {
  const lines = [];
  const scoreSign = diff.scoreDelta > 0 ? '+' : '';
  lines.push('# FiberScope Snapshot Diff');
  lines.push('');
  lines.push(`- Verdict: **${diff.verdict}**`);
  lines.push(`- Score: **${diff.before.score}/100 -> ${diff.after.score}/100** (${scoreSign}${diff.scoreDelta})`);
  lines.push(`- Status: **${diff.statusChange.before} -> ${diff.statusChange.after}**`);
  lines.push(`- Route: **${diff.routeChange.before} -> ${diff.routeChange.after}**`);
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Before | After | Delta |');
  lines.push('| --- | --- | --- | --- |');
  for (const metric of diff.metricChanges) {
    lines.push(`| ${escapeCell(metric.label)} | ${escapeCell(metric.beforeLabel)} | ${escapeCell(metric.afterLabel)} | ${escapeCell(metric.deltaLabel)} |`);
  }
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  lines.push('| Type | Fingerprint | Finding |');
  lines.push('| --- | --- | --- |');
  writeFindingRows(lines, 'resolved', diff.findings.resolved);
  writeFindingRows(lines, 'introduced', diff.findings.introduced);
  writeFindingRows(lines, 'persistent', diff.findings.persistent);
  if (
    diff.findings.resolved.length === 0
    && diff.findings.introduced.length === 0
    && diff.findings.persistent.length === 0
  ) {
    lines.push('| unchanged | `FS-NONE-000` | No findings in either snapshot. |');
  }
  lines.push('');
  lines.push('## Channel Changes');
  lines.push('');
  lines.push('| Peer | State | Local Delta | Remote Delta |');
  lines.push('| --- | --- | --- | --- |');
  for (const channel of diff.channels) {
    lines.push(`| ${escapeCell(shortPubkey(channel.pubkey))} | ${channel.state} | ${escapeCell(channel.localDeltaLabel)} | ${escapeCell(channel.remoteDeltaLabel)} |`);
  }
  if (diff.channels.length === 0) {
    lines.push('| none | unchanged | 0 CKB | 0 CKB |');
  }
  return lines.join('\n');
}

export function buildRpcCoverage(rpc = {}) {
  return REQUIRED_METHODS.map(([method, scope]) => {
    const entry = rpcEntry(rpc, method);
    return {
      method,
      scope,
      status: !entry ? 'missing' : isError(entry) ? 'error' : 'ok'
    };
  });
}

function buildMetricChanges(before, after) {
  const metricDefs = [
    ['peerCount', 'Peers'],
    ['activeChannelCount', 'Ready channels'],
    ['channelCount', 'Total channels'],
    ['graphNodeCount', 'Graph nodes'],
    ['graphChannelCount', 'Graph channels'],
    ['outboundCapacity', 'Outbound capacity', 'amount'],
    ['inboundCapacity', 'Inbound capacity', 'amount']
  ];

  return metricDefs.map(([key, label, type]) => {
    const beforeValue = type === 'amount' ? parseAmount(before.metrics[key]) : Number(before.metrics[key] ?? 0);
    const afterValue = type === 'amount' ? parseAmount(after.metrics[key]) : Number(after.metrics[key] ?? 0);
    const delta = afterValue - beforeValue;
    return {
      key,
      label,
      before: beforeValue.toString(),
      after: afterValue.toString(),
      delta: delta.toString(),
      beforeLabel: type === 'amount' ? formatAmount(beforeValue) : String(beforeValue),
      afterLabel: type === 'amount' ? formatAmount(afterValue) : String(afterValue),
      deltaLabel: formatDelta(delta, type)
    };
  });
}

function diffChannels(beforeChannels, afterChannels) {
  const beforeMap = new Map(beforeChannels.map((channel) => [channelIdentity(channel), channel]));
  const afterMap = new Map(afterChannels.map((channel) => [channelIdentity(channel), channel]));
  const identities = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes = [];

  for (const identity of identities) {
    const before = beforeMap.get(identity);
    const after = afterMap.get(identity);
    const localDelta = (after?.local ?? 0n) - (before?.local ?? 0n);
    const remoteDelta = (after?.remote ?? 0n) - (before?.remote ?? 0n);
    const state = !before ? 'added' : !after ? 'removed' : localDelta !== 0n || remoteDelta !== 0n ? 'changed' : 'unchanged';
    if (state === 'unchanged') continue;
    changes.push({
      identity,
      state,
      pubkey: after?.pubkey ?? before?.pubkey ?? null,
      beforeState: before?.stateName ?? null,
      afterState: after?.stateName ?? null,
      localDelta: localDelta.toString(),
      remoteDelta: remoteDelta.toString(),
      localDeltaLabel: formatDelta(localDelta, 'amount'),
      remoteDeltaLabel: formatDelta(remoteDelta, 'amount')
    });
  }

  return changes.sort((a, b) => a.state.localeCompare(b.state) || a.identity.localeCompare(b.identity));
}

function channelIdentity(channel) {
  return channel.channelOutpoint ?? channel.channelId ?? channel.pubkey ?? 'unknown';
}

function statusRank(status) {
  const ranks = { blocked: 0, degraded: 1, ready: 2 };
  return ranks[status] ?? 0;
}

function diffVerdict(scoreDelta, statusDelta, resolvedFindings, introducedFindings) {
  const introducedCritical = introducedFindings.some((finding) => finding.severity === 'critical');
  if (statusDelta > 0 || (scoreDelta > 0 && resolvedFindings.length >= introducedFindings.length)) return 'improved';
  if (statusDelta < 0 || scoreDelta < 0 || introducedCritical) return 'regressed';
  if (resolvedFindings.length > 0 || introducedFindings.length > 0) return 'changed';
  return 'stable';
}

function formatDelta(delta, type) {
  const value = typeof delta === 'bigint' ? delta : BigInt(delta);
  const sign = value > 0n ? '+' : '';
  if (type === 'amount') {
    const amount = value < 0n ? -value : value;
    return `${sign}${value < 0n ? '-' : ''}${formatAmount(amount)}`;
  }
  return `${sign}${value.toString()}`;
}

function writeFindingRows(lines, type, findings) {
  for (const finding of findings) {
    lines.push(`| ${type} | \`${finding.id}\` | ${escapeCell(finding.title)} |`);
  }
}

export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return 0n;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return BigInt(trimmed);
    if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed);
  }
  throw new Error(`Unsupported amount value: ${String(value)}`);
}

export function formatAmount(value, asset = 'CKB') {
  const amount = parseAmount(value);
  if (asset !== 'CKB') return `${amount.toString()} atomic units`;
  const unit = 100000000n;
  const whole = amount / unit;
  const fraction = amount % unit;
  if (fraction === 0n) return `${whole.toString()} CKB`;
  const fractionText = fraction.toString().padStart(8, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionText} CKB`;
}

export function toRpcHex(value) {
  return `0x${parseAmount(value).toString(16)}`;
}

export function shortPubkey(pubkey) {
  if (!pubkey || typeof pubkey !== 'string') return 'unknown';
  const normalized = pubkey.startsWith('0x') ? pubkey.slice(2) : pubkey;
  if (normalized.length <= 16) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

export function normalizeChannel(channel) {
  const local = parseAmount(channel.local_balance ?? channel.localBalance ?? 0);
  const remote = parseAmount(channel.remote_balance ?? channel.remoteBalance ?? 0);
  const total = local + remote;
  const stateName = channelStateName(channel.state);
  const asset = assetLabel(channel.funding_udt_type_script ?? channel.udt_type_script);
  return {
    raw: channel,
    channelId: channel.channel_id ?? channel.channelId ?? null,
    channelOutpoint: channel.channel_outpoint ?? channel.channelOutpoint ?? null,
    pubkey: channel.pubkey ?? channel.peer_pubkey ?? null,
    stateName,
    ready: stateName === 'ChannelReady',
    enabled: channel.enabled !== false,
    public: channel.is_public ?? channel.public ?? false,
    local,
    remote,
    total,
    localRatio: total === 0n ? 0 : Number((local * 10000n) / total) / 10000,
    remoteRatio: total === 0n ? 0 : Number((remote * 10000n) / total) / 10000,
    localLabel: formatAmount(local, asset),
    remoteLabel: formatAmount(remote, asset),
    totalLabel: formatAmount(total, asset),
    asset,
    assetKey: assetKey(channel.funding_udt_type_script ?? channel.udt_type_script),
    failureDetail: channel.failure_detail ?? channel.failureDetail ?? null,
    feeRate: channel.tlc_fee_proportional_millionths ?? null
  };
}

function parseOptionalAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  return parseAmount(value);
}

function rpcEntry(rpc, method) {
  if (!rpc) return null;
  if (Object.hasOwn(rpc, method)) return rpc[method];
  if (method === 'send_payment_dry_run' && Object.hasOwn(rpc, 'send_payment')) return rpc.send_payment;
  return null;
}

function firstPresent(rpc, methods) {
  for (const method of methods) {
    const entry = rpcEntry(rpc, method);
    if (entry) return { method, entry };
  }
  return null;
}

function hasResult(entry) {
  return Boolean(entry && Object.hasOwn(entry, 'result'));
}

function isError(entry) {
  return Boolean(entry?.error || entry?.ok === false);
}

function responseResult(entry) {
  if (!entry || isError(entry)) return null;
  if (Object.hasOwn(entry, 'result')) return entry.result;
  return entry;
}

function responseErrorMessage(entry) {
  if (!entry) return '';
  const error = entry.error ?? entry;
  if (typeof error === 'string') return error;
  return error.message ?? error.reason ?? '';
}

function resultList(entry, field) {
  const result = responseResult(entry);
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result[field])) return result[field];
  return [];
}

function collectAuthErrors(rpc) {
  return Object.entries(rpc ?? {})
    .filter(([, entry]) => isError(entry))
    .map(([method, entry]) => ({ method, message: responseErrorMessage(entry) }))
    .filter((item) => /biscuit|permission|unauthori[sz]ed|forbidden|token|scope|denied/i.test(item.message));
}

function allErrorMessages(rpc) {
  return Object.values(rpc ?? {})
    .filter((entry) => isError(entry))
    .map(responseErrorMessage)
    .filter(Boolean);
}

function versionBefore(version, minimum) {
  if (!version || typeof version !== 'string') return false;
  const parse = (text) => text.split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(version);
  const right = parse(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return true;
    if (left[index] > right[index]) return false;
  }
  return false;
}

function countFromNodeInfo(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return Number(parseAmount(value));
  } catch {
    return fallback;
  }
}

function displayCount(value, fallback) {
  return value === null || value === undefined ? String(fallback) : `${String(value)} (${countFromNodeInfo(value, fallback)})`;
}

function channelStateName(state) {
  if (!state) return 'Unknown';
  if (typeof state === 'string') return state;
  if (state.state_name) return state.state_name;
  if (state.type) return state.type;
  const keys = Object.keys(state);
  return keys.length > 0 ? keys[0] : 'Unknown';
}

function summarizeChannels(channels) {
  return channels
    .slice(0, 5)
    .map((channel) => `${shortPubkey(channel.pubkey)} ${channel.stateName} local=${channel.localLabel} remote=${channel.remoteLabel}`)
    .join('; ');
}

function summarizeLiquidity(channels, requestedAmount) {
  const requested = requestedAmount === null ? '' : ` requested=${formatAmount(requestedAmount)}`;
  return channels
    .slice(0, 5)
    .map((channel) => `${shortPubkey(channel.pubkey)} local=${channel.localLabel} (${Math.round(channel.localRatio * 100)}%)${requested}`)
    .join('; ');
}

function summarizeRoute(dryRun) {
  if (!dryRun) {
    return { status: 'not_captured', reason: 'No dry-run response in snapshot.' };
  }
  const { method, entry } = dryRun;
  if (isError(entry)) {
    const reason = responseErrorMessage(entry) || `${method} returned an error`;
    return {
      status: 'failed',
      method,
      reason,
      authLike: /biscuit|permission|unauthori[sz]ed|forbidden|token|scope|denied/i.test(reason)
    };
  }
  const result = responseResult(entry) ?? {};
  const fee = parseAmount(result.fee ?? 0);
  const routers = result.routers ?? result.router_hops ?? [];
  return {
    status: 'ready',
    method,
    paymentStatus: result.status ?? 'ready',
    fee: fee.toString(),
    feeLabel: formatAmount(fee),
    routes: Array.isArray(routers) ? routers : [],
    evidence: `${method} returned ${result.status ?? 'route data'} with fee ${formatAmount(fee)}`
  };
}

function routeFailureImpact(reason) {
  if (/liquidity|capacity|insufficient|balance/i.test(reason)) {
    return 'The graph may contain a path, but one hop cannot carry the target amount.';
  }
  if (/no route|no path|router|path/i.test(reason)) {
    return 'The node does not currently know a viable path through the public graph.';
  }
  if (/tlc|expiry|fee|policy/i.test(reason)) {
    return 'A route candidate exists, but channel policy or fee constraints reject it.';
  }
  return 'The payment should not be executed until the dry-run failure is understood.';
}

function routeFailureRecommendation(reason) {
  if (/liquidity|capacity|insufficient|balance/i.test(reason)) {
    return 'Lower the amount, rebalance channels, or open a better-funded outbound channel, then rerun dry_run.';
  }
  if (/no route|no path|router|path/i.test(reason)) {
    return 'Connect to public nodes, wait for gossip catch-up, and compare graph_channels before retrying dry_run.';
  }
  if (/tlc|expiry|fee|policy/i.test(reason)) {
    return 'Raise max_fee_amount cautiously or inspect channel fee and TLC policy on the candidate path.';
  }
  return 'Capture build_router and send_payment dry_run output with the same amount and target.';
}

function buildRebalanceSuggestions(channels, ownPubkey, requestedAmount) {
  if (!ownPubkey) return [];
  const groups = new Map();
  for (const channel of channels) {
    if (channel.total === 0n) continue;
    if (!groups.has(channel.assetKey)) groups.set(channel.assetKey, []);
    groups.get(channel.assetKey).push(channel);
  }

  const suggestions = [];
  for (const group of groups.values()) {
    const outboundHeavy = group
      .filter((channel) => channel.localRatio >= 0.75 && channel.local > channel.remote)
      .sort((a, b) => b.localRatio - a.localRatio);
    const inboundHeavy = group
      .filter((channel) => channel.localRatio <= 0.25 && channel.remote > channel.local)
      .sort((a, b) => a.localRatio - b.localRatio);
    if (outboundHeavy.length === 0 || inboundHeavy.length === 0) continue;

    const outbound = outboundHeavy[0];
    const inbound = inboundHeavy[0];
    let amount = minBigInt((outbound.local - outbound.remote) / 2n, (inbound.remote - inbound.local) / 2n);
    if (requestedAmount !== null && requestedAmount > 0n) amount = minBigInt(amount, requestedAmount);
    if (amount <= 0n) continue;
    const maxFee = maxBigInt(amount / 200n, 1000n);

    suggestions.push({
      asset: outbound.asset,
      outbound,
      inbound,
      amount: amount.toString(),
      amountHex: toRpcHex(amount),
      amountLabel: formatAmount(amount, outbound.asset),
      maxFeeHex: toRpcHex(maxFee),
      automaticDryRun: {
        jsonrpc: '2.0',
        id: 1,
        method: 'send_payment',
        params: [{
          target_pubkey: ownPubkey,
          amount: toRpcHex(amount),
          keysend: true,
          allow_self_payment: true,
          dry_run: true,
          max_fee_amount: toRpcHex(maxFee)
        }]
      },
      manualBuildRouter: {
        jsonrpc: '2.0',
        id: 2,
        method: 'build_router',
        params: [{
          amount: toRpcHex(amount),
          hops_info: [
            { pubkey: outbound.pubkey },
            { pubkey: inbound.pubkey },
            { pubkey: ownPubkey }
          ]
        }]
      }
    });
  }
  return suggestions;
}

function assetKey(script) {
  if (!script) return 'CKB';
  return `${script.code_hash ?? 'unknown'}:${script.hash_type ?? 'type'}:${script.args ?? ''}`;
}

function assetLabel(script) {
  if (!script) return 'CKB';
  const args = script.args ? String(script.args).slice(0, 10) : 'unknown';
  return `UDT(${args})`;
}

function sortFindings(findings) {
  const rank = { critical: 0, warning: 1, info: 2 };
  return [...findings].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.id.localeCompare(b.id));
}

function computeScore(findings) {
  const weights = { critical: 24, warning: 9, info: 0 };
  const penalty = findings.reduce((sum, finding) => sum + (weights[finding.severity] ?? 0), 0);
  return Math.max(0, 100 - penalty);
}

function minBigInt(a, b) {
  return a < b ? a : b;
}

function maxBigInt(a, b) {
  return a > b ? a : b;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
