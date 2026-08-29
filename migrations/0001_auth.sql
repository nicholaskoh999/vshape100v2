-- Round 02 — authentication foundation.
--
-- Deliberately minimal: only what app-native Google login and the trusted
-- device session need. No generic users/roles/permissions schema.

-- Short-lived OIDC transaction records (state / nonce / PKCE verifier).
-- One-time use: a row is consumed (deleted) by the callback.
CREATE TABLE IF NOT EXISTS oauth_states (
  -- SHA-256 hash of the opaque state value sent to Google. The raw state
  -- never touches the database.
  state_hash    TEXT PRIMARY KEY,
  nonce         TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  -- Same-app relative path to return to after login. Validated before write.
  return_to     TEXT NOT NULL DEFAULT '/today',
  -- Whether "Trust this device" was checked on the login screen.
  trusted       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
  ON oauth_states (expires_at);

-- App-owned sessions. The browser holds an opaque random token; only its
-- SHA-256 hash is stored here.
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_hash TEXT PRIMARY KEY,
  google_sub   TEXT NOT NULL,
  email        TEXT NOT NULL,
  -- Cached profile snapshot for the app header. Not authoritative.
  name         TEXT,
  picture      TEXT,
  trusted      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
  ON auth_sessions (expires_at);
