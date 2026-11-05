-- PROPOSED ONLY. Do not execute until the owner approves this migration.
-- Select the intended keyspace explicitly in cqlsh before executing this file.
-- Adds one table; does not alter, delete or backfill the 19 existing tables.
CREATE TABLE IF NOT EXISTS rideflow_business_journal (
  scope text,
  operation_id text,
  active_operation text static,
  last_timestamp bigint static,
  request_hash text,
  kind text,
  plan_json text,
  result_json text,
  state text,
  created_at timestamp,
  PRIMARY KEY (scope, operation_id)
);
