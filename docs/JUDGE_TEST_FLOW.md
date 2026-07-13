# Judge Test Flow

This flow validates FiberScope from a clean public clone. It requires Node.js 20 or newer and does not require an FNN node for the deterministic review path.

## Acceptance Criteria

| Check | Expected result |
| --- | --- |
| Clean verification | exit `0`, 24 tests pass, 0 fail |
| Healthy readiness gate | exit `0`, status `ready`, score `100/100` |
| Degraded readiness gate | exit `2` with explicit policy blockers |
| Dashboard | fixture loads with score `82`, 3 topology nodes, 2 graph channels |
| Runbook | four ordered steps; generated payment actions use `dry_run: true` |
| Evidence | before/after diff, rebalance candidate, RPC coverage, public-node presets |

## 1. Clone And Verify

```bash
git clone https://github.com/FrancisSix/fiber-scope.git
cd fiber-scope
node --version
npm run verify
```

`npm run verify` runs the test suite, exercises the CLI, regenerates reference artifacts, and builds `dist/`. The command must exit `0`.

![Clean clone and verification output](judge-flow/01-clean-clone-verify.png)

## 2. Test The Gate Contract

Run the passing fixture:

```bash
npm run fiber-scope -- gate --snapshot fixtures/healthy-ready.json
```

Expected: `FiberScope Gate: PASS` and exit `0`.

Run the blocked fixture:

```bash
npm run fiber-scope -- gate --snapshot fixtures/unbalanced-route-failure.json
```

Expected: `FiberScope Gate: FAIL` and exit `2`. This failure is intentional; it proves that degraded readiness blocks automation.

![Passing and blocked readiness gates](judge-flow/02-readiness-gates.png)

## 3. Start The Dashboard

```bash
npm run dashboard
```

Open `http://127.0.0.1:4173/`. The server must report `FiberScope dashboard` and bind to `127.0.0.1`.

The hosted fixture-only equivalent is https://francissix.github.io/fiber-scope/.

## 4. Review Route Readiness

On **Overview**, confirm:

- source is `fixture:unbalanced-route-failure`;
- readiness is `degraded`, score `82/100`;
- the topology contains the local node, two public peers, and the payment target;
- route evidence reports insufficient outbound capacity;
- local and remote liquidity totals are visible.

![Topology and route-readiness overview](judge-flow/03-dashboard-overview.png)

## 5. Inspect The Runbook

Open **Runbook** and select **Rehearse the circular rebalance candidate**.

Confirm that the selected step:

- is labeled `dry run, no transfer`;
- uses `send_payment`;
- sets `allow_self_payment: true`;
- sets `dry_run: true`;
- includes a measurable required outcome.

![Safety-labeled circular rebalance runbook](judge-flow/04-operator-runbook.png)

## 6. Review Evidence

Open **Evidence** and confirm:

- snapshot progress is `blocked -> degraded` with a `+30` score change;
- peer, ready-channel, graph-channel, and outbound-capacity deltas are shown;
- resolved and introduced finding IDs are separated;
- the rebalance probe remains a dry run;
- RPC coverage and public-node presets are present below the fold.

![Snapshot diff and rebalance evidence](judge-flow/05-evidence-and-diff.png)

## 7. Optional Live FNN Check

Live collection is local-only. Start the dashboard, select **Connect RPC**, and provide an operator-controlled FNN endpoint. The hosted demo intentionally has no collector API.

CLI equivalent:

```bash
npm run fiber-scope -- collect \
  --rpc http://127.0.0.1:8227 \
  --out snapshots/judge-node.json \
  --graph-limit 100 \
  --graph-pages 1
```

Do not provide `--amount`, `--target-pubkey`, or `--self-rebalance` for a strictly read-only collection.

## Capture Provenance

The terminal images are rendered from output captured during a clean clone of application commit `66daeb3`. The clone passed verification without workspace files or cached package dependencies. The dashboard images were captured from that clone on `127.0.0.1:4180`; the alternate port avoided the development server already running on `4173`.
