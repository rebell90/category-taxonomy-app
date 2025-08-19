-- Baseline alignment migration present in production.
-- Intentionally no-op locally to avoid duplicate DDL in shadow database replays.

BEGIN;
-- no changes
COMMIT;