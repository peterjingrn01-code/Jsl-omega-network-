import fs from "node:fs";

const required = [
  "core/jofp.jsl",
  "coin/second-coin.jsl",
  "worker/worker.js",
  "worker/schema.sql",
  "worker/upgrade-existing.sql",
  "web/index.html",
  "web/app.js",
  "web/jofp.js",
  "sdk/jofp.js",
  "wrangler.toml",
  "package.json"
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const worker = fs.readFileSync("worker/worker.js", "utf8");
for (const route of [
  "/health","/register","/nodes","/node","/pair","/send","/receive",
  "/delivered","/field","/coin/init","/coin/info","/coin/balance",
  "/coin/transfer","/coin/history"
]) {
  if (!worker.includes(route)) throw new Error(`Missing route ${route}`);
}

const wrangler = fs.readFileSync("wrangler.toml", "utf8");
if (!wrangler.includes('binding = "DB"')) throw new Error("Missing DB binding");
if (!wrangler.includes('binding = "ASSETS"')) throw new Error("Missing ASSETS binding");

console.log("PASS: JOFP complete repository static checks");
