CREATE TABLE IF NOT EXISTS slot_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_num INTEGER NOT NULL UNIQUE,
  wallet TEXT NOT NULL UNIQUE,
  tx_hash TEXT NOT NULL UNIQUE,
  position_id INTEGER NOT NULL,
  tier_key TEXT NOT NULL,
  gross_amount_wei TEXT NOT NULL,
  net_amount_wei TEXT NOT NULL,
  weight TEXT NOT NULL,
  activation_epoch INTEGER NOT NULL,
  unlock_epoch INTEGER NOT NULL,
  alias TEXT NOT NULL,
  display_type TEXT NOT NULL,
  display_value TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '',
  project_description TEXT NOT NULL DEFAULT '',
  twitter TEXT NOT NULL DEFAULT '',
  farcaster TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_slot_claims_created_at ON slot_claims(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slot_claims_tier_key ON slot_claims(tier_key);

CREATE TABLE IF NOT EXISTS auth_nonces (
  wallet TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
