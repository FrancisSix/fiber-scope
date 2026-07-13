import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPublicNodeRunbook,
  findPublicNodePreset,
  listPublicNodePresets,
  renderPublicNodePresetList,
  renderPublicNodeRunbook
} from '../src/presets.js';

test('lists mainnet and testnet public node presets', () => {
  const all = listPublicNodePresets();
  const testnet = listPublicNodePresets('testnet');

  assert.equal(all.length, 4);
  assert.equal(testnet.length, 2);
  assert.ok(all.some((preset) => preset.name === 'fiber-mainnet-public-ca'));
  assert.ok(testnet.every((preset) => preset.network === 'testnet'));
});

test('generates Fiber v0.8 pubkey connect and open-channel runbook', () => {
  const preset = findPublicNodePreset('fiber-testnet-public-bottle');
  const runbook = buildPublicNodeRunbook(preset, {
    rpcUrl: 'http://127.0.0.1:8227'
  });

  assert.equal(runbook.fundingAmountHex, '0xb9e459300');
  assert.equal(runbook.steps[0].request.method, 'connect_peer');
  assert.deepEqual(runbook.steps[0].request.params, [{ pubkey: preset.pubkey }]);
  assert.equal(runbook.steps[1].request.method, 'open_channel');
  assert.equal(runbook.steps[1].request.params[0].funding_amount, '0xb9e459300');
  assert.equal(runbook.steps[1].request.params[0].public, true);
  assert.match(runbook.followUp.collect, /fiber-scope -- collect/);
});

test('renders preset list and selected runbook for CLI review', () => {
  const list = renderPublicNodePresetList('mainnet');
  const runbook = renderPublicNodeRunbook(buildPublicNodeRunbook(findPublicNodePreset('bracer')));

  assert.match(list, /fiber-mainnet-public-ca/);
  assert.match(list, /499 CKB/);
  assert.match(runbook, /connect_peer/);
  assert.match(runbook, /open_channel/);
});
