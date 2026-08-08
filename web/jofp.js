const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(value) {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function openIdentityDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("JOFP_SECURE_IDENTITY", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openIdentityDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readonly");
    const req = tx.objectStore("keys").get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openIdentityDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function generateSecureIdentity() {
  const signGenerated = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const ecdhGenerated = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  const signPrivateJwk = await crypto.subtle.exportKey("jwk", signGenerated.privateKey);
  const signPublicJwk = await crypto.subtle.exportKey("jwk", signGenerated.publicKey);
  const ecdhPrivateJwk = await crypto.subtle.exportKey("jwk", ecdhGenerated.privateKey);
  const ecdhPublicJwk = await crypto.subtle.exportKey("jwk", ecdhGenerated.publicKey);

  const signPrivate = await crypto.subtle.importKey(
    "jwk",
    signPrivateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const ecdhPrivate = await crypto.subtle.importKey(
    "jwk",
    ecdhPrivateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );

  return {
    signPrivate,
    ecdhPrivate,
    public: {
      sign: signPublicJwk,
      ecdh: ecdhPublicJwk
    }
  };
}

async function importSignPublic(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}

async function importECDHPublic(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}

async function deriveAES(privateKey, remotePublicJwk) {
  const publicKey = await importECDHPublic(remotePublicJwk);
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
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

export class JOFP {
  constructor({ api = location.origin, networkKey = "", storagePrefix = "jofp" } = {}) {
    this.api = api.replace(/\/$/, "");
    this.networkKey = networkKey;
    this.storagePrefix = storagePrefix;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      "X-Omega-Key": this.networkKey
    };
  }

  async call(path, options = {}) {
    const response = await fetch(this.api + path, {
      ...options,
      headers: { ...this.headers(), ...(options.headers || {}) }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || String(response.status));
    return data;
  }

  get nodeStorageKey() {
    return `${this.storagePrefix}:node`;
  }

  getNode() {
    return JSON.parse(localStorage.getItem(this.nodeStorageKey) || "null");
  }

  async ensureIdentity() {
    let identity = await idbGet("identity");
    if (!identity) {
      identity = await generateSecureIdentity();
      await idbPut("identity", identity);
    }
    return identity;
  }

  async register({ deviceName, deviceType }) {
    const identity = await this.ensureIdentity();
    const existing = this.getNode();

    const result = await this.call("/register", {
      method: "POST",
      body: JSON.stringify({
        node_id: existing?.node_id,
        device_name: deviceName,
        device_type: deviceType,
        public_key: JSON.stringify(identity.public)
      })
    });

    localStorage.setItem(this.nodeStorageKey, JSON.stringify(result.node));
    return result.node;
  }

  async discover() {
    return (await this.call("/nodes")).nodes;
  }

  async resolve(nodeId) {
    return (await this.call(`/node?node_id=${encodeURIComponent(nodeId)}`)).node;
  }

  async pair(targetNodeId) {
    const node = this.getNode();
    if (!node) throw new Error("register_first");

    return this.call("/pair", {
      method: "POST",
      body: JSON.stringify({
        node_a: node.node_id,
        node_b: targetNodeId
      })
    });
  }

  async send(targetNodeId, plaintext) {
    const node = this.getNode();
    if (!node) throw new Error("register_first");
    if (!targetNodeId) throw new Error("target_required");

    const identity = await this.ensureIdentity();
    const target = await this.resolve(targetNodeId);
    if (!target.public_key?.ecdh) throw new Error("target_requires_secure_reregister");

    const aes = await deriveAES(identity.ecdhPrivate, target.public_key.ecdh);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aes,
        enc.encode(plaintext)
      )
    );

    const timestamp = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const envelope = {
      v: 1,
      message_id: crypto.randomUUID(),
      from_node: node.node_id,
      to_node: targetNodeId,
      timestamp,
      expires_at: expiresAt,
      nonce: crypto.randomUUID(),
      iv: bytesToB64(iv),
      ct: bytesToB64(ciphertext)
    };

    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        identity.signPrivate,
        enc.encode(messageCanonical(envelope))
      )
    );

    envelope.sig = bytesToB64(signature);
    envelope.alg = "ECDH-P256/AES-GCM-256/ECDSA-P256-SHA256";

    return this.call("/send", {
      method: "POST",
      body: JSON.stringify({ envelope })
    });
  }

  async receive() {
    const node = this.getNode();
    if (!node) throw new Error("register_first");

    const identity = await this.ensureIdentity();
    const result = await this.call(
      `/receive?node_id=${encodeURIComponent(node.node_id)}`
    );

    const out = [];

    for (const message of result.messages) {
      try {
        const sender = await this.resolve(message.from_node);
        if (!sender.public_key?.sign || !sender.public_key?.ecdh) {
          throw new Error("sender_identity_missing");
        }

        const e = message.envelope;
        const signPublic = await importSignPublic(sender.public_key.sign);

        const verified = await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          signPublic,
          b64ToBytes(e.sig),
          enc.encode(messageCanonical(e))
        );

        if (!verified) throw new Error("invalid_signature");
        if (Date.parse(e.expires_at) <= Date.now()) throw new Error("message_expired");

        const aes = await deriveAES(identity.ecdhPrivate, sender.public_key.ecdh);
        const plaintextBytes = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: b64ToBytes(e.iv) },
          aes,
          b64ToBytes(e.ct)
        );

        const plaintext = dec.decode(plaintextBytes);

        await this.call("/delivered", {
          method: "POST",
          body: JSON.stringify({
            message_id: message.message_id,
            node_id: node.node_id
          })
        });

        out.push({ ...message, verified: true, plaintext });
      } catch (error) {
        out.push({ ...message, verified: false, error: error.message });
      }
    }

    return out;
  }

  async field() {
    return (await this.call("/field")).field;
  }

  async coinInfo() {
    return (await this.call("/coin/info")).coin;
  }

  async initCoin({ name, symbol, decimals, totalSupply }) {
    const node = this.getNode();
    if (!node) throw new Error("register_first");

    return this.call("/coin/init", {
      method: "POST",
      body: JSON.stringify({
        creator_node: node.node_id,
        name,
        symbol,
        decimals,
        total_supply: totalSupply
      })
    });
  }

  async coinBalance() {
    const node = this.getNode();
    if (!node) throw new Error("register_first");

    return this.call(`/coin/balance?node_id=${encodeURIComponent(node.node_id)}`);
  }

  async coinTransfer(targetNodeId, amount) {
    const node = this.getNode();
    if (!node) throw new Error("register_first");

    const identity = await this.ensureIdentity();
    const coin = await this.coinInfo();

    const tx = {
      v: 1,
      coin_id: coin.coin_id,
      from_node: node.node_id,
      to_node: targetNodeId,
      amount,
      nonce: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    };

    const sig = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        identity.signPrivate,
        enc.encode(coinCanonical(tx))
      )
    );

    tx.sig = bytesToB64(sig);

    return this.call("/coin/transfer", {
      method: "POST",
      body: JSON.stringify({ transaction: tx })
    });
  }

  async coinHistory() {
    const node = this.getNode();
    if (!node) throw new Error("register_first");

    return (await this.call(
      `/coin/history?node_id=${encodeURIComponent(node.node_id)}`
    )).transactions;
  }
}
