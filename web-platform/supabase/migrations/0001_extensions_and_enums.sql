-- TPM Monitoring Platform — schema migration 1/11
-- Extensions and enum types.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- 5 account roles. README's 3-tier RBAC table (Super Admin / Project Admin /
-- Viewer) is the authoritative *permission* spec; tpm_supervisor and dri are
-- the two operational roles the design prototype's data/workflow model
-- requires (mock-data.js USERS, and the TPM Sub-Panel / DRI-response flow in
-- the .dc.html prototype). See DECISIONS.md for the full reconciliation.
create type user_role as enum (
  'super_admin',
  'project_admin',
  'tpm_supervisor',
  'dri',
  'viewer'
);

create type account_status as enum ('active', 'inactive');

-- STATUS_ORDER in mock-data.js, snake_cased for Postgres.
create type issue_status as enum (
  'new',
  'assigned',
  'in_progress',
  'resolved',
  'verified_closed'
);

-- PRIORITY_COLOR keys in mock-data.js.
create type issue_priority as enum ('critical', 'high', 'medium', 'low');
