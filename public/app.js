import {
  buildRemediationRunbook,
  diffSnapshots,
  evaluateReadinessGate,
  formatAmount,
  inspectSnapshot,
  renderMarkdownReport,
  renderMarkdownRunbook,
  shortPubkey
} from '../src/core.js';
import {
  buildPublicNodeRunbook,
  listPublicNodePresets
} from '../src/presets.js';

const state = {
  scenarioId: 'real-public-node',
  baselineSnapshot: null,
  snapshot: null,
  inspection: null,
  diff: null,
  runbook: null,
  selectedRunbookStepId: null,
  liveRpcAvailable: false
};

const elements = {
  scenario: document.querySelector('#scenario-select'),
  file: document.querySelector('#snapshot-file'),
  baselineFile: document.querySelector('#baseline-file'),
  amount: document.querySelector('#amount-input'),
  download: document.querySelector('#download-report'),
  openLive: document.querySelector('#open-live'),
  closeLive: document.querySelector('#close-live'),
  liveDialog: document.querySelector('#live-dialog'),
  liveStatus: document.querySelector('#live-status'),
  networkName: document.querySelector('#network-name'),
  snapshotOrigin: document.querySelector('#snapshot-origin'),
  snapshotLabel: document.querySelector('#snapshot-label'),
  liveRpcUrl: document.querySelector('#live-rpc-url'),
  liveAuthToken: document.querySelector('#live-auth-token'),
  liveTargetPubkey: document.querySelector('#live-target-pubkey'),
  liveGraphPages: document.querySelector('#live-graph-pages'),
  liveSelfRebalance: document.querySelector('#live-self-rebalance'),
  collectLive: document.querySelector('#collect-live'),
  liveCommand: document.querySelector('#live-command'),
  status: document.querySelector('#status-pill'),
  score: document.querySelector('#score-value'),
  scoreRing: document.querySelector('#score-ring'),
  nodeName: document.querySelector('#node-name'),
  nodePubkey: document.querySelector('#node-pubkey'),
  nodeFacts: document.querySelector('#node-facts'),
  snapshotProvenance: document.querySelector('#snapshot-provenance'),
  metrics: document.querySelector('#metric-strip'),
  routeMethod: document.querySelector('#route-method'),
  routeVerdict: document.querySelector('#route-verdict'),
  routeEvidence: document.querySelector('#route-evidence'),
  topologyCanvas: document.querySelector('#topology-canvas'),
  topologyNodeCount: document.querySelector('#topology-node-count'),
  topologyChannelCount: document.querySelector('#topology-channel-count'),
  findingCount: document.querySelector('#finding-count'),
  findings: document.querySelector('#findings-list'),
  channelCount: document.querySelector('#channel-count'),
  channels: document.querySelector('#channel-list'),
  rebalanceCount: document.querySelector('#rebalance-count'),
  rebalance: document.querySelector('#rebalance-output'),
  copyRebalance: document.querySelector('#copy-rebalance'),
  gateCount: document.querySelector('#gate-count'),
  gateSummary: document.querySelector('#gate-summary'),
  gateFailures: document.querySelector('#gate-failures'),
  runbookCount: document.querySelector('#runbook-count'),
  runbookSummary: document.querySelector('#runbook-summary'),
  runbookSteps: document.querySelector('#runbook-steps'),
  runbookStepType: document.querySelector('#runbook-step-type'),
  runbookStepTitle: document.querySelector('#runbook-step-title'),
  runbookPreview: document.querySelector('#runbook-preview'),
  runbookSuccess: document.querySelector('#runbook-success'),
  copyRunbook: document.querySelector('#copy-runbook'),
  copyRunbookStep: document.querySelector('#copy-runbook-step'),
  exportRunbook: document.querySelector('#export-runbook'),
  diffCount: document.querySelector('#diff-count'),
  diffSummary: document.querySelector('#diff-summary'),
  diffMetrics: document.querySelector('#diff-metrics'),
  diffFindings: document.querySelector('#diff-findings'),
  presetCount: document.querySelector('#preset-count'),
  presetList: document.querySelector('#preset-list'),
  presetRunbook: document.querySelector('#preset-runbook'),
  copyPreset: document.querySelector('#copy-preset'),
  rpcCount: document.querySelector('#rpc-count'),
  rpc: document.querySelector('#rpc-coverage'),
  toast: document.querySelector('#toast')
};

const snapshotScenarios = [
  {
    id: 'real-public-node',
    snapshot: './fixtures/real-public-node-replay.json',
    baseline: './fixtures/no-peers-no-graph.json'
  },
  {
    id: 'route-blocked',
    snapshot: './fixtures/unbalanced-route-failure.json',
    baseline: './fixtures/no-peers-no-graph.json'
  },
  {
    id: 'route-ready',
    snapshot: './fixtures/healthy-ready.json',
    baseline: './fixtures/unbalanced-route-failure.json'
  },
  {
    id: 'fresh-node',
    snapshot: './fixtures/no-peers-no-graph.json',
    baseline: './fixtures/no-peers-no-graph.json'
  },
  {
    id: 'auth-scope',
    snapshot: './fixtures/auth-permission-error.json',
    baseline: './fixtures/no-peers-no-graph.json'
  }
];

