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

const STATUS_RANK = { blocked: 0, degraded: 1, ready: 2 };
const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };
const DEFAULT_GATE_REQUIRED_RPC = [
  'node_info',
  'list_peers',
  'list_channels',
  'graph_nodes',
  'graph_channels',
  'send_payment_dry_run'
];

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
    network: snapshot?.meta?.network ?? null,
    status,
    score,
    capturedAt: snapshot?.meta?.capturedAt ?? snapshot?.capturedAt ?? null,
    source: snapshot?.meta?.source ?? 'snapshot',
    evidence: buildEvidenceSummary(snapshot, nodeInfo),
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

function buildEvidenceSummary(snapshot, nodeInfo) {
  const replay = snapshot?.meta?.replay;
  const source = snapshot?.meta?.source ?? 'snapshot';
  const capturedAt = snapshot?.meta?.capturedAt ?? snapshot?.capturedAt ?? null;

  if (replay?.kind === 'real_capture') {
    return {
      kind: 'real_capture',
      label: 'Real FNN replay',
      capturedAt,
      nodeLabel: replay.nodeLabel ?? nodeInfo.node_name ?? 'public Fiber node',
      fnnVersion: replay.fnnVersion ?? nodeInfo.version ?? 'unknown',
      sourceDocument: replay.sourceDocument ?? null,
      sanitized: Boolean(replay.sanitized),
      bounded: Boolean(replay.bounded),
      observedCounts: replay.observedCounts ?? {},
      pagination: replay.pagination ?? {}
    };
  }

  if (/^https?:\/\//i.test(source)) {
    return {
      kind: 'live_capture',
      label: 'Live FNN capture',
      capturedAt,
      nodeLabel: nodeInfo.node_name ?? 'Fiber node',
      fnnVersion: nodeInfo.version ?? 'unknown',
      sanitized: false,
      bounded: Boolean(
        snapshot?.rpc?.graph_nodes?.result?.truncated ||
        snapshot?.rpc?.graph_channels?.result?.truncated
      ),
      observedCounts: {},
      pagination: {
        graphNodes: graphPagination(snapshot?.rpc?.graph_nodes?.result, snapshot?.meta?.graphLimit),
        graphChannels: graphPagination(snapshot?.rpc?.graph_channels?.result, snapshot?.meta?.graphLimit)
      }
    };
  }

  return {
    kind: source.startsWith('fixture:') ? 'deterministic_fixture' : 'snapshot',
    label: source.startsWith('fixture:') ? 'Deterministic fixture' : 'Snapshot',
    capturedAt,
    nodeLabel: nodeInfo.node_name ?? 'Fiber node',
    fnnVersion: nodeInfo.version ?? 'unknown',
    sanitized: false,
    bounded: false,
    observedCounts: {},
    pagination: {}
  };
}

function graphPagination(result = {}, fallbackLimit = null) {
  return {
    pages: Number(result.pages ?? 0),
    limit: Number(fallbackLimit ?? 0),
    truncated: Boolean(result.truncated)
  };
}

