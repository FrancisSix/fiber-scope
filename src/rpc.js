export async function collectSnapshot(options) {
  const rpcUrl = required(options.rpcUrl, 'rpcUrl');
  const graphLimit = Number(options.graphLimit ?? 200);
  const graphPages = Number(options.graphPages ?? 5);
  const headers = {
    'content-type': 'application/json'
  };
  if (options.authToken) {
    headers.authorization = `Bearer ${options.authToken}`;
  }

  let nextId = 1;
  const call = async (method, params = []) => {
    const body = {
      jsonrpc: '2.0',
      id: nextId,
      method,
      params
    };
    nextId += 1;
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        return {
          ok: false,
          error: {
            code: response.status,
            message: `Non-JSON RPC response: ${text.slice(0, 200)}`
          }
        };
      }
      if (!response.ok && !payload.error) {
        return {
          ok: false,
          error: {
            code: response.status,
            message: payload.message ?? response.statusText
          }
        };
      }
      if (payload.error) return { ok: false, error: payload.error };
      return { ok: true, result: payload.result };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'NETWORK',
          message: error.message
        }
      };
    }
  };

  const rpc = {
    node_info: await call('node_info'),
    list_peers: await call('list_peers'),
    list_channels: await call('list_channels', [{ include_closed: true }]),
    graph_nodes: await collectGraphPages(call, {
      method: 'graph_nodes',
      listKey: 'nodes',
      graphLimit,
      graphPages
    }),
    graph_channels: await collectGraphPages(call, {
      method: 'graph_channels',
      listKey: 'channels',
      graphLimit,
      graphPages
    })
  };

  if (options.targetPubkey || options.selfRebalance) {
    const nodeInfo = rpc.node_info?.result ?? {};
    const target = options.selfRebalance ? nodeInfo.pubkey : options.targetPubkey;
    if (target && options.amount) {
      rpc.send_payment_dry_run = await call('send_payment', [{
        target_pubkey: target,
        amount: options.amount,
        keysend: true,
        allow_self_payment: Boolean(options.selfRebalance),
        dry_run: true,
        max_fee_amount: options.maxFeeAmount
      }].map((params) => removeUndefined(params)));
    }
  }

  return {
    meta: {
      source: rpcUrl,
      capturedAt: new Date().toISOString(),
      graphLimit,
      graphPages,
      requestedAmount: options.amount ?? null,
      targetPubkey: options.targetPubkey ?? null
    },
    intent: {
      amount: options.amount ?? null,
      targetPubkey: options.targetPubkey ?? null,
      selfRebalance: Boolean(options.selfRebalance)
    },
    rpc
  };
}

async function collectGraphPages(call, options) {
  const limit = Math.max(1, Number(options.graphLimit ?? 200));
  const maxPages = Math.max(1, Number(options.graphPages ?? 5));
  const items = [];
  const cursors = [];
  let after;
  let lastCursor;
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    const params = removeUndefined({ limit, after });
    const response = await call(options.method, [params]);
    if (!response.ok) return response;

    const result = response.result ?? {};
    const pageItems = Array.isArray(result[options.listKey]) ? result[options.listKey] : [];
    items.push(...pageItems);
    lastCursor = result.last_cursor ?? null;
    cursors.push(lastCursor);

    if (pageItems.length === 0 || !lastCursor || lastCursor === after || pageItems.length < limit) {
      return {
        ok: true,
        result: {
          [options.listKey]: items,
          last_cursor: lastCursor,
          pages: page + 1,
          truncated: false,
          cursors
        }
      };
    }

    after = lastCursor;
    truncated = page === maxPages - 1;
  }

  return {
    ok: true,
    result: {
      [options.listKey]: items,
      last_cursor: lastCursor,
      pages: maxPages,
      truncated,
      cursors
    }
  };
}

function required(value, name) {
  if (!value) throw new Error(`Missing required option: ${name}`);
  return value;
}

function removeUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
