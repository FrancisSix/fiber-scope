#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot } from './rpc.js';
import {
  buildPublicNodeRunbook,
  findPublicNodePreset,
  renderPublicNodePresetList,
  renderPublicNodeRunbook
} from './presets.js';
import {
  diffSnapshots,
  evaluateReadinessGate,
  inspectSnapshot,
  renderConsoleGate,
  renderConsoleSummary,
  renderConsoleDiff,
  renderMarkdownDiff,
  renderMarkdownReport
} from './core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const { options } = parseArgs(rest);

  if (command === 'help' || options.help) {
    printHelp();
    return;
  }

  if (command === 'inspect') {
    const snapshot = readSnapshot(requiredOption(options.snapshot, '--snapshot'));
    const inspection = inspectSnapshot(snapshot, { amount: options.amount });
    if (options.json) {
      console.log(JSON.stringify(inspection, bigintReplacer, 2));
    } else {
      console.log(renderConsoleSummary(inspection));
    }
    return;
  }

  if (command === 'report') {
    const snapshot = readSnapshot(requiredOption(options.snapshot, '--snapshot'));
    const inspection = inspectSnapshot(snapshot, { amount: options.amount });
    const report = renderMarkdownReport(snapshot, inspection);
    if (options.out) {
      ensureParent(options.out);
      fs.writeFileSync(options.out, report);
      console.log(`Wrote ${options.out}`);
    } else {
      console.log(report);
    }
    return;
  }

  if (command === 'gate') {
    const snapshot = readSnapshot(requiredOption(options.snapshot, '--snapshot'));
    const inspection = inspectSnapshot(snapshot, { amount: options.amount });
    const gate = evaluateReadinessGate(inspection, {
      minScore: options.minScore,
      minStatus: options.minStatus ?? options.status,
      maxSeverity: options.maxSeverity,
      requireRouteReady: !options.noRouteReady,
      requiredRpc: options.requiredRpc
    });
    if (options.json) {
      console.log(JSON.stringify(gate, null, 2));
    } else {
      console.log(renderConsoleGate(gate));
    }
    process.exitCode = gate.passed ? 0 : 2;
    return;
  }

  if (command === 'diff') {
    const before = readSnapshot(requiredOption(options.before, '--before'));
    const after = readSnapshot(requiredOption(options.after, '--after'));
    const diff = diffSnapshots(before, after, { amount: options.amount });
    if (options.json) {
      console.log(JSON.stringify(diff, bigintReplacer, 2));
    } else if (options.out) {
      ensureParent(options.out);
      fs.writeFileSync(options.out, renderMarkdownDiff(diff));
      console.log(`Wrote ${options.out}`);
    } else {
      console.log(renderConsoleDiff(diff));
    }
    return;
  }

  if (command === 'collect') {
    const snapshot = await collectSnapshot({
      rpcUrl: requiredOption(options.rpc, '--rpc'),
      authToken: options.authToken ?? options.token,
      graphLimit: options.graphLimit,
      graphPages: options.graphPages,
      amount: options.amount,
      targetPubkey: options.targetPubkey,
      selfRebalance: Boolean(options.selfRebalance),
      maxFeeAmount: options.maxFeeAmount
    });
    const out = options.out ?? 'fiber-scope-snapshot.json';
    ensureParent(out);
    fs.writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Wrote ${out}`);
    return;
  }

  if (command === 'presets') {
    if (options.node) {
      const preset = findPublicNodePreset(options.node, options.network ?? 'all');
      if (!preset) throw new Error(`Unknown public node preset: ${options.node}`);
      const runbook = buildPublicNodeRunbook(preset, {
        rpcUrl: options.rpc,
        fundingAmount: options.fundingAmount
      });
      if (options.json) {
        console.log(JSON.stringify(runbook, null, 2));
      } else {
        console.log(renderPublicNodeRunbook(runbook));
      }
    } else {
      console.log(renderPublicNodePresetList(options.network ?? 'all'));
    }
    return;
  }

  if (command === 'fixtures') {
    const fixtures = listFixtures();
    for (const fixture of fixtures) {
      console.log(`${fixture.name.padEnd(32)} ${fixture.title}`);
    }
    return;
  }

  printHelp();
}

function parseArgs(args) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const trimmed = arg.slice(2);
    if (trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      options[toCamel(key)] = valueParts.join('=');
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      options[toCamel(trimmed)] = next;
      index += 1;
    } else {
      options[toCamel(trimmed)] = true;
    }
  }
  return { options, positionals };
}

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function requiredOption(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function readSnapshot(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ensureParent(file) {
  const parent = path.dirname(path.resolve(file));
  fs.mkdirSync(parent, { recursive: true });
}

function listFixtures() {
  const dir = path.join(projectRoot, 'fixtures');
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const snapshot = readSnapshot(path.join(dir, file));
      return {
        name: file,
        title: snapshot.meta?.title ?? snapshot.meta?.description ?? ''
      };
    });
}

function printHelp() {
  console.log(`FiberScope

Usage:
  fiber-scope fixtures
  fiber-scope inspect --snapshot fixtures/unbalanced-route-failure.json
  fiber-scope inspect --snapshot fixtures/unbalanced-route-failure.json --json
  fiber-scope report --snapshot fixtures/unbalanced-route-failure.json --out reports/fiber-report.md
  fiber-scope gate --snapshot fixtures/healthy-ready.json
  fiber-scope diff --before fixtures/no-peers-no-graph.json --after fixtures/unbalanced-route-failure.json
  fiber-scope presets --network testnet
  fiber-scope presets --node fiber-testnet-public-bottle --rpc http://127.0.0.1:8227
  fiber-scope collect --rpc http://127.0.0.1:8227 --out snapshots/node.json

Useful collect flags:
  --auth-token <token>       Biscuit bearer token for protected RPC
  --graph-limit <n>          graph_nodes and graph_channels page size
  --graph-pages <n>          max graph pages to follow, default 5
  --amount <hex>             amount for route dry run, for example 0x2540be400
  --target-pubkey <pubkey>   target for send_payment dry_run
  --self-rebalance           dry-run a circular payment to this node pubkey

Useful gate flags:
  --min-score <n>             minimum readiness score, default 90
  --min-status <status>       blocked, degraded, or ready; default ready
  --max-severity <severity>   info, warning, or critical; default info
  --no-route-ready            do not require a successful route dry run
  --required-rpc <methods>    comma-separated required RPC evidence

Useful preset flags:
  --network <mainnet|testnet>  Filter public node presets
  --node <name|pubkey>         Generate connect/open/list runbook
  --rpc <url>                  RPC URL for generated runbook
  --funding-amount <amount>    Override channel funding amount
`);
}

function bigintReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}
