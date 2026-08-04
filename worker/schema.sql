CREATE TABLE IF NOT EXISTS omega_nodes (
  node_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  omega_id TEXT NOT NULL,
  x TEXT NOT NULL,
  y TEXT NOT NULL,
  z TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ONLINE',
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS omega_pairs (
  pair_id TEXT PRIMARY KEY,
  node_a TEXT NOT NULL,
  node_b TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS omega_messages (
  message_id TEXT PRIMARY KEY,
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  omega_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_seen ON omega_nodes(last_seen);
CREATE INDEX IF NOT EXISTS idx_messages_to ON omega_messages(to_node, delivered_at);