export function evaluateReadinessGate(inspection, options = {}) {
  const policy = normalizeGatePolicy(options);
  const failures = [];

  if (inspection.score < policy.minScore) {
    failures.push({
      id: 'FS-GATE-SCORE-001',
      title: 'Readiness score is below policy',
      evidence: `score=${inspection.score}, required>=${policy.minScore}`,
      recommendation: 'Resolve the highest severity findings, then rerun the gate.'
    });
  }

  if (statusRank(inspection.status) < statusRank(policy.minStatus)) {
    failures.push({
      id: 'FS-GATE-STATUS-001',
      title: 'Node status is below policy',
      evidence: `status=${inspection.status}, required>=${policy.minStatus}`,
      recommendation: 'Bring the node to route-ready status before treating it as payment-ready.'
    });
  }

  const severityBlockers = inspection.findings.filter((finding) => (
    severityRank(finding.severity) > severityRank(policy.maxSeverity)
  ));
  if (severityBlockers.length > 0) {
    failures.push({
      id: 'FS-GATE-SEVERITY-001',
      title: 'Findings exceed allowed severity',
      evidence: severityBlockers.map((finding) => `${finding.id}:${finding.severity}`).join(', '),
      recommendation: `Resolve findings above ${policy.maxSeverity} severity or relax the gate for non-payment checks.`
    });
  }

  if (policy.requireRouteReady && inspection.route.status !== 'ready') {
    failures.push({
      id: 'FS-GATE-ROUTE-001',
      title: 'Route dry run is not ready',
      evidence: inspection.route.reason ?? inspection.route.evidence ?? `route status=${inspection.route.status}`,
      recommendation: 'Capture a successful send_payment dry run for the target amount before opening the gate.'
    });
  }

  const missingRpc = inspection.rpcCoverage.filter((item) => (
    policy.requiredRpc.includes(item.method) && item.status !== 'ok'
  ));
  if (missingRpc.length > 0) {
    failures.push({
      id: 'FS-GATE-RPC-COVERAGE-001',
      title: 'Required RPC evidence is incomplete',
      evidence: missingRpc.map((item) => `${item.method}:${item.status}`).join(', '),
      recommendation: 'Collect a fresh snapshot with the required diagnostic RPC scopes and dry-run evidence.'
    });
  }

  const passed = failures.length === 0;

  return {
    product: 'FiberScope',
    type: 'readiness_gate',
    passed,
    verdict: passed ? 'pass' : 'fail',
    summary: passed
      ? 'Node satisfies the payment-readiness gate.'
      : `${failures.length} gate check${failures.length === 1 ? '' : 's'} failed.`,
    policy,
    node: {
      name: inspection.metrics.nodeName,
      version: inspection.metrics.version,
      pubkey: inspection.metrics.pubkey,
      source: inspection.source,
      status: inspection.status,
      score: inspection.score,
      routeStatus: inspection.route.status
    },
    failures,
    blockingFindings: severityBlockers.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      evidence: finding.evidence,
      recommendation: finding.recommendation
    }))
  };
}

export function renderConsoleGate(gate) {
  const lines = [];
  lines.push(`FiberScope Gate: ${gate.verdict.toUpperCase()}`);
  lines.push(`Node: ${gate.node.name} ${gate.node.version} (${gate.node.status}, ${gate.node.score}/100)`);
  lines.push(`Route: ${gate.node.routeStatus}`);
  lines.push(`Policy: status>=${gate.policy.minStatus} score>=${gate.policy.minScore} max_severity=${gate.policy.maxSeverity} route_ready=${gate.policy.requireRouteReady}`);
  lines.push(`Required RPC: ${gate.policy.requiredRpc.join(', ')}`);
  lines.push('');

  if (gate.passed) {
    lines.push(gate.summary);
    return lines.join('\n');
  }

  lines.push('Gate failures:');
  for (const failure of gate.failures) {
    lines.push(`- ${failure.id}: ${failure.title}`);
    lines.push(`  Evidence: ${failure.evidence}`);
    lines.push(`  Next: ${failure.recommendation}`);
  }

  if (gate.blockingFindings.length > 0) {
    lines.push('');
    lines.push('Blocking findings:');
    for (const finding of gate.blockingFindings.slice(0, 5)) {
      lines.push(`- [${finding.severity.toUpperCase()}] ${finding.id}: ${finding.title}`);
    }
  }

  return lines.join('\n');
}

