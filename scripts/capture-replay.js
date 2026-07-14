import fs from 'node:fs';
import path from 'node:path';
import { collectSnapshot } from '../src/rpc.js';
import { buildSanitizedReplay } from '../src/replay.js';

const options = parseArgs(process.argv.slice(2));
if (!options.rpcUrl) {
  console.error('Usage: npm run capture:replay -- --rpc <url> [--out <file>]');
  process.exit(1);
}

const snapshot = await collectSnapshot({
  rpcUrl: options.rpcUrl,
  graphLimit: options.graphLimit,
  graphPages: options.graphPages
});
const replay = buildSanitizedReplay(snapshot, {
  network: options.network,
  sourceLabel: options.sourceLabel
});
const output = path.resolve(options.out);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(replay, null, 2)}\n`);
console.log(`Wrote sanitized replay to ${path.relative(process.cwd(), output)}`);

function parseArgs(args) {
  const values = {
    out: 'fixtures/real-public-node-replay.json',
    graphLimit: 100,
    graphPages: 1,
    network: 'testnet',
    sourceLabel: 'replay:fiber-docs-public-node-2'
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--rpc') values.rpcUrl = value;
    else if (arg === '--out') values.out = value;
    else if (arg === '--graph-limit') values.graphLimit = Number(value);
    else if (arg === '--graph-pages') values.graphPages = Number(value);
    else if (arg === '--network') values.network = value;
    else if (arg === '--source-label') values.sourceLabel = value;
    else throw new Error(`Unknown option: ${arg}`);
    index += 1;
  }

  return values;
}
