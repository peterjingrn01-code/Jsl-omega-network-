const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Omega-Key"
};

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_MESSAGE_TTL_MS = 10 * 60 * 1000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });

const now = () => new Date().toISOString();

async function sha256(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function coordFromHash(hash) {
  return {
    x: BigInt("0x" + hash.slice(0, 16)).toString(),
    y: BigInt("0x" + hash.slice(16, 32)).toString(),
    z: BigInt("0x" + hash.slice(32, 48)).toString()
  };
}

function b64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function authorized(request, env) {
  if (!env.OMEGA_NETWORK_KEY) return true;
  return request.headers.get("X-Omega-Key") === env.OMEGA_NETWORK_KEY;
}

function safeJson(value, fallback = null) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

async function getNode(env, nodeId) {
  return env.DB.prepare(`
    SELECT node_id,device_name,device_type,omega_id,x,y,z,status,last_seen,public_key
    FROM omega_nodes WHERE node_id=?
  `).bind(nodeId).first();
}

async function importSignPublic(publicBundle) {
  if (!publicBundle?.sign) throw new Error("sign_public_key_missing");
  return crypto.subtle.importKey(
    "jwk",
    publicBundle.sign,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}

async function verifySignature(publicBundle, canonical, signatureB64) {
  const key = await importSignPublic(publicBundle);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64ToBytes(signatureB64),
    new TextEncoder().encode(canonical)
  );
}

function messageCanonical(e) {
  return [
    "JOFP-MSG",
    e.v,
    e.message_id,
    e.from_node,
    e.to_node,
    e.timestamp,
    e.expires_at,
    e.nonce,
    e.iv,
    e.ct
  ].join("|");
}

function coinCanonical(t) {
  return [
    "JOFP-COIN",
    t.v,
    t.coin_id,
    t.from_node,
    t.to_node,
    t.amount,
    t.nonce,
    t.timestamp
  ].join("|");
}

async function registerReplay(env, nodeId, scope, nonce) {
  try {
    await env.DB.prepare(`
      INSERT INTO omega_replay(node_id,scope,nonce,created_at)
      VALUES(?,?,?,?)
    `).bind(nodeId, scope, nonce, now()).run();
    return true;
  } catch {
    return false;
  }
}

async function rateLimit(env, bucket, limit = 120, windowSeconds = 60) {
  const epoch = Math.floor(Date.now() / 1000);
  const reset = epoch + windowSeconds;

  const row = await env.DB.prepare(`
    SELECT count,reset_at FROM omega_rate WHERE bucket=?
  `).bind(bucket).first();

  if (!row || row.reset_at <= epoch) {
    await env.DB.prepare(`
      INSERT INTO omega_rate(bucket,count,reset_at)
      VALUES(?,?,?)
      ON CONFLICT(bucket) DO UPDATE SET count=1,reset_at=excluded.reset_at
    `).bind(bucket, 1, reset).run();
    return true;
  }

  if (row.count >= limit) return false;

  await env.DB.prepare(`
    UPDATE omega_rate SET count=count+1 WHERE bucket=?
  `).bind(bucket).run();

  return true;
}

function validateTimestamp(timestamp, expiresAt) {
  const ts = Date.parse(timestamp);
  const exp = Date.parse(expiresAt);
  const t = Date.now();

  if (!Number.isFinite(ts) || !Number.isFinite(exp)) return false;
  if (Math.abs(t - ts) > MAX_CLOCK_SKEW_MS) return false;
  if (exp <= t || exp - ts > DEFAULT_MESSAGE_TTL_MS) return false;
  return true;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (!authorized(request, env)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/health") {
        return json({
          ok: true,
          service: "JOFP Block Space Network",
          protocol: "JOFP/1.0",
          crypto: {
            identity: "ECDSA-P256",
            key_agreement: "ECDH-P256",
            encryption: "AES-GCM-256",
            hash: "SHA-256"
          },
          coin_runtime: "JOFP_COIN/1.0",
          time: now()
        });
      }

      if (path === "/register" && request.method === "POST") {
        const body = await request.json();
        const deviceName = String(body.device_name || "").trim().slice(0, 100);
        const deviceType = String(body.device_type || "unknown").trim().slice(0, 100);
        const publicKey = String(body.public_key || "").trim();
        let nodeId = String(body.node_id || "").trim();

        if (!deviceName) return json({ ok: false, error: "device_name_required" }, 400);
        if (!publicKey) return json({ ok: false, error: "public_key_required" }, 400);

        const bundle = safeJson(publicKey);
        if (!bundle?.sign || !bundle?.ecdh) {
          return json({ ok: false, error: "public_key_bundle_required" }, 400);
        }

        if (!nodeId) nodeId = crypto.randomUUID();

        const omegaId = await sha256(
          `JOFP/1.0|NODE|${nodeId}|${deviceName}|${deviceType}|${publicKey}`
        );
        const c = coordFromHash(omegaId);
        const t = now();

        await env.DB.prepare(`
          INSERT INTO omega_nodes(
            node_id,device_name,device_type,omega_id,x,y,z,status,created_at,last_seen,public_key
          )
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(node_id) DO UPDATE SET
            device_name=excluded.device_name,
            device_type=excluded.device_type,
            omega_id=excluded.omega_id,
            x=excluded.x,
            y=excluded.y,
            z=excluded.z,
            status='ONLINE',
            last_seen=excluded.last_seen,
            public_key=excluded.public_key
        `).bind(
          nodeId,deviceName,deviceType,omegaId,c.x,c.y,c.z,"ONLINE",t,t,publicKey
        ).run();

        return json({
          ok: true,
          node: {
            node_id: nodeId,
            device_name: deviceName,
            device_type: deviceType,
            omega_id: omegaId,
            ...c,
            status: "ONLINE",
            last_seen: t
          }
        });
      }

      if (path === "/heartbeat" && request.method === "POST") {
        const body = await request.json();
        await env.DB.prepare(`
          UPDATE omega_nodes SET last_seen=?,status='ONLINE' WHERE node_id=?
        `).bind(now(), String(body.node_id || "")).run();
        return json({ ok: true });
      }

      if (path === "/nodes" && request.method === "GET") {
        const rows = await env.DB.prepare(`
          SELECT node_id,device_name,device_type,omega_id,x,y,z,status,last_seen,public_key
          FROM omega_nodes ORDER BY last_seen DESC LIMIT 500
        `).all();

        return json({
          ok: true,
          nodes: rows.results.map((r) => ({
            ...r,
            public_key: r.public_key ? safeJson(r.public_key) : null
          }))
        });
      }

      if (path === "/node" && request.method === "GET") {
        const nodeId = String(url.searchParams.get("node_id") || "");
        const row = nodeId ? await getNode(env, nodeId) : null;
        if (!row) return json({ ok: false, error: "node_not_found" }, 404);

        return json({
          ok: true,
          node: {
            ...row,
            public_key: row.public_key ? safeJson(row.public_key) : null
          }
        });
      }

      if (path === "/pair" && request.method === "POST") {
        const body = await request.json();
        const a = String(body.node_a || "");
        const b = String(body.node_b || "");

        if (!a || !b || a === b) {
          return json({ ok: false, error: "two_distinct_nodes_required" }, 400);
        }

        const [na, nb] = await Promise.all([getNode(env, a), getNode(env, b)]);
        if (!na || !nb) return json({ ok: false, error: "node_not_found" }, 404);

        const pairId = await sha256([a, b].sort().join("|"));
        const t = now();

        await env.DB.prepare(`
          INSERT INTO omega_pairs(pair_id,node_a,node_b,state,created_at)
          VALUES(?,?,?,?,?)
          ON CONFLICT(pair_id) DO UPDATE SET state='ACTIVE'
        `).bind(pairId, a, b, "ACTIVE", t).run();

        return json({
          ok: true,
          pair: { pair_id: pairId, node_a: a, node_b: b, state: "ACTIVE", created_at: t }
        });
      }

      if (path === "/send" && request.method === "POST") {
        const bodyText = await request.text();
        if (new TextEncoder().encode(bodyText).byteLength > MAX_MESSAGE_BYTES) {
          return json({ ok: false, error: "payload_too_large" }, 413);
        }

        const body = safeJson(bodyText);
        if (!body?.envelope) return json({ ok: false, error: "envelope_required" }, 400);
        const e = body.envelope;

        if (
          e.v !== 1 ||
          !e.message_id ||
          !e.from_node ||
          !e.to_node ||
          !e.timestamp ||
          !e.expires_at ||
          !e.nonce ||
          !e.iv ||
          !e.ct ||
          !e.sig
        ) {
          return json({ ok: false, error: "invalid_envelope" }, 400);
        }

        if (e.from_node === e.to_node) {
          return json({ ok: false, error: "self_send_not_allowed" }, 400);
        }

        if (!validateTimestamp(e.timestamp, e.expires_at)) {
          return json({ ok: false, error: "expired_or_invalid_timestamp" }, 400);
        }

        if (!(await rateLimit(env, `send:${e.from_node}`, 120, 60))) {
          return json({ ok: false, error: "rate_limited" }, 429);
        }

        const [sender, receiver] = await Promise.all([
          getNode(env, e.from_node),
          getNode(env, e.to_node)
        ]);
        if (!sender || !receiver) {
          return json({ ok: false, error: "sender_or_receiver_not_found" }, 404);
        }

        const publicBundle = safeJson(sender.public_key || "{}");
        const verified = await verifySignature(
          publicBundle,
          messageCanonical(e),
          e.sig
        );
        if (!verified) return json({ ok: false, error: "invalid_signature" }, 401);

        if (!(await registerReplay(env, e.from_node, "message", e.nonce))) {
          return json({ ok: false, error: "replay_rejected" }, 409);
        }

        const payload = JSON.stringify(e);
        const omegaId = await sha256(
          `JOFP/1.0|MESSAGE|${e.message_id}|${e.from_node}|${e.to_node}|${payload}`
        );

        const pairId = await sha256([e.from_node, e.to_node].sort().join("|"));

        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO omega_pairs(pair_id,node_a,node_b,state,created_at)
            VALUES(?,?,?,?,?)
            ON CONFLICT(pair_id) DO UPDATE SET state='ACTIVE'
          `).bind(pairId, e.from_node, e.to_node, "ACTIVE", now()),

          env.DB.prepare(`
            INSERT INTO omega_messages(
              message_id,from_node,to_node,omega_id,payload,created_at
            )
            VALUES(?,?,?,?,?,?)
          `).bind(
            e.message_id,e.from_node,e.to_node,omegaId,payload,e.timestamp
          )
        ]);

        return json({
          ok: true,
          message: {
            message_id: e.message_id,
            from_node: e.from_node,
            to_node: e.to_node,
            omega_id: omegaId,
            encrypted: true,
            signature_verified: true,
            replay_protected: true,
            created_at: e.timestamp
          }
        });
      }

      if (path === "/receive" && request.method === "GET") {
        const nodeId = String(url.searchParams.get("node_id") || "");
        if (!nodeId) return json({ ok: false, error: "node_id_required" }, 400);

        const rows = await env.DB.prepare(`
          SELECT message_id,from_node,to_node,omega_id,payload,created_at,delivered_at
          FROM omega_messages
          WHERE to_node=? AND delivered_at IS NULL
          ORDER BY created_at ASC LIMIT 100
        `).bind(nodeId).all();

        return json({
          ok: true,
          messages: rows.results.map((r) => ({
            ...r,
            envelope: safeJson(r.payload)
          }))
        });
      }

      if (path === "/delivered" && request.method === "POST") {
        const body = await request.json();
        const messageId = String(body.message_id || "");
        const nodeId = String(body.node_id || "");

        if (!messageId || !nodeId) {
          return json({ ok: false, error: "message_id_and_node_id_required" }, 400);
        }

        const row = await env.DB.prepare(`
          SELECT to_node,delivered_at FROM omega_messages WHERE message_id=?
        `).bind(messageId).first();

        if (!row) return json({ ok: false, error: "message_not_found" }, 404);
        if (row.to_node !== nodeId) {
          return json({ ok: false, error: "delivery_node_mismatch" }, 403);
        }

        const deliveredAt = row.delivered_at || now();
        await env.DB.prepare(`
          UPDATE omega_messages SET delivered_at=? WHERE message_id=?
        `).bind(deliveredAt, messageId).run();

        return json({ ok: true, delivered_at: deliveredAt });
      }

      if (path === "/field" && request.method === "GET") {
        const [nodes,pairs,messages,pending] = await Promise.all([
          env.DB.prepare(`SELECT COUNT(*) c FROM omega_nodes`).first(),
          env.DB.prepare(`SELECT COUNT(*) c FROM omega_pairs`).first(),
          env.DB.prepare(`SELECT COUNT(*) c FROM omega_messages`).first(),
          env.DB.prepare(`
            SELECT COUNT(*) c FROM omega_messages WHERE delivered_at IS NULL
          `).first()
        ]);

        return json({
          ok: true,
          field: {
            nodes: nodes.c,
            pairs: pairs.c,
            messages: messages.c,
            pending: pending.c,
            omega: "Ω0",
            protocol: "JOFP/1.0"
          }
        });
      }

      if (path === "/coin/init" && request.method === "POST") {
        const body = await request.json();
        const creator = String(body.creator_node || "");
        const name = String(body.name || "").trim().slice(0, 64);
        const symbol = String(body.symbol || "").trim().toUpperCase().slice(0, 12);
        const decimals = Number(body.decimals);
        const totalSupply = Number(body.total_supply);

        if (!creator || !name || !symbol) {
          return json({ ok: false, error: "creator_name_symbol_required" }, 400);
        }
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
          return json({ ok: false, error: "invalid_decimals" }, 400);
        }
        if (!Number.isSafeInteger(totalSupply) || totalSupply <= 0) {
          return json({ ok: false, error: "invalid_total_supply" }, 400);
        }
        if (!(await getNode(env, creator))) {
          return json({ ok: false, error: "creator_node_not_found" }, 404);
        }

        const existing = await env.DB.prepare(`
          SELECT coin_id,name,symbol,decimals,total_supply,creator_node,created_at
          FROM coin_meta LIMIT 1
        `).first();

        if (existing) {
          return json({ ok: true, coin: existing, already_initialized: true });
        }

        const coinId = await sha256(
          `JOFP-COIN|${name}|${symbol}|${decimals}|${totalSupply}|${creator}`
        );
        const t = now();
        const txId = crypto.randomUUID();

        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO coin_meta(
              coin_id,name,symbol,decimals,total_supply,creator_node,created_at
            ) VALUES(?,?,?,?,?,?,?)
          `).bind(coinId,name,symbol,decimals,totalSupply,creator,t),

          env.DB.prepare(`
            INSERT INTO coin_balances(coin_id,node_id,balance)
            VALUES(?,?,?)
          `).bind(coinId,creator,totalSupply),

          env.DB.prepare(`
            INSERT INTO coin_transactions(
              tx_id,coin_id,from_node,to_node,amount,nonce,signature,created_at
            ) VALUES(?,?,?,?,?,?,?,?)
          `).bind(txId,coinId,null,creator,totalSupply,"GENESIS","GENESIS",t)
        ]);

        return json({
          ok: true,
          coin: {
            coin_id: coinId,
            name,
            symbol,
            decimals,
            total_supply: totalSupply,
            creator_node: creator,
            created_at: t
          }
        });
      }

      if (path === "/coin/info" && request.method === "GET") {
        const coin = await env.DB.prepare(`
          SELECT coin_id,name,symbol,decimals,total_supply,creator_node,created_at
          FROM coin_meta LIMIT 1
        `).first();

        return coin
          ? json({ ok: true, coin })
          : json({ ok: false, error: "coin_not_initialized" }, 404);
      }

      if (path === "/coin/balance" && request.method === "GET") {
        const nodeId = String(url.searchParams.get("node_id") || "");
        const coin = await env.DB.prepare(`SELECT coin_id FROM coin_meta LIMIT 1`).first();
        if (!coin) return json({ ok: false, error: "coin_not_initialized" }, 404);

        const row = await env.DB.prepare(`
          SELECT balance FROM coin_balances WHERE coin_id=? AND node_id=?
        `).bind(coin.coin_id,nodeId).first();

        return json({ ok: true, node_id: nodeId, balance: row?.balance || 0 });
      }

      if (path === "/coin/transfer" && request.method === "POST") {
        const body = await request.json();
        const tx = body.transaction;

        if (
          tx?.v !== 1 ||
          !tx.coin_id ||
          !tx.from_node ||
          !tx.to_node ||
          !Number.isSafeInteger(tx.amount) ||
          tx.amount <= 0 ||
          !tx.nonce ||
          !tx.timestamp ||
          !tx.sig
        ) {
          return json({ ok: false, error: "invalid_coin_transaction" }, 400);
        }

        if (tx.from_node === tx.to_node) {
          return json({ ok: false, error: "self_transfer_not_allowed" }, 400);
        }

        const ts = Date.parse(tx.timestamp);
        if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
          return json({ ok: false, error: "invalid_transaction_timestamp" }, 400);
        }

        const coin = await env.DB.prepare(`
          SELECT coin_id FROM coin_meta WHERE coin_id=?
        `).bind(tx.coin_id).first();
        if (!coin) return json({ ok: false, error: "coin_not_found" }, 404);

        const [sender,receiver] = await Promise.all([
          getNode(env, tx.from_node),
          getNode(env, tx.to_node)
        ]);
        if (!sender || !receiver) {
          return json({ ok: false, error: "sender_or_receiver_not_found" }, 404);
        }

        const verified = await verifySignature(
          safeJson(sender.public_key || "{}"),
          coinCanonical(tx),
          tx.sig
        );
        if (!verified) return json({ ok: false, error: "invalid_signature" }, 401);

        if (!(await registerReplay(env, tx.from_node, "coin", tx.nonce))) {
          return json({ ok: false, error: "replay_rejected" }, 409);
        }

        const balance = await env.DB.prepare(`
          SELECT balance FROM coin_balances WHERE coin_id=? AND node_id=?
        `).bind(tx.coin_id,tx.from_node).first();

        if (!balance || balance.balance < tx.amount) {
          return json({ ok: false, error: "insufficient_balance" }, 409);
        }

        const txId = crypto.randomUUID();

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE coin_balances
            SET balance=balance-?
            WHERE coin_id=? AND node_id=? AND balance>=?
          `).bind(tx.amount,tx.coin_id,tx.from_node,tx.amount),

          env.DB.prepare(`
            INSERT INTO coin_balances(coin_id,node_id,balance)
            VALUES(?,?,?)
            ON CONFLICT(coin_id,node_id)
            DO UPDATE SET balance=balance+excluded.balance
          `).bind(tx.coin_id,tx.to_node,tx.amount),

          env.DB.prepare(`
            INSERT INTO coin_transactions(
              tx_id,coin_id,from_node,to_node,amount,nonce,signature,created_at
            ) VALUES(?,?,?,?,?,?,?,?)
          `).bind(
            txId,tx.coin_id,tx.from_node,tx.to_node,tx.amount,tx.nonce,tx.sig,tx.timestamp
          )
        ]);

        return json({
          ok: true,
          transaction: {
            tx_id: txId,
            coin_id: tx.coin_id,
            from_node: tx.from_node,
            to_node: tx.to_node,
            amount: tx.amount,
            created_at: tx.timestamp
          }
        });
      }

      if (path === "/coin/history" && request.method === "GET") {
        const nodeId = String(url.searchParams.get("node_id") || "");
        const rows = await env.DB.prepare(`
          SELECT tx_id,coin_id,from_node,to_node,amount,created_at
          FROM coin_transactions
          WHERE from_node=? OR to_node=?
          ORDER BY created_at DESC LIMIT 100
        `).bind(nodeId,nodeId).all();

        return json({ ok: true, transactions: rows.results });
      }

      return json({ ok: false, error: "not_found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }
};
