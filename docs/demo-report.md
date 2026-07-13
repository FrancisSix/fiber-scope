# FiberScope Diagnostic Report

- Status: **degraded**
- Score: **82/100**
- Source: `fixture:unbalanced-route-failure`
- Captured: `2026-07-13T15:30:00.000Z`
- Target amount: `0x2540be400`

## Node Snapshot

| Metric | Value |
| --- | --- |
| Node | alpha-operator |
| Version | 0.8.0 |
| Pubkey | `02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| Peers | 2 |
| Ready channels | 2/2 |
| Graph nodes/channels | 3/2 |
| Outbound capacity | 940 CKB |
| Inbound capacity | 860 CKB |

## Findings

| Severity | Fingerprint | Finding | Evidence | Next action |
| --- | --- | --- | --- | --- |
| warning | `FS-LIQUIDITY-OUTBOUND-LOW-001` | Outbound liquidity is thin on ready channels | 02cccccc...cccccc local=40 CKB (5%) requested=100 CKB | Try a smaller dry-run amount, open an additional funded channel, or rebalance from an outbound-heavy channel. |
| warning | `FS-ROUTE-DRYRUN-FAILED-001` | Route dry run failed | No router could be built for amount 0x2540be400: insufficient outbound capacity on selected first hop | Lower the amount, rebalance channels, or open a better-funded outbound channel, then rerun dry_run. |
| info | `FS-REBALANCE-CANDIDATE-001` | Circular rebalance candidate found | 03bbbbbb...bbbbbb -> 02cccccc...cccccc for about 100 CKB | Run the generated self-payment dry run, cap fees, then execute only if the route and fee are acceptable. |

## Rebalance Candidates

### 03bbbbbb...bbbbbb -> 02cccccc...cccccc

Suggested amount: `0x2540be400` (100 CKB)

Automatic circular dry run:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
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

Manual route probe:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "build_router",
  "params": [
    {
      "amount": "0x2540be400",
      "hops_info": [
        {
          "pubkey": "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        },
        {
          "pubkey": "02cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
        },
        {
          "pubkey": "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
      ]
    }
  ]
}
```

## RPC Coverage

| Method | Status | Diagnostic scope |
| --- | --- | --- |
| `node_info` | ok | `read("node")` |
| `list_peers` | ok | `read("peers")` |
| `list_channels` | ok | `read("channels")` |
| `graph_nodes` | ok | `read("graph")` |
| `graph_channels` | ok | `read("graph")` |
| `build_router` | missing | `read("payments")` |
| `send_payment_dry_run` | error | `write("payments") for dry-run send_payment` |

## Source Notes

- Fiber rebalancing uses self-payments with `allow_self_payment: true` and should be tested with `dry_run: true` first.
- Fiber gossip exposes public topology, not real-time channel balances, so route success still depends on local and remote liquidity.
- Fiber v0.8 RPCs use pubkeys instead of peer IDs for peer and channel operations.