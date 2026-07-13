import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  diffSnapshots,
  evaluateReadinessGate,
  formatAmount,
  inspectSnapshot,
  parseAmount,
  renderConsoleGate,
  renderMarkdownDiff,
  renderMarkdownReport,
  toRpcHex
} from '../src/core.js';

function fixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

test('parses Fiber hex amounts and formats CKB units', () => {
  assert.equal(parseAmount('0xee6b2800'), 4000000000n);
  assert.equal(toRpcHex(4000000000n), '0xee6b2800');
  assert.equal(formatAmount('0xee6b2800'), '40 CKB');
});

test('finds route failure and circular rebalance candidate', () => {
  const inspection = inspectSnapshot(fixture('unbalanced-route-failure'));
  const ids = inspection.findings.map((finding) => finding.id);
  assert.equal(inspection.status, 'degraded');
  assert.ok(ids.includes('FS-ROUTE-DRYRUN-FAILED-001'));
  assert.ok(ids.includes('FS-LIQUIDITY-OUTBOUND-LOW-001'));
  assert.ok(ids.includes('FS-REBALANCE-CANDIDATE-001'));
  assert.equal(inspection.rebalanceSuggestions.length, 1);
  assert.equal(inspection.rebalanceSuggestions[0].automaticDryRun.method, 'send_payment');
});

test('recognizes Biscuit scope failures', () => {
  const inspection = inspectSnapshot(fixture('auth-permission-error'));
  assert.equal(inspection.status, 'blocked');
  assert.ok(inspection.findings.some((finding) => finding.id === 'FS-AUTH-SCOPE-001'));
});

test('marks a fresh node as blocked by missing peers and channels', () => {
  const inspection = inspectSnapshot(fixture('no-peers-no-graph'));
  const ids = inspection.findings.map((finding) => finding.id);
  assert.equal(inspection.status, 'blocked');
  assert.ok(ids.includes('FS-PEER-NONE-001'));
  assert.ok(ids.includes('FS-CHANNEL-NONE-001'));
});

test('keeps a healthy route-ready node high scoring', () => {
  const inspection = inspectSnapshot(fixture('healthy-ready'));
  assert.equal(inspection.status, 'ready');
  assert.ok(inspection.score >= 90);
  assert.equal(inspection.route.status, 'ready');
});

test('renders a submission-friendly markdown report', () => {
  const snapshot = fixture('unbalanced-route-failure');
  const report = renderMarkdownReport(snapshot, inspectSnapshot(snapshot));
  assert.match(report, /FiberScope Diagnostic Report/);
  assert.match(report, /FS-ROUTE-DRYRUN-FAILED-001/);
  assert.match(report, /Rebalance Candidates/);
});

test('diffs before and after snapshots into an operator narrative', () => {
  const diff = diffSnapshots(fixture('no-peers-no-graph'), fixture('unbalanced-route-failure'));
  const resolvedIds = diff.findings.resolved.map((finding) => finding.id);
  const introducedIds = diff.findings.introduced.map((finding) => finding.id);

  assert.equal(diff.verdict, 'improved');
  assert.equal(diff.statusChange.before, 'blocked');
  assert.equal(diff.statusChange.after, 'degraded');
  assert.ok(diff.scoreDelta > 0);
  assert.ok(resolvedIds.includes('FS-PEER-NONE-001'));
  assert.ok(resolvedIds.includes('FS-CHANNEL-NONE-001'));
  assert.ok(introducedIds.includes('FS-ROUTE-DRYRUN-FAILED-001'));
  assert.equal(diff.metricChanges.find((metric) => metric.key === 'peerCount').delta, '2');
});

test('renders a markdown snapshot diff', () => {
  const diff = diffSnapshots(fixture('no-peers-no-graph'), fixture('unbalanced-route-failure'));
  const report = renderMarkdownDiff(diff);

  assert.match(report, /FiberScope Snapshot Diff/);
  assert.match(report, /FS-PEER-NONE-001/);
  assert.match(report, /Graph channels/);
});

test('passes the strict readiness gate for a healthy dry-run snapshot', () => {
  const inspection = inspectSnapshot(fixture('healthy-ready'));
  const gate = evaluateReadinessGate(inspection);

  assert.equal(gate.passed, true);
  assert.equal(gate.verdict, 'pass');
  assert.equal(gate.failures.length, 0);
  assert.equal(gate.policy.minStatus, 'ready');
  assert.match(renderConsoleGate(gate), /FiberScope Gate: PASS/);
});

test('fails the readiness gate for degraded route and liquidity state', () => {
  const inspection = inspectSnapshot(fixture('unbalanced-route-failure'));
  const gate = evaluateReadinessGate(inspection);
  const failureIds = gate.failures.map((failure) => failure.id);

  assert.equal(gate.passed, false);
  assert.ok(failureIds.includes('FS-GATE-SCORE-001'));
  assert.ok(failureIds.includes('FS-GATE-STATUS-001'));
  assert.ok(failureIds.includes('FS-GATE-SEVERITY-001'));
  assert.ok(failureIds.includes('FS-GATE-ROUTE-001'));
  assert.ok(gate.blockingFindings.some((finding) => finding.id === 'FS-ROUTE-DRYRUN-FAILED-001'));
  assert.match(renderConsoleGate(gate), /FiberScope Gate: FAIL/);
});