const maxRenderedChannels = 24;

const publicNodePresets = listPublicNodePresets();
let activePresetName = publicNodePresets.find((preset) => preset.network === 'testnet')?.name ?? publicNodePresets[0]?.name;
let topologyResizeObserver;

boot();

async function boot() {
  const scenario = scenarioById(state.scenarioId);
  const [baselineSnapshot, snapshot, liveRpcAvailable] = await Promise.all([
    fetchSnapshot(scenario.baseline),
    fetchSnapshot(scenario.snapshot),
    detectLocalCollector()
  ]);
  state.baselineSnapshot = baselineSnapshot;
  state.snapshot = snapshot;
  state.liveRpcAvailable = liveRpcAvailable;
  elements.scenario.value = state.scenarioId;
  wireEvents();
  renderRuntimeMode();
  observeTopology();
  render();
}

async function fetchSnapshot(snapshotPath) {
  const response = await fetch(snapshotPath);
  if (!response.ok) throw new Error(`Snapshot request failed with HTTP ${response.status}`);
  return response.json();
}

function scenarioById(id) {
  return snapshotScenarios.find((scenario) => scenario.id === id) ?? snapshotScenarios[0];
}

async function loadScenario(id) {
  const scenario = scenarioById(id);
  elements.scenario.disabled = true;
  try {
    const [baselineSnapshot, snapshot] = await Promise.all([
      fetchSnapshot(scenario.baseline),
      fetchSnapshot(scenario.snapshot)
    ]);
    state.scenarioId = scenario.id;
    state.baselineSnapshot = baselineSnapshot;
    state.snapshot = snapshot;
    state.selectedRunbookStepId = null;
    render();
    showToast('Scenario loaded');
  } catch (error) {
    showToast(error.message.slice(0, 120));
  } finally {
    elements.scenario.disabled = false;
  }
}

function markCustomScenario(label) {
  let option = elements.scenario.querySelector('[value="custom"]');
  if (!option) {
    option = document.createElement('option');
    option.value = 'custom';
    option.disabled = true;
    elements.scenario.prepend(option);
  }
  option.textContent = label;
  elements.scenario.value = 'custom';
  state.scenarioId = null;
}

