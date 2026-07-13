import { spawnSync } from 'node:child_process';

const node = process.execPath;

const commands = [
  [node, ['--test']],
  [node, ['./src/cli.js', 'fixtures']],
  [node, ['./src/cli.js', 'presets', '--network', 'testnet']],
  [node, ['./src/cli.js', 'inspect', '--snapshot', 'fixtures/unbalanced-route-failure.json']],
  [node, ['./src/cli.js', 'report', '--snapshot', 'fixtures/unbalanced-route-failure.json', '--out', 'docs/demo-report.md']],
  [node, ['./src/cli.js', 'diff', '--before', 'fixtures/no-peers-no-graph.json', '--after', 'fixtures/unbalanced-route-failure.json', '--out', 'docs/demo-diff.md']],
  [node, ['./scripts/demo-transcript.js']]
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    stdio: 'inherit'
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
