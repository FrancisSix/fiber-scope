# FiberScope Operator Runbook

- Verdict: **action_required**
- Node: **alpha-operator** (degraded, 82/100)
- Network: **testnet**
- RPC: `http://127.0.0.1:8227`
- Plan: 2 remediation steps before final validation.

> Review-only plan. FiberScope does not execute RPCs, open channels, or send payments from this runbook.

## Safety Summary

| Read only | Dry run | Reversible write | Funding write | Manual | Approval required |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 2 | 0 | 0 | 0 | 0 |

Required Biscuit scopes: `write("payments")`, `read("node")`, `read("peers")`, `read("channels")`, `read("graph")`

## Ordered Steps

| # | Phase | Safety | Step | Trigger |
| ---: | --- | --- | --- | --- |
| 1 | liquidity | dry run, no transfer | Rehearse a reduced target amount | `FS-LIQUIDITY-OUTBOUND-LOW-001`, `FS-ROUTE-DRYRUN-FAILED-001` |
| 2 | liquidity | dry run, no transfer | Rehearse the circular rebalance candidate | `FS-REBALANCE-CANDIDATE-001` |
| 3 | validation | read only | Collect fresh post-action evidence | validation |
| 4 | validation | read only | Rerun the payment-readiness gate | validation |

### 1. Rehearse a reduced target amount

**Why:** A smaller dry run separates first-hop liquidity pressure from complete route unavailability.

**Safety:** dry run, no transfer; approval review; scope `write("payments")`.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "send_payment",
  "params": [
    {
      "target_pubkey": "02dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "amount": "0x12a05f200",
      "keysend": true,
      "dry_run": true,
      "max_fee_amount": "0x17d7840"
    }
  ]
}
```

```bash
curl -s --location 'http://127.0.0.1:8227' --header 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"send_payment","params":[{"target_pubkey":"02dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","amount":"0x12a05f200","keysend":true,"dry_run":true,"max_fee_amount":"0x17d7840"}]}'
```

**Success:** send_payment dry_run builds a route for 50 CKB within the generated fee cap.

### 2. Rehearse the circular rebalance candidate

**Why:** The channel pair has complementary imbalance that may be corrected by a self-payment.

**Safety:** dry run, no transfer; approval review; scope `write("payments")`.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "send_payment",
  "params": [
    {
      "target_pubkey": "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "amount": "0x2540be400",
      "keysend": true,
      "allow_self_payment": true,
      "dry_run": true,
      "max_fee_amount": "0x2faf080"
    }
  ]
}
```

```bash
curl -s --location 'http://127.0.0.1:8227' --header 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":2,"method":"send_payment","params":[{"target_pubkey":"02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","amount":"0x2540be400","keysend":true,"allow_self_payment":true,"dry_run":true,"max_fee_amount":"0x2faf080"}]}'
```

**Success:** The 100 CKB self-payment dry run returns an acceptable circular route and fee.

### 3. Collect fresh post-action evidence

**Why:** Every action should be verified from a new node snapshot rather than inferred from the RPC response alone.

**Safety:** read only; approval not_required; scope `read("node")`, `read("peers")`, `read("channels")`, `read("graph")`, `write("payments")`.

```bash
npm run fiber-scope -- collect --rpc http://127.0.0.1:8227 --out snapshots/post-runbook.json --graph-limit 200 --graph-pages 5 --amount 0x2540be400 --target-pubkey 02dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
```

**Success:** A fresh snapshots/post-runbook.json contains node, peer, channel, graph, and route evidence.

### 4. Rerun the payment-readiness gate

**Why:** The workflow is complete only when the strict policy passes on fresh evidence.

**Safety:** read only; approval not_required; scope none.

```bash
npm run fiber-scope -- gate --snapshot snapshots/post-runbook.json
```

**Success:** FiberScope Gate returns PASS with exit code 0.
