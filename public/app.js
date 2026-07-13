import {
  diffSnapshots,
  formatAmount,
  inspectSnapshot,
  renderMarkdownReport,
  shortPubkey
} from '../src/core.js';
import {
  buildPublicNodeRunbook,
  listPublicNodePresets
} from '../src/presets.js';

const state = {
  baselineSnapshot: null,
  snapshot: null,
  inspection: null,
  diff: null
};

const elements = {
  file: document.querySelector('#snapshot-file'),
  baselineFile: document.querySelector('#baseline-file'),
  amount: document.querySelector('#amount-input'),
  download: document.querySelector('#download-report'),
  liveStatus: document.querySelector('#live-status'),
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
  metrics: document.querySelector('#metric-strip'),
  routeMethod: document.querySelector('#route-method'),
  routeVerdict: document.querySelector('#route-verdict'),
  routeEvidence: document.querySelector('#route-evidence'),
  findingCount: document.querySelector('#finding-count'),
  findings: document.querySelector('#findings-list'),
  channelCount: document.querySelector('#channel-count'),
  channels: document.querySelector('#channel-list'),
  rebalanceCount: document.querySelector('#rebalance-count'),
  rebalance: document.querySelector('#rebalance-output'),
  copyRebalance: document.querySelector('#copy-rebalance'),
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

const publicNodePresets = listPublicNodePresets();
let activePresetName = publicNodePresets.find((preset) => preset.network === 'testnet')?.name ?? publicNodePresets[0]?.name;

boot();

async function boot() {
  const [baselineResponse, response] = await Promise.all([
    fetch('../fixtures/no-peers-no-graph.json'),
    fetch('../fixtures/unbalanced-route-failure.json')
  ]);
  state.baselineSnapshot = await baselineResponse.json();
  state.snapshot = await response.json();
  wireEvents();
  render();
}

function wireEvents() {
  elements.amount.addEventListener('input', () => {
    renderLiveCommand();
    render();
  });
  elements.file.addEventListener('change', async () => {
    const file = elements.file.files?.[0];
    if (!file) return;
    state.snapshot = JSON.parse(await file.text());
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
  elements.copyRebalance.addEventListener('click', () => {
    copyText(elements.rebalance.textContent, 'Rebalance probe copied');
  });
  elements.copyPreset.addEventListener('click', () => {
    copyText(elements.presetRunbook.textContent, 'Public-node runbook copied');
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
    input.addEventListener('change', renderLiveCommand);
  }
  renderLiveCommand();
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
  renderFindings(inspection);
  renderChannels(inspection);
  renderRebalance(inspection);
  renderDiff(state.diff);
  renderPresets();
  renderRpc(inspection);
  renderLiveCommand();
}

async function collectLiveSnapshot() {
  const payload = liveCollectPayload();
  if (!payload.rpcUrl) {
    showToast('RPC URL required');
    return;
  }

  elements.collectLive.disabled = true;
  elements.collectLive.textContent = 'Collecting';
  elements.liveStatus.textContent = 'collecting';

  try {
    const response = await fetch('/api/collect', {
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
    elements.liveStatus.textContent = 'live snapshot';
    render();
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

function renderMetrics(inspection) {
  const metrics = [
    ['Peers', inspection.metrics.peerCount, 'connected', '#28d7d2'],
    ['Channels', `${inspection.metrics.activeChannelCount}/${inspection.metrics.channelCount}`, 'ready / total', '#4ade80'],
    ['Graph', inspection.metrics.graphChannelCount, `${inspection.metrics.graphNodeCount} nodes`, '#a78bfa'],
    ['Outbound', formatAmount(inspection.metrics.outboundCapacity), 'local liquidity', '#f4b740'],
    ['Inbound', formatAmount(inspection.metrics.inboundCapacity), 'remote liquidity', '#ff5c77']
  ];
  elements.metrics.innerHTML = metrics.map(([label, value, hint, accent]) => `
    <div class="metric" style="--accent:${accent}">
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
  elements.channelCount.textContent = `${inspection.channels.length} listed`;
  elements.channels.innerHTML = inspection.channels.map((channel) => {
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