export function buildRemediationRunbook(inspection, options = {}) {
  const rpcUrl = options.rpcUrl ?? 'http://127.0.0.1:8227';
  const bootstrapNode = normalizeBootstrapNode(options.bootstrapNode);
  if (
    inspection.network
    && bootstrapNode?.network
    && inspection.network !== bootstrapNode.network
  ) {
    throw new Error(`Bootstrap node network ${bootstrapNode.network} does not match snapshot network ${inspection.network}`);
  }
  const findingIds = new Set(inspection.findings.map((finding) => finding.id));
  const gate = evaluateReadinessGate(inspection, options.gatePolicy);
  const drafts = [];
  const draftKeys = new Set();

  const addStep = (key, step) => {
    if (draftKeys.has(key)) return;
    draftKeys.add(key);
    drafts.push({ key, ...step });
  };
  const addRpcStep = (key, step) => addStep(key, {
    execution: 'rpc',
    ...step
  });
  const addManualStep = (key, step) => addStep(key, {
    execution: 'manual',
    safety: 'manual',
    approval: 'external',
    requiredScope: null,
    ...step
  });
  const hasFinding = (id) => findingIds.has(id);

  if (hasFinding('FS-AUTH-SCOPE-001')) {
    addManualStep('repair-auth', {
      phase: 'access',
      title: 'Issue a least-privilege operator token',
      rationale: 'The captured Biscuit token cannot read all diagnostic evidence or authorize a payment dry run.',
      triggeredBy: ['FS-AUTH-SCOPE-001'],
      instruction: 'Issue a short-lived Biscuit token containing the scopes listed by this runbook, then recollect the snapshot. Keep write scopes out of long-lived dashboard tokens.',
      successCriteria: 'Every required RPC returns a result instead of an authorization error.',
      docs: [DOC_REFS.auth]
    });
  }

  if (hasFinding('FS-NODE-RPC-001')) {
    addRpcStep('probe-node-info', {
      phase: 'access',
      title: 'Restore the node RPC health check',
      rationale: 'Node identity and version must be known before channel or payment actions are reviewed.',
      triggeredBy: ['FS-NODE-RPC-001'],
      safety: 'read_only',
      approval: 'not_required',
      requiredScope: 'read("node")',
      method: 'node_info',
      params: [],
      successCriteria: 'node_info returns the expected pubkey, chain hash, and Fiber version.',
      docs: [DOC_REFS.rpc]
    });
  }

  if (hasFinding('FS-MIGRATION-PUBKEY-001')) {
    addManualStep('migrate-pubkey-rpcs', {
      phase: 'access',
      title: 'Migrate peer RPC parameters to pubkeys',
      rationale: 'Fiber v0.8 replaced peer_id parameters across peer and channel RPCs.',
      triggeredBy: ['FS-MIGRATION-PUBKEY-001'],
      instruction: 'Replace peer_id fields with pubkey in connect_peer, open_channel, and list_channels integrations before retrying the workflow.',
      successCriteria: 'The operator integration sends v0.8 pubkey-based RPC payloads.',
      docs: [DOC_REFS.migration]
    });
  }

  const stalePeers = inspection.channels.filter((channel) => channel.stateName === 'Stale' && channel.pubkey);
  if (hasFinding('FS-PEER-NONE-001') || stalePeers.length > 0) {
    const peerTargets = hasFinding('FS-PEER-NONE-001')
      ? (bootstrapNode ? [bootstrapNode.pubkey] : [])
      : stalePeers.map((channel) => channel.pubkey);

    if (peerTargets.length === 0) {
      addManualStep('select-bootstrap-peer', {
        phase: 'connectivity',
        title: 'Select a documented public bootstrap peer',
        rationale: 'The node has no connected peers and the snapshot does not identify a safe bootstrap target.',
        triggeredBy: ['FS-PEER-NONE-001'],
        instruction: 'Select a public-node preset for the snapshot network, then regenerate this runbook with its pubkey.',
        successCriteria: 'A stable v0.8 public-node pubkey is selected for connect_peer.',
        docs: [DOC_REFS.publicNodes]
      });
    }

    for (const pubkey of [...new Set(peerTargets)]) {
      addRpcStep(`connect-peer:${pubkey}`, {
        phase: 'connectivity',
        title: hasFinding('FS-PEER-NONE-001') ? 'Connect a bootstrap Fiber peer' : 'Reconnect the stale channel peer',
        rationale: hasFinding('FS-PEER-NONE-001')
          ? 'At least one peer is required before gossip and channel operations can progress.'
          : 'A stale channel needs its peer connection restored before passive state audit can complete.',
        triggeredBy: hasFinding('FS-PEER-NONE-001') ? ['FS-PEER-NONE-001'] : ['FS-CHANNEL-STALE-001'],
        safety: 'reversible_write',
        approval: 'required',
        requiredScope: 'write("peers")',
        method: 'connect_peer',
        params: [{ pubkey, save: true }],
        successCriteria: `list_peers includes ${shortPubkey(pubkey)}.`,
        docs: [DOC_REFS.publicNodes, DOC_REFS.rpc]
      });
    }
  }

  if (hasFinding('FS-CHANNEL-NONE-001')) {
    if (bootstrapNode?.pubkey && bootstrapNode?.fundingAmount) {
      addRpcStep(`open-channel:${bootstrapNode.pubkey}`, {
        phase: 'channels',
        title: 'Open a public bootstrap channel',
        rationale: 'A funded ChannelReady channel is required before the node can send or forward payments.',
        triggeredBy: ['FS-CHANNEL-NONE-001'],
        safety: 'funding_write',
        approval: 'required',
        requiredScope: 'write("channels")',
        method: 'open_channel',
        params: [{
          pubkey: bootstrapNode.pubkey,
          funding_amount: toRpcHex(bootstrapNode.fundingAmount),
          public: true
        }],
        successCriteria: `list_channels shows a ChannelReady channel with ${bootstrapNode.name ?? shortPubkey(bootstrapNode.pubkey)}.`,
        docs: [DOC_REFS.publicNodes, DOC_REFS.rpc]
      });
    } else {
      addManualStep('choose-channel-funding', {
        phase: 'channels',
        title: 'Choose the bootstrap channel and funding amount',
        rationale: 'Opening a channel locks funds and must not be guessed from an incomplete snapshot.',
        triggeredBy: ['FS-CHANNEL-NONE-001'],
        instruction: 'Choose a documented public node and an accepted funding amount, then regenerate the runbook with explicit bootstrap details.',
        successCriteria: 'The target pubkey and funding amount have been reviewed against the public-node policy.',
        docs: [DOC_REFS.publicNodes]
      });
    }
  }

  if (hasFinding('FS-CHANNEL-PENDING-001') || hasFinding('FS-CHANNEL-FAILED-001') || hasFinding('FS-CHANNEL-NONE-001')) {
    addRpcStep('inspect-pending-channels', {
      phase: 'channels',
      title: 'Inspect channel opening progress',
      rationale: 'Pending and failed funding flows need explicit evidence before route checks continue.',
      triggeredBy: [
        ...(hasFinding('FS-CHANNEL-PENDING-001') ? ['FS-CHANNEL-PENDING-001'] : []),
        ...(hasFinding('FS-CHANNEL-FAILED-001') ? ['FS-CHANNEL-FAILED-001'] : []),
        ...(hasFinding('FS-CHANNEL-NONE-001') ? ['FS-CHANNEL-NONE-001'] : [])
      ],
      safety: 'read_only',
      approval: 'not_required',
      requiredScope: 'read("channels")',
      method: 'list_channels',
      params: [{ only_pending: true }],
      successCriteria: 'The opening attempt has no failure_detail and progresses to ChannelReady.',
      docs: [DOC_REFS.rpc]
    });
  }

  if (hasFinding('FS-CHANNEL-DISABLED-001')) {
    const disabledChannels = inspection.channels.filter((channel) => channel.ready && !channel.enabled);
    for (const channel of disabledChannels) {
      if (!channel.channelId) {
        addManualStep(`identify-disabled-channel:${channel.pubkey}`, {
          phase: 'channels',
          title: 'Identify the disabled channel ID',
          rationale: 'update_channel requires a final channel_id, which is missing from this snapshot.',
          triggeredBy: ['FS-CHANNEL-DISABLED-001'],
          instruction: `Recollect list_channels for peer ${channel.pubkey ?? 'unknown'} and record channel_id.`,
          successCriteria: 'The disabled ChannelReady entry has a final channel_id.',
          docs: [DOC_REFS.rpc]
        });
        continue;
      }
      addRpcStep(`enable-channel:${channel.channelId}`, {
        phase: 'channels',
        title: 'Re-enable the ready channel',
        rationale: 'The channel exists but is excluded from forwarding and payment attempts.',
        triggeredBy: ['FS-CHANNEL-DISABLED-001'],
        safety: 'reversible_write',
        approval: 'required',
        requiredScope: 'write("channels")',
        method: 'update_channel',
        params: [{ channel_id: channel.channelId, enabled: true }],
        successCriteria: `list_channels reports enabled=true for ${shortPubkey(channel.pubkey)}.`,
        docs: [DOC_REFS.rpc]
      });
    }
  }

  if (hasFinding('FS-GOSSIP-CATCHUP-001')) {
    addRpcStep('probe-public-graph', {
      phase: 'routing',
      title: 'Verify public gossip catch-up',
      rationale: 'A connected node still needs usable public topology before route building is meaningful.',
      triggeredBy: ['FS-GOSSIP-CATCHUP-001'],
      safety: 'read_only',
      approval: 'not_required',
      requiredScope: 'read("graph")',
      method: 'graph_channels',
      params: [{ limit: 200 }],
      successCriteria: 'graph_channels returns public channels and the count grows or stabilizes across collections.',
      docs: [DOC_REFS.gossip]
    });
  }

  const requestedAmount = inspection.intent.amount ? parseAmount(inspection.intent.amount) : null;
  const targetPubkey = inspection.intent.targetPubkey;
  const routeNeedsProbe = (
    hasFinding('FS-LIQUIDITY-OUTBOUND-LOW-001')
    || hasFinding('FS-ROUTE-DRYRUN-FAILED-001')
  ) && inspection.route.authLike !== true;

  if (routeNeedsProbe && requestedAmount && targetPubkey) {
    const reducedAmount = requestedAmount > 1n ? requestedAmount / 2n : requestedAmount;
    addRpcStep('rehearse-reduced-payment', {
      phase: 'liquidity',
      title: 'Rehearse a reduced target amount',
      rationale: 'A smaller dry run separates first-hop liquidity pressure from complete route unavailability.',
      triggeredBy: [
        ...(hasFinding('FS-LIQUIDITY-OUTBOUND-LOW-001') ? ['FS-LIQUIDITY-OUTBOUND-LOW-001'] : []),
        ...(hasFinding('FS-ROUTE-DRYRUN-FAILED-001') ? ['FS-ROUTE-DRYRUN-FAILED-001'] : [])
      ],
      safety: 'dry_run',
      approval: 'review',
      requiredScope: 'write("payments")',
      method: 'send_payment',
      params: [paymentDryRunParams(targetPubkey, reducedAmount)],
      successCriteria: `send_payment dry_run builds a route for ${formatAmount(reducedAmount)} within the generated fee cap.`,
      docs: [DOC_REFS.channelRebalancing, DOC_REFS.rpc]
    });
  } else if (routeNeedsProbe && (!requestedAmount || !targetPubkey)) {
    addManualStep('capture-payment-intent', {
      phase: 'liquidity',
      title: 'Capture the exact payment intent',
      rationale: 'A route rehearsal requires both the target pubkey and amount.',
      triggeredBy: ['FS-ROUTE-DRYRUN-FAILED-001'],
      instruction: 'Recollect with --target-pubkey and --amount so the runbook can generate a deterministic dry-run payload.',
      successCriteria: 'The snapshot records intent.targetPubkey and intent.amount.',
      docs: [DOC_REFS.rpc]
    });
  }

  if (hasFinding('FS-ROUTE-DRYRUN-MISSING-001')) {
    if (requestedAmount && targetPubkey) {
      addRpcStep('capture-route-dry-run', {
        phase: 'routing',
        title: 'Capture route dry-run evidence',
        rationale: 'Static channel state cannot prove that a payment route is currently buildable.',
        triggeredBy: ['FS-ROUTE-DRYRUN-MISSING-001'],
        safety: 'dry_run',
        approval: 'review',
        requiredScope: 'write("payments")',
        method: 'send_payment',
        params: [paymentDryRunParams(targetPubkey, requestedAmount)],
        successCriteria: 'send_payment dry_run returns route data and an acceptable fee without transferring value.',
        docs: [DOC_REFS.channelRebalancing, DOC_REFS.rpc]
      });
    } else {
      addManualStep('capture-route-intent', {
        phase: 'routing',
        title: 'Add a target and amount for route rehearsal',
        rationale: 'The snapshot lacks enough intent data to construct send_payment dry_run safely.',
        triggeredBy: ['FS-ROUTE-DRYRUN-MISSING-001'],
        instruction: 'Set --target-pubkey and --amount during collection, then regenerate the runbook.',
        successCriteria: 'The snapshot contains a target pubkey and amount.',
        docs: [DOC_REFS.rpc]
      });
    }
  }

  if (inspection.rebalanceSuggestions.length > 0) {
    const suggestion = inspection.rebalanceSuggestions[0];
    addRpcStep('rehearse-circular-rebalance', {
      phase: 'liquidity',
      title: 'Rehearse the circular rebalance candidate',
      rationale: 'The channel pair has complementary imbalance that may be corrected by a self-payment.',
      triggeredBy: ['FS-REBALANCE-CANDIDATE-001'],
      safety: 'dry_run',
      approval: 'review',
      requiredScope: 'write("payments")',
      method: suggestion.automaticDryRun.method,
      params: suggestion.automaticDryRun.params,
      successCriteria: `The ${suggestion.amountLabel} self-payment dry run returns an acceptable circular route and fee.`,
      docs: [DOC_REFS.channelRebalancing]
    });
  }

  const remediationStepCount = drafts.length;
  const collectArgs = [
    'npm run fiber-scope -- collect',
    '--rpc', rpcUrl,
    '--out', 'snapshots/post-runbook.json',
    '--graph-limit', '200',
    '--graph-pages', '5'
  ];
  if (inspection.intent.amount) collectArgs.push('--amount', inspection.intent.amount);
  if (targetPubkey) collectArgs.push('--target-pubkey', targetPubkey);

  addStep('collect-fresh-evidence', {
    execution: 'cli',
    phase: 'validation',
    title: 'Collect fresh post-action evidence',
    rationale: 'Every action should be verified from a new node snapshot rather than inferred from the RPC response alone.',
    triggeredBy: [],
    safety: 'read_only',
    approval: 'not_required',
    requiredScope: null,
    requiredScopes: [
      'read("node")',
      'read("peers")',
      'read("channels")',
      'read("graph")',
      ...(targetPubkey && inspection.intent.amount ? ['write("payments")'] : [])
    ],
    command: collectArgs.join(' '),
    successCriteria: 'A fresh snapshots/post-runbook.json contains node, peer, channel, graph, and route evidence.',
    docs: [DOC_REFS.rpc]
  });
  addStep('rerun-readiness-gate', {
    execution: 'cli',
    phase: 'validation',
    title: 'Rerun the payment-readiness gate',
    rationale: 'The workflow is complete only when the strict policy passes on fresh evidence.',
    triggeredBy: [],
    safety: 'read_only',
    approval: 'not_required',
    requiredScope: null,
    command: 'npm run fiber-scope -- gate --snapshot snapshots/post-runbook.json',
    successCriteria: 'FiberScope Gate returns PASS with exit code 0.',
    docs: []
  });

  const steps = drafts.map((draft, index) => finalizeRunbookStep(draft, index, rpcUrl));
  const counts = countRunbookSteps(steps);
  const requiredScopes = [...new Set(steps.flatMap((step) => step.requiredScopes))];
  const authStep = steps.find((step) => step.key === 'repair-auth');
  if (authStep) {
    authStep.instruction = `Issue a short-lived Biscuit token with: ${requiredScopes.join(', ')}. Keep write scopes out of long-lived dashboard tokens.`;
    authStep.successCriteria = 'All scoped RPC checks return results instead of authorization errors.';
  }

  return {
    product: 'FiberScope',
    type: 'operator_runbook',
    executionPolicy: 'review_only',
    rpcUrl,
    network: inspection.network,
    node: {
      name: inspection.metrics.nodeName,
      pubkey: inspection.metrics.pubkey,
      status: inspection.status,
      score: inspection.score
    },
    bootstrapNode,
    verdict: gate.passed ? 'ready' : 'action_required',
    summary: gate.passed
      ? 'No remediation is required; recollect and keep the strict gate green.'
      : `${remediationStepCount} remediation step${remediationStepCount === 1 ? '' : 's'} before final validation.`,
    gate: {
      passed: gate.passed,
      failures: gate.failures.map((failure) => failure.id)
    },
    requiredScopes,
    counts,
    safetyNotice: 'Review-only plan. FiberScope does not execute RPCs, open channels, or send payments from this runbook.',
    steps
  };
}

