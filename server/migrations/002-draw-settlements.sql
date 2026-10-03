-- Existing match snapshots and completed results remain untouched.
-- Only the settlement classification gains the new completed-game result.
ALTER TABLE __SCHEMA__.settlements DROP CONSTRAINT settlements_kind_check;
ALTER TABLE __SCHEMA__.settlements ADD CONSTRAINT settlements_kind_check
  CHECK (kind IN ('victory','draw','void'));
