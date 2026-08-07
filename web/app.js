import { JOFP } from "./jofp.js";

const $ = (id) => document.getElementById(id);

$("api").value = localStorage.getItem("omega_api") || window.location.origin;
$("key").value = localStorage.getItem("omega_key") || "";
$("name").value = localStorage.getItem("omega_name") || "";

let client = makeClient();
let discovered = [];

function makeClient() {
  return new JOFP({
    api: $("api").value.trim() || window.location.origin,
    networkKey: $("key").value
  });
}

function syncClient() {
  localStorage.setItem("omega_api", $("api").value.trim() || window.location.origin);
  localStorage.setItem("omega_key", $("key").value);
  client = makeClient();
}

function log(v) {
  $("log").textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

function esc(v) {
  return String(v)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function renderMe() {
  const node = client.getNode();
  $("me").textContent = node ? JSON.stringify(node, null, 2) : "No node identity yet.";
  $("status").textContent = node ? `Online: ${node.device_name}` : "Not registered";
}

function renderNodes() {
  $("nodes").innerHTML = "";
  for (const n of discovered) {
    const d = document.createElement("div");
    d.className = "node";
    d.innerHTML =
      `<b>${esc(n.device_name)}</b><br>` +
      `<span class="muted">${esc(n.device_type)}</span><br>` +
      `<small>${esc(n.node_id)}</small>`;
    d.onclick = () => {
      $("target").value = n.node_id;
      $("coinTarget").value = n.node_id;
    };
    $("nodes").appendChild(d);
  }
}

$("register").onclick = async () => {
  try {
    syncClient();
    localStorage.setItem("omega_name", $("name").value);
    const node = await client.register({
      deviceName: $("name").value.trim(),
      deviceType: $("type").value
    });
    renderMe();
    log({ ok: true, node, identity: "secure-device-identity-ready" });
  } catch (e) { log("ERROR: " + e.message); }
};

$("discover").onclick = async () => {
  try {
    syncClient();
    discovered = await client.discover();
    renderNodes();
    log({ ok: true, nodes: discovered });
  } catch (e) { log("ERROR: " + e.message); }
};

$("pair").onclick = async () => {
  try {
    syncClient();
    log(await client.pair($("target").value.trim()));
  } catch (e) { log("ERROR: " + e.message); }
};

$("send").onclick = async () => {
  try {
    syncClient();
    log(await client.send($("target").value.trim(), $("message").value));
  } catch (e) { log("ERROR: " + e.message); }
};

$("receive").onclick = async () => {
  try {
    syncClient();
    const messages = await client.receive();

    if (!messages.length) {
      $("messages").textContent = "No pending messages.";
      log({ ok: true, messages: [] });
      return;
    }

    $("messages").textContent = messages.map((m) => {
      if (!m.verified) return `[INVALID] ${m.message_id}\n${m.error}`;
      return `[VERIFIED ✓]\nFrom: ${m.from_node}\nMessage: ${m.plaintext}\nCreated: ${m.created_at}`;
    }).join("\n\n----------------\n\n");

    log({
      ok: true,
      received: messages.length,
      verified: messages.filter((m) => m.verified).length
    });
  } catch (e) { log("ERROR: " + e.message); }
};

$("field").onclick = async () => {
  try {
    syncClient();
    log({ ok: true, field: await client.field() });
  } catch (e) { log("ERROR: " + e.message); }
};

$("coinInit").onclick = async () => {
  try {
    syncClient();
    const decimals = Number($("coinDecimals").value);
    const humanSupply = Number($("coinSupply").value);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) throw new Error("invalid_decimals");
    const scale = 10 ** decimals;
    const totalSupply = Math.round(humanSupply * scale);
    if (!Number.isSafeInteger(totalSupply)) throw new Error("supply_too_large");

    log(await client.initCoin({
      name: $("coinName").value.trim(),
      symbol: $("coinSymbol").value.trim(),
      decimals,
      totalSupply
    }));
  } catch (e) { log("ERROR: " + e.message); }
};

$("coinInfo").onclick = async () => {
  try {
    syncClient();
    const coin = await client.coinInfo();
    const balance = await client.coinBalance();
    $("coinStatus").textContent = JSON.stringify({ coin, balance }, null, 2);
    log({ ok: true, coin, balance });
  } catch (e) { log("ERROR: " + e.message); }
};

$("coinSend").onclick = async () => {
  try {
    syncClient();
    const coin = await client.coinInfo();
    const humanAmount = Number($("coinAmount").value);
    const amount = Math.round(humanAmount * (10 ** coin.decimals));
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("invalid_amount");
    log(await client.coinTransfer($("coinTarget").value.trim(), amount));
  } catch (e) { log("ERROR: " + e.message); }
};

$("coinHistory").onclick = async () => {
  try {
    syncClient();
    $("coinStatus").textContent = JSON.stringify(await client.coinHistory(), null, 2);
  } catch (e) { log("ERROR: " + e.message); }
};

renderMe();

setInterval(async () => {
  try {
    syncClient();
    const node = client.getNode();
    if (!node) return;
    await client.call("/heartbeat", {
      method: "POST",
      body: JSON.stringify({ node_id: node.node_id })
    });
  } catch {}
}, 30000);