export function renderConsoleRunbook(runbook) {
  const lines = [];
  lines.push(`FiberScope Operator Runbook: ${runbook.verdict.toUpperCase()}`);
  lines.push(`Node: ${runbook.node.name} (${runbook.node.status}, ${runbook.node.score}/100)`);
  lines.push(`Plan: ${runbook.summary}`);
  lines.push(`Safety: ${runbook.safetyNotice}`);
  lines.push(`Required scopes: ${runbook.requiredScopes.join(', ') || 'none'}`);
  lines.push('');

  for (const step of runbook.steps) {
    lines.push(`${step.sequence}. [${step.safetyLabel.toUpperCase()}] ${step.title}`);
    lines.push(`   Phase: ${step.phase} | Approval: ${step.approval} | Scope: ${step.scopeLabel}`);
    lines.push(`   Why: ${step.rationale}`);
    if (step.instruction) lines.push(`   Action: ${step.instruction}`);
    if (step.request) lines.push(`   RPC: ${JSON.stringify(step.request)}`);
    if (step.command) lines.push(`   Command: ${step.command}`);
    lines.push(`   Success: ${step.successCriteria}`);
  }

  return lines.join('\n');
}

export function renderMarkdownRunbook(runbook) {
  const lines = [];
  lines.push('# FiberScope Operator Runbook');
  lines.push('');
  lines.push(`- Verdict: **${runbook.verdict}**`);
  lines.push(`- Node: **${escapeCell(runbook.node.name)}** (${runbook.node.status}, ${runbook.node.score}/100)`);
  lines.push(`- Network: **${runbook.network ?? 'unknown'}**`);
  lines.push(`- RPC: \`${runbook.rpcUrl}\``);
  lines.push(`- Plan: ${runbook.summary}`);
  lines.push('');
  lines.push(`> ${runbook.safetyNotice}`);
  lines.push('');
  lines.push('## Safety Summary');
  lines.push('');
  lines.push('| Read only | Dry run | Reversible write | Funding write | Manual | Approval required |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: |');
  lines.push(`| ${runbook.counts.readOnly} | ${runbook.counts.dryRun} | ${runbook.counts.reversibleWrite} | ${runbook.counts.fundingWrite} | ${runbook.counts.manual} | ${runbook.counts.approvalRequired} |`);
  lines.push('');
  lines.push(`Required Biscuit scopes: ${runbook.requiredScopes.map((scope) => `\`${scope}\``).join(', ') || 'none'}`);
  lines.push('');
  lines.push('## Ordered Steps');
  lines.push('');
  lines.push('| # | Phase | Safety | Step | Trigger |');
  lines.push('| ---: | --- | --- | --- | --- |');
  for (const step of runbook.steps) {
    lines.push(`| ${step.sequence} | ${step.phase} | ${escapeCell(step.safetyLabel)} | ${escapeCell(step.title)} | ${step.triggeredBy.map((id) => `\`${id}\``).join(', ') || 'validation'} |`);
  }
  lines.push('');

  for (const step of runbook.steps) {
    lines.push(`### ${step.sequence}. ${step.title}`);
    lines.push('');
    lines.push(`**Why:** ${step.rationale}`);
    lines.push('');
    lines.push(`**Safety:** ${step.safetyLabel}; approval ${step.approval}; scope ${step.requiredScopes.length > 0 ? step.requiredScopes.map((scope) => `\`${scope}\``).join(', ') : 'none'}.`);
    lines.push('');
    if (step.instruction) {
      lines.push(step.instruction);
      lines.push('');
    }
    if (step.request) {
      lines.push('```json');
      lines.push(JSON.stringify(step.request, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('```bash');
      lines.push(step.curl);
      lines.push('```');
      lines.push('');
    }
    if (step.command) {
      lines.push('```bash');
      lines.push(step.command);
      lines.push('```');
      lines.push('');
    }
    lines.push(`**Success:** ${step.successCriteria}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function renderConsoleSummary(inspection) {
  const lines = [];
  lines.push(`FiberScope: ${inspection.status.toUpperCase()} (${inspection.score}/100)`);
  lines.push(`Node: ${inspection.metrics.nodeName} ${inspection.metrics.version} ${inspection.metrics.pubkey ? shortPubkey(inspection.metrics.pubkey) : ''}`.trim());
  lines.push(`Peers: ${inspection.metrics.peerCount} | Ready channels: ${inspection.metrics.activeChannelCount}/${inspection.metrics.channelCount} | Graph channels: ${inspection.metrics.graphChannelCount}`);
  lines.push(`Evidence: ${inspection.evidence.label}${inspection.capturedAt ? ` | Captured ${inspection.capturedAt}` : ''}${inspection.evidence.sanitized ? ' | sanitized' : ''}${inspection.evidence.bounded ? ' | bounded' : ''}`);
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
  lines.push(`- Evidence: **${inspection.evidence.label}**${inspection.evidence.sanitized ? ', sanitized' : ''}${inspection.evidence.bounded ? ', bounded' : ''}`);
  if (inspection.evidence.sourceDocument) lines.push(`- Provenance: \`${inspection.evidence.sourceDocument}\``);
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
  return STATUS_RANK[status] ?? 0;
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

function normalizeBootstrapNode(node) {
  if (!node?.pubkey) return null;
  const fundingAmount = node.fundingAmount === null || node.fundingAmount === undefined
    ? null
    : parseAmount(node.fundingAmount).toString();
  return {
    name: node.name ?? null,
    network: node.network ?? null,
    pubkey: node.pubkey,
    fundingAmount,
    fundingAmountHex: fundingAmount ? toRpcHex(fundingAmount) : null,
    fundingAmountLabel: fundingAmount ? formatAmount(fundingAmount) : null
  };
}

function paymentDryRunParams(targetPubkey, amount) {
  const maxFee = maxBigInt(parseAmount(amount) / 200n, 1000n);
  return {
    target_pubkey: targetPubkey,
    amount: toRpcHex(amount),
    keysend: true,
    dry_run: true,
    max_fee_amount: toRpcHex(maxFee)
  };
}

function finalizeRunbookStep(draft, index, rpcUrl) {
  const sequence = index + 1;
  const { method, params, requiredScope, requiredScopes: draftRequiredScopes, ...rest } = draft;
  const requiredScopes = draftRequiredScopes ?? (requiredScope ? [requiredScope] : []);
  const request = method
    ? {
        jsonrpc: '2.0',
        id: sequence,
        method,
        params: params ?? []
      }
    : null;
  return {
    id: `FS-RUN-${String(sequence).padStart(3, '0')}`,
    sequence,
    ...rest,
    method: method ?? null,
    requiredScope: requiredScopes.length === 1 ? requiredScopes[0] : null,
    requiredScopes,
    scopeLabel: requiredScopes.join(', ') || 'none',
    safetyLabel: runbookSafetyLabel(draft.safety),
    request,
    curl: request ? runbookCurlCommand(rpcUrl, request) : null
  };
}

function runbookSafetyLabel(safety) {
  const labels = {
    read_only: 'read only',
    dry_run: 'dry run, no transfer',
    reversible_write: 'reversible write',
    funding_write: 'funding write',
    manual: 'manual review'
  };
  return labels[safety] ?? safety;
}

function runbookCurlCommand(rpcUrl, request) {
  return `curl -s --location '${rpcUrl}' --header 'Content-Type: application/json' --data '${JSON.stringify(request)}'`;
}

function countRunbookSteps(steps) {
  const counts = {
    total: steps.length,
    readOnly: 0,
    dryRun: 0,
    reversibleWrite: 0,
    fundingWrite: 0,
    manual: 0,
    approvalRequired: 0
  };
  const keyBySafety = {
    read_only: 'readOnly',
    dry_run: 'dryRun',
    reversible_write: 'reversibleWrite',
    funding_write: 'fundingWrite',
    manual: 'manual'
  };
  for (const step of steps) {
    const key = keyBySafety[step.safety];
    if (key) counts[key] += 1;
    if (step.approval === 'required') counts.approvalRequired += 1;
  }
  return counts;
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

function normalizeGatePolicy(options) {
  return {
    minScore: numberOrDefault(options.minScore, 90),
    minStatus: normalizeStatus(options.minStatus ?? options.status ?? 'ready'),
    maxSeverity: normalizeSeverity(options.maxSeverity ?? 'info'),
    requireRouteReady: options.requireRouteReady !== false,
    requiredRpc: normalizeRequiredRpc(options.requiredRpc ?? DEFAULT_GATE_REQUIRED_RPC)
  };
}

function normalizeRequiredRpc(value) {
  const methods = Array.isArray(value)
    ? value
    : String(value ?? '').split(',');
  const cleaned = methods.map((method) => String(method).trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_GATE_REQUIRED_RPC];
}

function normalizeStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  return Object.hasOwn(STATUS_RANK, status) ? status : 'ready';
}

function normalizeSeverity(value) {
  const severity = String(value ?? '').trim().toLowerCase();
  return Object.hasOwn(SEVERITY_RANK, severity) ? severity : 'info';
}

function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
