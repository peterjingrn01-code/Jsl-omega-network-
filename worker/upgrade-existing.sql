-- JOFP 1.0 non-destructive additions for an existing Alpha/Beta database.
-- public_key was already added during the prior identity migration.

CREATE TABLE IF NOT EXISTS omega_replay (
  node_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(node_id, scope, nonce)
);

CREATE TABLE IF NOT EXISTS omega_rate (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coin_meta (
  coin_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL UNIQUE,
  decimals INTEGER NOT NULL,
  total_supply INTEGER NOT NULL,
  creator_node TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coin_balances (
  coin_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(coin_id, node_id)
);

CREATE TABLE IF NOT EXISTS coin_transactions (
  tx_id TEXT PRIMARY KEY,
  coin_id TEXT NOT NULL,
  from_node TEXT,
  to_node TEXT NOT NULL,
  amount INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  signature TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_pending
ON omega_messages(to_node, delivered_at);

CREATE INDEX IF NOT EXISTS idx_coin_tx_nodes
ON coin_transactions(coin_id, from_node, to_node, created_at);
