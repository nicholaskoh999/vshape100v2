-- Round 14 — Web Push subscriptions and delivery claims.
--
-- Two additive tables. Nothing existing is dropped, renamed or rewritten, and
-- no row of any other table is touched. Applied ONCE by the migration ledger.
--
-- 1. push_subscriptions — one row per BROWSER, not per account. Permission and
--    a PushSubscription belong to a device profile, so an account may hold
--    several and enabling or disabling one must not touch the others.
--
-- 2. notification_deliveries — an internal claim ledger that makes a trigger
--    minute deliver at most once per device. It is operational infrastructure,
--    NOT a user-facing notification history, and nothing reads it for display.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT NOT NULL CHECK (length(id) > 0),
  google_sub TEXT NOT NULL,

  -- The push service URL. Kept because delivery needs it; never returned to
  -- any browser and never logged.
  endpoint TEXT NOT NULL CHECK (length(endpoint) > 0),

  -- SHA-256 of the endpoint. Lookup and de-duplication happen on this, so the
  -- unique index does not have to span a long URL, and one browser endpoint
  -- can exist only once across the whole table: re-enabling the same browser
  -- under a different account REPLACES the row rather than leaving the device
  -- attached to two accounts.
  endpoint_hash TEXT NOT NULL CHECK (length(endpoint_hash) = 64),

  -- The subscription's public key material, as the browser reported it.
  p256dh TEXT NOT NULL CHECK (length(p256dh) > 0),
  auth TEXT NOT NULL CHECK (length(auth) > 0),

  -- The device's IANA timezone, e.g. 'Asia/Kuala_Lumpur'. The schedule is
  -- local-clock, so without this the row cannot be evaluated at all — a
  -- subscription with no usable zone is simply not eligible to be sent.
  timezone TEXT NOT NULL CHECK (length(timezone) > 0),

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  PRIMARY KEY (google_sub, id)
);

-- One browser endpoint, one row, globally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions (endpoint_hash);

-- The scheduler walks every eligible subscription each minute.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account
  ON push_subscriptions (google_sub);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  -- The subscription this claim belongs to. Rows are removed with it.
  subscription_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,

  -- The scheduled trigger, as an exact UTC minute (epoch minutes). Derived
  -- from the cron event's scheduledTime, never from wall-clock at execution,
  -- so a late invocation still claims the minute it was scheduled for.
  trigger_minute INTEGER NOT NULL,

  claimed_at INTEGER NOT NULL,

  -- How many times this occurrence has been claimed. Bounds retrying so a
  -- push service having a bad hour cannot be retried forever.
  attempts INTEGER NOT NULL DEFAULT 1,

  -- The claim is a small state machine, because "did it fail?" is not
  -- precise enough to decide whether retrying is SAFE:
  --
  --   claimed    in flight. Blocks everything, including a crashed sweep --
  --              conservative on purpose, since an interrupted send may
  --              already have reached the push service.
  --   sent       accepted. Terminal. Never sent again.
  --   retryable  the service explicitly refused it (408/429/5xx), so we can
  --              PROVE it was not accepted. Only this state may be reclaimed.
  --   rejected   permanently refused. Terminal; retrying cannot help.
  --   ambiguous  no answer at all. Terminal, deliberately: it may already
  --              have been delivered, and a duplicate buzz for one moment is
  --              worse than a missed one.
  status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'sent', 'retryable', 'rejected', 'ambiguous')),

  -- The claim IS the primary key. An INSERT that conflicts is a lost race,
  -- which is exactly how a concurrent or retried cron invocation is stopped
  -- from sending twice.
  PRIMARY KEY (subscription_id, trigger_minute)
);

-- Bounded cleanup: old claims are prunable by minute.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_minute
  ON notification_deliveries (trigger_minute);
