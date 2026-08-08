import { JOFP } from "./jofp.js";

const $ = (id) => document.getElementById(id);
const has = (id) => !!$(id);
const page = document.body.dataset.page || "main";
const lang = document.documentElement.lang === "zh-CN" ? "zh" : "en";

const T = {
  en: {
    ready: "Ready",
    notConnected: "Not connected",
    connected: "Connected",
    noDevices: "No devices found.",
    selectDevice: "Select a device first.",
    paired: "Connected",
    sent: "Sent",
    noMessages: "No messages.",
    invalid: "Unable to verify message",
    receivedFrom: "From",
    walletNotOpened: "Wallet not opened.",
    error: "Error",
    secure: "Secure"
  },
  zh: {
    ready: "准备就绪",
    notConnected: "未连接",
    connected: "已连接",
    noDevices: "未发现设备。",
    selectDevice: "请先选择设备。",
    paired: "已连接",
    sent: "已发送",
    noMessages: "暂无消息。",
    invalid: "消息验证失败",
    receivedFrom: "来自",
    walletNotOpened: "钱包尚未打开。",
    error: "错误",
    secure: "安全"
  }
}[lang];

function ensureHiddenRuntimeFields() {
  if (!has("api")) {
    const api = document.createElement("input");
    api.id = "api";
    api.type = "hidden";
    document.body.appendChild(api);
  }
  if (!has("key")) {
    const key = document.createElement("input");
    key.id = "key";
    key.type = "hidden";
    document.body.appendChild(key);
  }
  if (!has("log")) {
    const log = document.createElement("pre");
    log.id = "log";
    log.hidden = true;
    document.body.appendChild(log);
  }
}

ensureHiddenRuntimeFields();

$("api").value = localStorage.getItem("omega_api") || window.location.origin;
$("key").value = localStorage.getItem("omega_key") || "";

if (has("name")) {
  $("name").value = localStorage.getItem("omega_name") || "";
}

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

