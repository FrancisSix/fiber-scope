import { formatAmount, toRpcHex } from './core.js';

export const PUBLIC_NODE_PRESETS = [
  {
    network: 'mainnet',
    name: 'fiber-mainnet-public-ca',
    region: 'CA',
    pubkey: '03a8d7da8d0934363dbc17f52c872e8d833016415266eabb3527439c5dd17adc6b',
    ckbAddress: 'ckb1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqdjsydf39sklhfvtfnk57vvd7d2vn4kxwqpr3prn',
    openChannelFundingAmount: '49900000000',
    autoAcceptChannelCkbFundingAmount: '25000000000',
    expectedLocalLiquidity: '40000000000',
    expectedRemoteLiquidity: '15100000000',
    udt: {
      symbol: 'USDI',
      autoAcceptAmount: '10000000',
      script: {
        code_hash: '0xbfa35a9c38a676682b65ade8f02be164d48632281477e36f8dc2f41f79e56bfc',
        hash_type: 'type',
        args: '0xd591ebdc69626647e056e13345fd830c8b876bb06aa07ba610479eb77153ea9f'
      },
      note: 'Mainnet public nodes do not currently hold USDI liquidity for UDT channels.'
    }
  },
  {
    network: 'mainnet',
    name: 'fiber-mainnet-public-tokyo',
    region: 'Tokyo',
    pubkey: '033a69e5be369dab43aefa96fa729d83c571ccb066f312136c6ab2d354fcc028f9',
    ckbAddress: 'ckb1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqv47n6dc9ay34npwktvlpp5huzjvd07t4qhspqyz',
    openChannelFundingAmount: '49900000000',
    autoAcceptChannelCkbFundingAmount: '25000000000',
    expectedLocalLiquidity: '40000000000',
    expectedRemoteLiquidity: '15100000000',
    udt: {
      symbol: 'USDI',
      autoAcceptAmount: '10000000',
      script: {
        code_hash: '0xbfa35a9c38a676682b65ade8f02be164d48632281477e36f8dc2f41f79e56bfc',
        hash_type: 'type',
        args: '0xd591ebdc69626647e056e13345fd830c8b876bb06aa07ba610479eb77153ea9f'
      },
      note: 'Mainnet public nodes do not currently hold USDI liquidity for UDT channels.'
    }
  },
  {
    network: 'testnet',
    name: 'fiber-testnet-public-bottle',
    region: 'Bottle',
    pubkey: '02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71',
    ckbAddress: 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfy4w0gqjsm0ulnq0l4ft6hu6spztrj72sjtcnx4',
    openChannelFundingAmount: '49900000000',
    autoAcceptChannelCkbFundingAmount: '25000000000',
    expectedLocalLiquidity: '40000000000',
    expectedRemoteLiquidity: '15100000000',
    udt: {
      symbol: 'RUSD',
      autoAcceptAmount: '2000000000',
      script: {
        code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
        hash_type: 'type',
        args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b'
      }
    }
  },
  {
    network: 'testnet',
    name: 'fiber-testnet-public-bracer',
    region: 'Bracer',
    pubkey: '0291a6576bd5a94bd74b27080a48340875338fff9f6d6361fe6b8db8d0d1912fcc',
    ckbAddress: 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwgkulmcyxtv2vgcmgatupg2r02k8n4mjcmm9f5m',
    openChannelFundingAmount: '49900000000',
    autoAcceptChannelCkbFundingAmount: '25000000000',
    expectedLocalLiquidity: '40000000000',
    expectedRemoteLiquidity: '15100000000',
    udt: {
      symbol: 'RUSD',
      autoAcceptAmount: '2000000000',
      script: {
        code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
        hash_type: 'type',
        args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b'
      }
    }
  }
];

export function listPublicNodePresets(network = 'all') {
  if (!network || network === 'all') return [...PUBLIC_NODE_PRESETS];
  return PUBLIC_NODE_PRESETS.filter((preset) => preset.network === network);
}

export function findPublicNodePreset(nameOrPubkey, network = 'all') {
  const normalized = String(nameOrPubkey ?? '').toLowerCase();
  return listPublicNodePresets(network).find((preset) => (
    preset.name.toLowerCase() === normalized
    || preset.pubkey.toLowerCase() === normalized
    || preset.region.toLowerCase() === normalized
  ));
}