async function detectLocalCollector() {
  try {
    const response = await fetch(new URL('api/health', document.baseURI), {
      headers: { accept: 'application/json' }
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body.ok === true && body.product === 'FiberScope';
  } catch {
    return false;
  }
}

function renderRuntimeMode() {
  if (state.liveRpcAvailable) {
    elements.openLive.textContent = 'Connect RPC';
    elements.openLive.title = 'Connect through the local FiberScope collector';
    elements.liveStatus.textContent = 'Fixture mode';
    return;
  }

  elements.openLive.textContent = 'Local RPC only';
  elements.openLive.title = 'Run npm run dashboard locally to connect an FNN RPC endpoint';
  elements.openLive.disabled = true;
  elements.collectLive.disabled = true;
  elements.liveStatus.textContent = 'Hosted fixture demo';
}

function wireEvents() {
  for (const link of document.querySelectorAll('.rail-link')) {
    link.addEventListener('click', () => setActiveRailLink(link.getAttribute('href')));
  }
  window.addEventListener('hashchange', () => setActiveRailLink(window.location.hash));
  setActiveRailLink(window.location.hash);
  elements.scenario.addEventListener('change', () => {
    if (elements.scenario.value !== 'custom') loadScenario(elements.scenario.value);
  });
  elements.amount.addEventListener('input', () => {
    renderLiveCommand();
    render();
  });
  elements.file.addEventListener('change', async () => {
    const file = elements.file.files?.[0];
    if (!file) return;
    state.snapshot = JSON.parse(await file.text());
    markCustomScenario('Uploaded snapshot');
    elements.liveStatus.textContent = 'uploaded snapshot';
    render();
  });
  elements.baselineFile.addEventListener('change', async () => {
    const file = elements.baselineFile.files?.[0];
    if (!file) return;
    state.baselineSnapshot = JSON.parse(await file.text());
    render();
  });
  elements.download.addEventListener('click', () => {
    const report = renderMarkdownReport(state.snapshot, state.inspection);
    const blob = new Blob([report], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'fiber-scope-report.md';
    link.click();
    URL.revokeObjectURL(link.href);
  });
  elements.openLive.addEventListener('click', () => {
    if (!state.liveRpcAvailable) return;
    elements.liveDialog.showModal();
  });
  elements.closeLive.addEventListener('click', () => {
    elements.liveDialog.close();
  });
  elements.liveDialog.addEventListener('click', (event) => {
    if (event.target === elements.liveDialog) elements.liveDialog.close();
  });
  elements.copyRebalance.addEventListener('click', () => {
    copyText(elements.rebalance.textContent, 'Rebalance probe copied');
  });
  elements.copyPreset.addEventListener('click', () => {
    copyText(elements.presetRunbook.textContent, 'Public-node runbook copied');
  });
  elements.copyRunbook.addEventListener('click', () => {
    if (!state.runbook) return;
    copyText(renderMarkdownRunbook(state.runbook), 'Operator runbook copied');
  });
  elements.copyRunbookStep.addEventListener('click', () => {
    copyText(elements.runbookPreview.textContent, 'Runbook step copied');
  });
  elements.exportRunbook.addEventListener('click', () => {
    if (!state.runbook) return;
    downloadText('fiber-scope-runbook.md', renderMarkdownRunbook(state.runbook), 'text/markdown');
  });
  elements.collectLive.addEventListener('click', collectLiveSnapshot);

  for (const input of [
    elements.liveRpcUrl,
    elements.liveAuthToken,
    elements.liveTargetPubkey,
    elements.liveGraphPages,
    elements.liveSelfRebalance
  ]) {
    input.addEventListener('input', renderLiveCommand);
    input.addEventListener('change', () => {
      renderLiveCommand();
      if (input === elements.liveRpcUrl && state.inspection) renderRunbook(state.inspection);
    });
  }
  renderLiveCommand();
}

function setActiveRailLink(hash) {
  const target = hash || '#overview';
  for (const link of document.querySelectorAll('.rail-link')) {
    link.classList.toggle('active', link.getAttribute('href') === target);
  }
}

function render() {
  if (!state.snapshot) return;
  state.inspection = inspectSnapshot(state.snapshot, {
    amount: elements.amount.value.trim()
  });
  state.diff = state.baselineSnapshot ? diffSnapshots(state.baselineSnapshot, state.snapshot, {
    amount: elements.amount.value.trim()
  }) : null;
  const inspection = state.inspection;
  const ringColor = statusColor(inspection.status);

  document.body.dataset.status = inspection.status;
  elements.networkName.textContent = inspection.network ?? 'network unknown';
  elements.snapshotLabel.textContent = inspection.source;
  renderSnapshotProvenance(inspection);
  elements.status.textContent = inspection.status;
  elements.status.className = `status-pill ${inspection.status}`;
  elements.score.textContent = inspection.score;
  elements.scoreRing.style.setProperty('--score-deg', `${Math.max(0, Math.min(100, inspection.score)) * 3.6}deg`);
  elements.scoreRing.style.setProperty('--ring-color', ringColor);
  elements.nodeName.textContent = inspection.metrics.nodeName;
  elements.nodePubkey.textContent = inspection.metrics.pubkey ? shortPubkey(inspection.metrics.pubkey) : 'pubkey unavailable';

  renderNodeFacts(inspection);
  renderMetrics(inspection);
  renderRoute(inspection);
  renderTopology(state.snapshot, inspection);
  renderFindings(inspection);
  renderChannels(inspection);
  renderRebalance(inspection);
  renderGate(inspection);
  renderRunbook(inspection);
  renderDiff(state.diff);
  renderPresets();
  renderRpc(inspection);
  renderLiveCommand();
}

async function collectLiveSnapshot() {
  if (!state.liveRpcAvailable) {
    showToast('Live RPC collection is available in the local dashboard');
    return;
  }

  const payload = liveCollectPayload();
  if (!payload.rpcUrl) {
    showToast('RPC URL required');
    return;
  }

  elements.collectLive.disabled = true;
  elements.collectLive.textContent = 'Collecting';
  elements.liveStatus.textContent = 'collecting';

  try {
    const response = await fetch(new URL('api/collect', document.baseURI), {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      throw new Error(body.error?.message ?? `Collector returned HTTP ${response.status}`);
    }

    state.baselineSnapshot = state.snapshot;
    state.snapshot = body.snapshot;
    markCustomScenario('Live FNN capture');
    elements.liveStatus.textContent = 'live snapshot';
    render();
    elements.liveDialog.close();
    showToast('Live snapshot collected');
  } catch (error) {
    elements.liveStatus.textContent = 'collect failed';
    showToast(error.message.slice(0, 120));
  } finally {
    elements.collectLive.disabled = false;
    elements.collectLive.textContent = 'Collect Live';
  }
}

function liveCollectPayload() {
  const token = elements.liveAuthToken.value.trim();
  return {
    rpcUrl: elements.liveRpcUrl.value.trim(),
    authToken: token || undefined,
    graphLimit: 200,
    graphPages: Number(elements.liveGraphPages.value || 5),
    amount: elements.amount.value.trim() || undefined,
    targetPubkey: elements.liveTargetPubkey.value.trim() || undefined,
    selfRebalance: elements.liveSelfRebalance.checked
  };
}

function renderLiveCommand() {
  if (!elements.liveCommand) return;
  const payload = liveCollectPayload();
  const parts = [
    'npm run fiber-scope -- collect',
    '--rpc',
    shellQuote(payload.rpcUrl || 'http://127.0.0.1:8227'),
    '--out',
    'snapshots/live-node.json',
    '--graph-limit',
    String(payload.graphLimit),
    '--graph-pages',
    String(payload.graphPages || 5)
  ];

  if (payload.amount) {
    parts.push('--amount', shellQuote(payload.amount));
  }
  if (payload.authToken) {
    parts.push('--auth-token', '<biscuit-token>');
  }
  if (payload.targetPubkey) {
    parts.push('--target-pubkey', shellQuote(payload.targetPubkey));
  }
  if (payload.selfRebalance) {
    parts.push('--self-rebalance');
  }

  elements.liveCommand.textContent = parts.join(' ');
}

function renderNodeFacts(inspection) {
  const facts = [
    ['Version', inspection.metrics.version],
    ['Source', inspection.source],
    ['Target', inspection.intent.targetPubkey ? shortPubkey(inspection.intent.targetPubkey) : 'none'],
    ['Amount', inspection.intent.amount ?? 'none']
  ];

  elements.nodeFacts.innerHTML = facts.map(([label, value]) => `
    <div class="node-fact">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `).join('');
}

function renderSnapshotProvenance(inspection) {
  const evidence = inspection.evidence;
  const rpcOk = inspection.rpcCoverage.filter((item) => item.status === 'ok').length;
  elements.snapshotOrigin.textContent = evidence.label;
  elements.snapshotOrigin.className = `snapshot-origin ${evidence.kind}`;

  if (evidence.kind === 'real_capture') {
    const counts = evidence.observedCounts;
    const nodePagination = evidence.pagination.graphNodes ?? {};
    const channelPagination = evidence.pagination.graphChannels ?? {};
    elements.liveStatus.textContent = state.liveRpcAvailable ? 'Real replay' : 'Hosted real replay';
    elements.snapshotProvenance.innerHTML = `
      <div class="snapshot-provenance-head">
        <span>Sanitized real capture</span>
        <strong>${escapeHtml(formatCapturedAt(evidence.capturedAt))}</strong>
      </div>
      <p>${escapeHtml(evidence.nodeLabel)} · FNN ${escapeHtml(evidence.fnnVersion)} · ${evidence.bounded ? 'bounded graph replay' : 'complete graph replay'} · ${escapeHtml(evidence.sourceDocument ?? 'source documented')}</p>
      <div class="snapshot-provenance-grid">
        <div><span>Peers</span><strong>${escapeHtml(String(counts.connectedPeers ?? inspection.metrics.peerCount))}</strong></div>
        <div><span>Non-closed</span><strong>${escapeHtml(String(counts.includedChannels ?? inspection.metrics.channelCount))}</strong></div>
        <div><span>Graph cap</span><strong>${escapeHtml(`${nodePagination.included ?? inspection.metrics.graphNodeCount} / ${channelPagination.included ?? inspection.metrics.graphChannelCount}`)}</strong></div>
      </div>
    `;
    return;
  }

  if (evidence.kind === 'deterministic_fixture') {
    elements.liveStatus.textContent = state.liveRpcAvailable ? 'Fixture mode' : 'Hosted fixture demo';
  } else if (evidence.kind === 'live_capture') {
    elements.liveStatus.textContent = 'Live snapshot';
  } else {
    elements.liveStatus.textContent = 'Loaded snapshot';
  }

  elements.snapshotProvenance.innerHTML = `
    <div class="snapshot-provenance-head">
      <span>${escapeHtml(evidence.label)}</span>
      <strong>${escapeHtml(evidence.capturedAt ? formatCapturedAt(evidence.capturedAt) : 'Bundled scenario')}</strong>
    </div>
    <p>${evidence.kind === 'deterministic_fixture' ? 'Deterministic evidence for repeatable diagnostics and regression review.' : 'Snapshot evidence processed by the shared FiberScope analyzer.'}</p>
    <div class="snapshot-provenance-grid">
      <div><span>RPC</span><strong>${rpcOk}/${inspection.rpcCoverage.length}</strong></div>
      <div><span>Route</span><strong>${escapeHtml(routeLabel(inspection.route.status))}</strong></div>
      <div><span>Findings</span><strong>${inspection.findings.length}</strong></div>
    </div>
  `;
}

function formatCapturedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? 'not recorded');
  return `${date.toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })} UTC`;
}

function renderMetrics(inspection) {
  const metrics = [
    ['Peers', inspection.metrics.peerCount, 'connected'],
    ['Channels', `${inspection.metrics.activeChannelCount}/${inspection.metrics.channelCount}`, 'ready / total'],
    ['Graph', inspection.metrics.graphChannelCount, `${inspection.metrics.graphNodeCount} nodes`],
    ['Outbound', formatAmount(inspection.metrics.outboundCapacity), 'local liquidity'],
    ['Inbound', formatAmount(inspection.metrics.inboundCapacity), 'remote liquidity']
  ];
  elements.metrics.innerHTML = metrics.map(([label, value, hint]) => `
    <div class="metric metric-${label.toLowerCase()}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(hint)}</small>
    </div>
  `).join('');
}

function renderRoute(inspection) {
  const route = inspection.route;
  elements.routeMethod.textContent = route.method ?? 'snapshot';
  elements.routeVerdict.textContent = routeLabel(route.status);
  elements.routeVerdict.className = `route-verdict ${route.status}`;
  elements.routeEvidence.textContent = route.evidence ?? route.reason ?? 'No route evidence captured.';
}

function observeTopology() {
  if (!('ResizeObserver' in window) || !elements.topologyCanvas) return;
  topologyResizeObserver = new ResizeObserver(() => {
    if (!state.snapshot || !state.inspection) return;
    requestAnimationFrame(() => renderTopology(state.snapshot, state.inspection));
  });
  topologyResizeObserver.observe(elements.topologyCanvas.parentElement);
}

function renderTopology(snapshot, inspection) {
  const canvas = elements.topologyCanvas;
  if (!canvas) return;
  const container = canvas.parentElement;
  const width = Math.max(320, Math.floor(container.clientWidth));
  const height = Math.max(230, Math.floor(container.clientHeight));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.setAttribute('aria-label', `${inspection.metrics.graphNodeCount} Fiber nodes and ${inspection.metrics.graphChannelCount} public channels`);

  const context = canvas.getContext('2d');
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  drawTopologyGrid(context, width, height);

  const graphNodes = snapshotResultList(snapshot, 'graph_nodes', 'nodes');
  const graphChannels = snapshotResultList(snapshot, 'graph_channels', 'channels');
  const ownPubkey = inspection.metrics.pubkey;
  const targetPubkey = inspection.intent.targetPubkey;
  const visible = selectTopology(graphNodes, graphChannels, ownPubkey, targetPubkey);
  const positions = topologyPositions(visible.nodes, ownPubkey, targetPubkey, width, height);
  const routedChannels = new Set(
    (inspection.route.routes ?? [])
      .flatMap((route) => route.nodes ?? [])
      .map((node) => node.channel_outpoint)
      .filter(Boolean)
  );

  if (ownPubkey && targetPubkey && positions.has(ownPubkey) && positions.has(targetPubkey)) {
    drawIntentPath(context, positions.get(ownPubkey), positions.get(targetPubkey), inspection.route.status);
  }

  for (const channel of visible.channels) {
    const start = positions.get(channel.node1);
    const end = positions.get(channel.node2);
    if (!start || !end) continue;
    drawChannel(context, start, end, routedChannels.has(channel.channel_outpoint));
  }

  for (const node of visible.nodes) {
    const position = positions.get(node.pubkey);
    if (!position) continue;
    const role = node.pubkey === ownPubkey ? 'self' : node.pubkey === targetPubkey ? 'target' : 'peer';
    drawTopologyNode(context, position, node, role);
  }

  elements.topologyNodeCount.textContent = inspection.metrics.graphNodeCount;
  elements.topologyChannelCount.textContent = inspection.metrics.graphChannelCount;
}

function snapshotResultList(snapshot, method, field) {
  const entry = snapshot?.rpc?.[method];
  if (!entry || entry.error || entry.ok === false) return [];
  const result = Object.hasOwn(entry, 'result') ? entry.result : entry;
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.[field]) ? result[field] : [];
}

function selectTopology(graphNodes, graphChannels, ownPubkey, targetPubkey) {
  const nodeByPubkey = new Map();
  for (const node of graphNodes) {
    if (node?.pubkey) nodeByPubkey.set(node.pubkey, node);
  }
  for (const channel of graphChannels) {
    for (const pubkey of [channel?.node1, channel?.node2]) {
      if (pubkey && !nodeByPubkey.has(pubkey)) nodeByPubkey.set(pubkey, { pubkey });
    }
  }
  if (ownPubkey && !nodeByPubkey.has(ownPubkey)) nodeByPubkey.set(ownPubkey, { pubkey: ownPubkey, node_name: 'This node' });
  if (targetPubkey && !nodeByPubkey.has(targetPubkey)) nodeByPubkey.set(targetPubkey, { pubkey: targetPubkey, node_name: 'Payment target' });

  const prioritizedChannels = [
    ...graphChannels.filter((channel) => channel.node1 === ownPubkey || channel.node2 === ownPubkey),
    ...graphChannels.filter((channel) => channel.node1 !== ownPubkey && channel.node2 !== ownPubkey)
  ].slice(0, 12);
  const selectedKeys = new Set([ownPubkey, targetPubkey].filter(Boolean));
  for (const channel of prioritizedChannels) {
    if (selectedKeys.size >= 10) break;
    if (channel.node1) selectedKeys.add(channel.node1);
    if (channel.node2) selectedKeys.add(channel.node2);
  }
  for (const pubkey of nodeByPubkey.keys()) {
    if (selectedKeys.size >= 10) break;
    selectedKeys.add(pubkey);
  }

  return {
    nodes: [...selectedKeys].map((pubkey) => nodeByPubkey.get(pubkey) ?? { pubkey }),
    channels: prioritizedChannels.filter((channel) => selectedKeys.has(channel.node1) && selectedKeys.has(channel.node2))
  };
}

function topologyPositions(nodes, ownPubkey, targetPubkey, width, height) {
  const positions = new Map();
  const centerY = height * 0.5;
  if (ownPubkey) positions.set(ownPubkey, { x: width * 0.16, y: centerY });
  if (targetPubkey) positions.set(targetPubkey, { x: width * 0.84, y: centerY });

  const peers = nodes.filter((node) => node.pubkey !== ownPubkey && node.pubkey !== targetPubkey);
  const radiusX = Math.min(width * 0.23, 190);
  const radiusY = Math.min(height * 0.31, 84);
  peers.forEach((node, index) => {
    const angle = peers.length === 1
      ? 0
      : (-Math.PI / 2) + (index * Math.PI * 2) / peers.length;
    positions.set(node.pubkey, {
      x: width * 0.51 + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY
    });
  });
  return positions;
}

function drawTopologyGrid(context, width, height) {
  context.save();
  context.strokeStyle = 'rgba(127, 145, 154, 0.08)';
  context.lineWidth = 1;
  for (let x = 20.5; x < width; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 20.5; y < height; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();
}

function drawIntentPath(context, start, end, status) {
  const color = status === 'ready' ? '#4ee0a1' : status === 'failed' ? '#ff6b6b' : '#f0b95d';
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.48;
  context.lineWidth = 1.5;
  context.setLineDash([7, 7]);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.bezierCurveTo(start.x + 90, start.y - 70, end.x - 90, end.y - 70, end.x, end.y);
  context.stroke();
  context.restore();
}

function drawChannel(context, start, end, routed) {
  context.save();
  context.strokeStyle = routed ? '#4ee0a1' : '#4ecdc4';
  context.globalAlpha = routed ? 0.88 : 0.38;
  context.lineWidth = routed ? 3 : 1.5;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  const midpointX = (start.x + end.x) / 2;
  const midpointY = (start.y + end.y) / 2;
  context.fillStyle = routed ? '#4ee0a1' : '#8fa7ae';
  context.globalAlpha = routed ? 1 : 0.72;
  context.beginPath();
  context.arc(midpointX, midpointY, routed ? 3.5 : 2.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawTopologyNode(context, position, node, role) {
  const colors = {
    self: '#4ecdc4',
    peer: '#d5e0e2',
    target: '#f0b95d'
  };
  const color = colors[role];
  const radius = role === 'self' ? 9 : role === 'target' ? 8 : 6;
  context.save();
  context.fillStyle = color;
  context.globalAlpha = 0.12;
  context.beginPath();
  context.arc(position.x, position.y, radius + 12, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
  context.fillStyle = '#091013';
  context.strokeStyle = color;
  context.lineWidth = role === 'self' ? 3 : 2;
  context.beginPath();
  context.arc(position.x, position.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  const name = node.node_name ?? node.nodeName ?? (role === 'self' ? 'THIS NODE' : role === 'target' ? 'TARGET' : shortPubkey(node.pubkey));
  context.font = '600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.fillStyle = role === 'peer' ? '#8fa1a8' : color;
  context.fillText(String(name).slice(0, 20), position.x, position.y + radius + 18);
  context.restore();
}

function renderFindings(inspection) {
  elements.findingCount.textContent = `${inspection.findings.length} total`;
  elements.findings.innerHTML = inspection.findings.map((finding) => `
    <article class="finding ${finding.severity}">
      <div class="finding-head">
        <div>
          <strong>${escapeHtml(finding.title)}</strong>
          <code>${escapeHtml(finding.id)}</code>
        </div>
        <span class="severity-tag">${escapeHtml(finding.severity)}</span>
      </div>
      <p>${escapeHtml(finding.evidence)}</p>
      <p>${escapeHtml(finding.recommendation)}</p>
    </article>
  `).join('') || '<p class="empty-state">No findings for this snapshot.</p>';
}

function renderChannels(inspection) {
  const displayedChannels = inspection.channels.slice(0, maxRenderedChannels);
  elements.channelCount.textContent = inspection.channels.length > displayedChannels.length
    ? `${displayedChannels.length} of ${inspection.channels.length} shown`
    : `${inspection.channels.length} listed`;
  elements.channels.innerHTML = displayedChannels.map((channel) => {
    const percent = Math.max(0, Math.min(100, Math.round(channel.localRatio * 100)));
    return `
      <article class="channel-row">
        <div class="channel-top">
          <strong>${escapeHtml(shortPubkey(channel.pubkey))}</strong>
          <span class="channel-state">${escapeHtml(channel.stateName)}</span>
        </div>
        <div class="split-track" style="--local-width:${percent}%">
          <span></span>
        </div>
        <div class="channel-bottom">
          <span>${escapeHtml(channel.localLabel)} local</span>
          <span>${escapeHtml(channel.remoteLabel)} remote</span>
        </div>
      </article>
    `;
  }).join('') || '<p class="empty-state">No channels captured.</p>';
}

function renderRebalance(inspection) {
  elements.rebalanceCount.textContent = `${inspection.rebalanceSuggestions.length} candidates`;
  if (inspection.rebalanceSuggestions.length === 0) {
    elements.rebalance.textContent = 'No circular rebalance candidate in this snapshot.';
    return;
  }
  elements.rebalance.textContent = JSON.stringify(inspection.rebalanceSuggestions[0].automaticDryRun, null, 2);
}

function renderGate(inspection) {
  const gate = evaluateReadinessGate(inspection);
  elements.gateCount.textContent = gate.passed ? 'pass' : `${gate.failures.length} blockers`;
  elements.gateSummary.className = `gate-summary ${gate.verdict}`;
  elements.gateSummary.innerHTML = `
    <div>
      <strong>${escapeHtml(gate.verdict)}</strong>
      <span>${escapeHtml(gate.summary)}</span>
    </div>
    <div class="gate-score">${escapeHtml(String(gate.node.score))}</div>
  `;
  elements.gateFailures.innerHTML = gate.failures.map((failure) => `
    <article class="gate-failure">
      <code>${escapeHtml(failure.id)}</code>
      <strong>${escapeHtml(failure.title)}</strong>
      <p>${escapeHtml(failure.evidence)}</p>
    </article>
  `).join('') || `
    <article class="gate-failure pass">
      <code>FS-GATE-PASS-001</code>
      <strong>Payment readiness checks passed</strong>
      <p>Score, status, route dry run, severity, and required RPC evidence satisfy the default gate.</p>
    </article>
  `;
}

function renderRunbook(inspection) {
  let activePreset = publicNodePresets.find((preset) => preset.name === activePresetName) ?? publicNodePresets[0];
  if (inspection.network && activePreset?.network !== inspection.network) {
    activePreset = publicNodePresets.find((preset) => preset.network === inspection.network) ?? activePreset;
    activePresetName = activePreset?.name;
  }
  state.runbook = buildRemediationRunbook(inspection, {
    rpcUrl: elements.liveRpcUrl.value.trim() || 'http://127.0.0.1:8227',
    bootstrapNode: activePreset ? {
      name: activePreset.name,
      network: activePreset.network,
      pubkey: activePreset.pubkey,
      fundingAmount: activePreset.openChannelFundingAmount
    } : null
  });

  const runbook = state.runbook;
  const selectedExists = runbook.steps.some((step) => step.id === state.selectedRunbookStepId);
  if (!selectedExists) state.selectedRunbookStepId = runbook.steps[0]?.id ?? null;
  const selected = runbook.steps.find((step) => step.id === state.selectedRunbookStepId) ?? runbook.steps[0];

  elements.runbookCount.textContent = `${runbook.steps.length} ordered steps`;
  elements.runbookSummary.innerHTML = `
    <div class="runbook-verdict ${escapeHtml(runbook.verdict)}">
      <span>${escapeHtml(runbook.verdict.replace('_', ' '))}</span>
      <strong>${escapeHtml(runbook.summary)}</strong>
    </div>
    <div class="runbook-stats">
      <div><strong>${runbook.counts.dryRun}</strong><span>dry runs</span></div>
      <div><strong>${runbook.counts.approvalRequired}</strong><span>write approvals</span></div>
      <div><strong>${runbook.counts.readOnly}</strong><span>read only</span></div>
      <div><strong>${runbook.requiredScopes.length}</strong><span>scopes</span></div>
    </div>
    <p>${escapeHtml(runbook.safetyNotice)}</p>
  `;

  elements.runbookSteps.innerHTML = runbook.steps.map((step) => `
    <button class="runbook-step ${step.id === selected?.id ? 'active' : ''}" data-runbook-step="${escapeHtml(step.id)}" type="button">
      <span class="runbook-sequence">${String(step.sequence).padStart(2, '0')}</span>
      <span class="runbook-step-copy">
        <small>${escapeHtml(step.phase)} / ${escapeHtml(step.method ?? step.execution)}</small>
        <strong>${escapeHtml(step.title)}</strong>
        <em>${escapeHtml(step.triggeredBy.join(', ') || 'final validation')}</em>
      </span>
      <span class="runbook-safety ${escapeHtml(step.safety)}">${escapeHtml(step.safetyLabel)}</span>
    </button>
  `).join('');

  for (const button of elements.runbookSteps.querySelectorAll('[data-runbook-step]')) {
    button.addEventListener('click', () => {
      state.selectedRunbookStepId = button.dataset.runbookStep;
      renderRunbook(inspection);
    });
  }

  renderRunbookInspector(selected);
}

function renderRunbookInspector(step) {
  if (!step) {
    elements.runbookStepType.textContent = 'no step';
    elements.runbookStepTitle.textContent = 'No runbook steps available';
    elements.runbookPreview.textContent = '';
    elements.runbookSuccess.innerHTML = '';
    return;
  }

  elements.runbookStepType.textContent = `${step.id} / ${step.scopeLabel}`;
  elements.runbookStepTitle.textContent = step.title;
  elements.runbookPreview.textContent = runbookStepPreview(step);
  elements.runbookSuccess.innerHTML = `
    <span>Required outcome</span>
    <strong>${escapeHtml(step.successCriteria)}</strong>
  `;
}

function runbookStepPreview(step) {
  if (step.request) {
    return `${JSON.stringify(step.request, null, 2)}\n\n# curl\n${step.curl}`;
  }
  return step.command ?? step.instruction ?? step.rationale;
}

function renderDiff(diff) {
  if (!diff) {
    elements.diffCount.textContent = 'no baseline';
    elements.diffSummary.innerHTML = '<p class="empty-state">Load a before snapshot to compare node readiness.</p>';
    elements.diffMetrics.innerHTML = '';
    elements.diffFindings.innerHTML = '';
    return;
  }

  const scoreSign = diff.scoreDelta > 0 ? '+' : '';
  elements.diffCount.textContent = `${diff.statusChange.before} -> ${diff.statusChange.after}`;
  elements.diffSummary.innerHTML = `
    <div>
      <strong>${escapeHtml(diff.verdict)}</strong>
      <span>${escapeHtml(diff.before.metrics.nodeName)} -> ${escapeHtml(diff.after.metrics.nodeName)}</span>
      <small> route ${escapeHtml(diff.routeChange.before)} -> ${escapeHtml(diff.routeChange.after)}</small>
    </div>
    <div class="diff-score ${escapeHtml(diff.verdict)}">${scoreSign}${escapeHtml(String(diff.scoreDelta))}</div>
  `;

  const interesting = ['peerCount', 'activeChannelCount', 'graphChannelCount', 'outboundCapacity'];
  elements.diffMetrics.innerHTML = diff.metricChanges
    .filter((metric) => interesting.includes(metric.key))
    .map((metric) => `
      <div class="diff-metric">
        <span>${escapeHtml(metric.label)}</span>
        <strong>${escapeHtml(metric.deltaLabel)}</strong>
        <small>${escapeHtml(metric.beforeLabel)} -> ${escapeHtml(metric.afterLabel)}</small>
      </div>
    `).join('');

  const findingRows = [
    ...diff.findings.resolved.slice(0, 3).map((finding) => ['resolved', finding]),
    ...diff.findings.introduced.slice(0, 3).map((finding) => ['introduced', finding]),
    ...diff.findings.persistent.slice(0, 2).map((finding) => ['persistent', finding])
  ];

  elements.diffFindings.innerHTML = findingRows.map(([type, finding]) => `
    <article class="diff-chip ${type}">
      <span>${escapeHtml(type)}</span>
      <code>${escapeHtml(finding.id)}</code>
      <p>${escapeHtml(finding.title)}</p>
    </article>
  `).join('') || '<p class="empty-state">No finding changes.</p>';
}

function renderPresets() {
  const activePreset = publicNodePresets.find((preset) => preset.name === activePresetName) ?? publicNodePresets[0];
  elements.presetCount.textContent = `${publicNodePresets.length} nodes`;
  elements.presetList.innerHTML = publicNodePresets.map((preset) => `
    <button class="preset-card ${preset.name === activePreset.name ? 'active' : ''}" data-preset="${escapeHtml(preset.name)}" type="button">
      <strong>${escapeHtml(preset.region)}</strong>
      <span>${escapeHtml(preset.network)} / ${escapeHtml(formatAmount(preset.openChannelFundingAmount))}</span>
    </button>
  `).join('');

  for (const button of elements.presetList.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => {
      activePresetName = button.dataset.preset;
      renderPresets();
      if (state.inspection) renderRunbook(state.inspection);
    });
  }

  const runbook = buildPublicNodeRunbook(activePreset);
  elements.presetRunbook.textContent = JSON.stringify({
    node: `${activePreset.network}/${activePreset.name}`,
    connect_peer: runbook.steps[0].request,
    open_channel: runbook.steps[1].request,
    collect: runbook.followUp.collect
  }, null, 2);
}

function renderRpc(inspection) {
  const okCount = inspection.rpcCoverage.filter((item) => item.status === 'ok').length;
  elements.rpcCount.textContent = `${okCount}/${inspection.rpcCoverage.length} ok`;
  elements.rpc.innerHTML = inspection.rpcCoverage.map((item) => `
    <div class="rpc-item">
      <code>${escapeHtml(item.method)}</code>
      <span class="rpc-status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
    </div>
  `).join('');
}

function routeLabel(status) {
  if (status === 'ready') return 'dry run ready';
  if (status === 'failed') return 'route blocked';
  if (status === 'not_captured') return 'not probed';
  return status ?? 'unknown';
}

function statusColor(status) {
  if (status === 'ready') return '#4ade80';
  if (status === 'blocked') return '#ff5c77';
  return '#f4b740';
}

async function copyText(text, message) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.append(textArea);
    textArea.select();
    document.execCommand('copy');
    textArea.remove();
  }
  showToast(message);
}

function downloadText(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => {
    elements.toast.classList.remove('visible');
  }, 1800);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shellQuote(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `"${text.replace(/(["\\$`])/g, '\\$1')}"`;
}