function log(value) {
  if (!has("log")) return;
  $("log").textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setStatus(text, good = true) {
  if (!has("status")) return;
  $("status").textContent = text;
  $("status").classList.toggle("ok", good);
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderMe() {
  syncClient();
  const node = client.getNode();

  if (has("status")) {
    setStatus(node ? `${T.connected}: ${node.device_name}` : T.ready, true);
  }

  if (has("me")) {
    $("me").textContent = node
      ? `${node.device_name}\n${T.secure}`
      : T.notConnected;
  }
}

function setTarget(nodeId) {
  if (has("target")) $("target").value = nodeId;
  if (has("coinTarget")) $("coinTarget").value = nodeId;
}

function renderNodes() {
  if (!has("nodes")) return;

  $("nodes").innerHTML = "";

  if (!discovered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = T.noDevices;
    $("nodes").appendChild(empty);
    return;
  }

  const ownNodeId = client.getNode()?.node_id;

  for (const n of discovered) {
    if (n.node_id === ownNodeId) continue;

    const d = document.createElement("button");
    d.type = "button";
    d.className = "device";
    d.innerHTML = `
      <span class="device-name">${esc(n.device_name)}</span>
      <span class="device-type">${esc(n.device_type)}</span>
    `;
    d.onclick = () => {
      document.querySelectorAll(".device.selected")
        .forEach((el) => el.classList.remove("selected"));
      d.classList.add("selected");
      setTarget(n.node_id);
    };

    $("nodes").appendChild(d);
  }

  if (!$("nodes").children.length) {
    $("nodes").innerHTML = `<div class="empty">${esc(T.noDevices)}</div>`;
  }
}

function friendlyError(error) {
  const code = String(error?.message || error || "");

  const messages = {
    register_first: lang === "zh" ? "请先连接本设备。" : "Connect this device first.",
    target_required: T.selectDevice,
    target_requires_secure_reregister:
      lang === "zh"
        ? "目标设备需要重新连接一次。"
        : "The target device needs to reconnect once.",
    target_identity_missing:
      lang === "zh"
        ? "目标设备需要重新连接一次。"
        : "The target device needs to reconnect once.",
    insufficient_balance:
      lang === "zh" ? "余额不足。" : "Insufficient balance.",
    coin_not_initialized:
      lang === "zh" ? "Coin 尚未初始化。" : "Coin is not initialized yet."
  };

  return messages[code] || code;
}

async function guarded(fn) {
  try {
    syncClient();
    await fn();
  } catch (e) {
    setStatus(`${T.error}: ${friendlyError(e)}`, false);
    log("ERROR: " + e.message);
  }
}

/* Main JBS page */
if (page === "main") {
  if (has("register")) {
    $("register").onclick = () => guarded(async () => {
      localStorage.setItem("omega_name", $("name").value);
      const node = await client.register({
        deviceName: $("name").value.trim(),
        deviceType: $("type").value
      });
      renderMe();
      log({ ok: true, node });
    });
  }

  if (has("discover")) {
    $("discover").onclick = () => guarded(async () => {
      discovered = await client.discover();
      renderNodes();
      setStatus(T.ready, true);
      log({ ok: true, nodes: discovered.length });
    });
  }

  if (has("pair")) {
    $("pair").onclick = () => guarded(async () => {
      const target = $("target").value.trim();
      if (!target) throw new Error("target_required");
      await client.pair(target);
      setStatus(T.paired, true);
      log({ ok: true, paired: true });
    });
  }

  if (has("send")) {
    $("send").onclick = () => guarded(async () => {
      const target = $("target").value.trim();
      if (!target) throw new Error("target_required");
      await client.send(target, $("message").value);
      $("message").value = "";
      setStatus(T.sent, true);
      log({ ok: true, sent: true });
    });
  }

  if (has("receive")) {
    $("receive").onclick = () => guarded(async () => {
      const messages = await client.receive();

      if (!messages.length) {
        $("messages").textContent = T.noMessages;
        return;
      }

      $("messages").textContent = messages.map((m) => {
        if (!m.verified) return `[${T.invalid}]`;
        return `${T.receivedFrom}: ${m.from_node}\n${m.plaintext}`;
      }).join("\n\n");
    });
  }
}

/* Coin page */
if (page === "coin") {
  if (has("coinInit")) {
    $("coinInit").onclick = () => guarded(async () => {
      const decimals = Number($("coinDecimals").value);
      const humanSupply = Number($("coinSupply").value);

      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
        throw new Error("invalid_decimals");
      }

      const totalSupply = Math.round(humanSupply * (10 ** decimals));
      if (!Number.isSafeInteger(totalSupply) || totalSupply <= 0) {
        throw new Error("invalid_total_supply");
      }

      const result = await client.initCoin({
        name: $("coinName").value.trim(),
        symbol: $("coinSymbol").value.trim(),
        decimals,
        totalSupply
      });

      $("coinBox").textContent = JSON.stringify(result.coin || result, null, 2);
      setStatus(T.ready, true);
    });
  }

  if (has("coinInfo")) {
    $("coinInfo").onclick = () => guarded(async () => {
      const coin = await client.coinInfo();
      const balance = await client.coinBalance();

      const scale = 10 ** coin.decimals;
      const humanBalance = balance.balance / scale;

      $("coinBox").textContent =
        `${coin.name} (${coin.symbol})\n` +
        `${lang === "zh" ? "余额" : "Balance"}: ${humanBalance}`;
    });
  }

  if (has("coinSend")) {
    $("coinSend").onclick = () => guarded(async () => {
      const target = $("coinTarget").value.trim();
      if (!target) throw new Error("target_required");

      const coin = await client.coinInfo();
      const humanAmount = Number($("coinAmount").value);
      const amount = Math.round(humanAmount * (10 ** coin.decimals));

      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error("invalid_amount");
      }

      await client.coinTransfer(target, amount);
      setStatus(T.sent, true);
      await $("coinInfo").onclick();
    });
  }

  if (has("coinHistory")) {
    $("coinHistory").onclick = () => guarded(async () => {
      const history = await client.coinHistory();

      if (!history.length) {
        $("coinBox").textContent = lang === "zh" ? "暂无记录。" : "No history.";
        return;
      }

      $("coinBox").textContent = history.map((tx) =>
        `${tx.created_at}\n${tx.from_node || "GENESIS"} → ${tx.to_node}\n${tx.amount}`
      ).join("\n\n");
    });
  }
}

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