export function buildPublicNodeRunbook(preset, options = {}) {
  if (!preset) throw new Error('Missing public node preset');
  const rpcUrl = options.rpcUrl ?? 'http://127.0.0.1:8227';
  const fundingAmount = options.fundingAmount ?? preset.openChannelFundingAmount;
  const connectPeer = rpcCall(1, 'connect_peer', [{
    pubkey: preset.pubkey
  }]);
  const openChannel = rpcCall(2, 'open_channel', [{
    pubkey: preset.pubkey,
    funding_amount: toRpcHex(fundingAmount),
    public: true
  }]);
  const listChannels = rpcCall(3, 'list_channels', [{
    pubkey: preset.pubkey
  }]);

  return {
    preset,
    rpcUrl,
    fundingAmount: String(fundingAmount),
    fundingAmountHex: toRpcHex(fundingAmount),
    fundingAmountLabel: formatAmount(fundingAmount),
    expectedLocalLiquidityLabel: formatAmount(preset.expectedLocalLiquidity),
    expectedRemoteLiquidityLabel: formatAmount(preset.expectedRemoteLiquidity),
    steps: [
      {
        name: 'connect_peer',
        description: 'Connect to the public node by pubkey. Fiber v0.8 resolves addresses from gossip or saved peer state.',
        request: connectPeer,
        curl: curlCommand(rpcUrl, connectPeer)
      },
      {
        name: 'open_channel',
        description: 'Open a public CKB channel at the documented auto-accept funding amount.',
        request: openChannel,
        curl: curlCommand(rpcUrl, openChannel)
      },
      {
        name: 'list_channels',
        description: 'Wait until the channel reaches ChannelReady before route dry runs.',
        request: listChannels,
        curl: curlCommand(rpcUrl, listChannels)
      }
    ],
    followUp: {
      collect: `npm run fiber-scope -- collect --rpc ${rpcUrl} --out snapshots/${preset.network}-${preset.region.toLowerCase()}.json --graph-limit 200 --graph-pages 5`
    }
  };
}

export function renderPublicNodePresetList(network = 'all') {
  const presets = listPublicNodePresets(network);
  const lines = ['Fiber public node presets:', ''];
  for (const preset of presets) {
    lines.push(`${preset.network}/${preset.name}`);
    lines.push(`  pubkey: ${preset.pubkey}`);
    lines.push(`  CKB funding: ${formatAmount(preset.openChannelFundingAmount)} -> expected local ${formatAmount(preset.expectedLocalLiquidity)}, remote ${formatAmount(preset.expectedRemoteLiquidity)}`);
    lines.push(`  UDT: ${preset.udt.symbol} auto-accept ${preset.udt.autoAcceptAmount}`);
    lines.push('');
  }
  lines.push('Runbook: fiber-scope presets --node <name> --rpc http://127.0.0.1:8227');
  return lines.join('\n');
}

export function renderPublicNodeRunbook(runbook) {
  const lines = [];
  lines.push(`Fiber public node runbook: ${runbook.preset.network}/${runbook.preset.name}`);
  lines.push(`RPC: ${runbook.rpcUrl}`);
  lines.push(`Funding: ${runbook.fundingAmountLabel} (${runbook.fundingAmountHex})`);
  lines.push(`Expected initial channel balance: local ${runbook.expectedLocalLiquidityLabel}, remote ${runbook.expectedRemoteLiquidityLabel}`);
  lines.push('');
  for (const step of runbook.steps) {
    lines.push(`${step.name}:`);
    lines.push(JSON.stringify(step.request, null, 2));
    lines.push('');
  }
  lines.push('Follow-up diagnostic snapshot:');
  lines.push(runbook.followUp.collect);
  return lines.join('\n');
}

function rpcCall(id, method, params) {
  return {
    id,
    jsonrpc: '2.0',
    method,
    params
  };
}

function curlCommand(rpcUrl, request) {
  const payload = JSON.stringify(request);
  return `curl -s --location '${rpcUrl}' --header 'Content-Type: application/json' --data '${payload}'`;
}
