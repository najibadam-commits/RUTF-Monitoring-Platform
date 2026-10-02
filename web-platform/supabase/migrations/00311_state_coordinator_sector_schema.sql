-- State Coordinator review/approval workflow + DRI sector scoping — schema primitives only.
-- See DECISIONS.md #22.
--
-- Split into two migrations (0031/0032) because Postgres forbids using a freshly-added enum
-- value inside the same transaction that added it, and apply-one.js wraps each file in one
-- transaction — this file ONLY adds the new enum values/columns; 0032 (which must run after this
-- one has committed) does everything that actually references them: the new status default, RLS
-- policies, RPCs, and the category→sector data swap.

alter type user_role add value if not exists 'state_coordinator';
alter type issue_status add value if not exists 'pending_review';
alter type issue_status add value if not exists 'returned_for_correction';

-- ─── State Coordinator scope ─────────────────────────────────────────────────────────────────

-- A coordinator reviews/approves only Findings whose state_id matches this — see 0032's
-- issues_select/issues_update policies. Single state per coordinator (not a state, keep it
-- simple per the requested design); null for every other role.
alter table profiles add column if not exists managed_state_id uuid references states(id);

comment on column profiles.managed_state_id is
  'Only meaningful for role = state_coordinator: the single State this coordinator reviews and '
  'approves Findings for. Null for every other role. See migration 0032 and DECISIONS.md #22.';

-- ─── DRI sector scope ────────────────────────────────────────────────────────────────────────

-- Named assigned_category_id because it references the existing `categories` table, which 0032
-- relabels to "Sector" in user-facing terminology (and repopulates with the new sector list)
-- without renaming the underlying table/column — see DECISIONS.md #22/#23. Enforced at the RLS
-- level (0032's issues_select), not just the UI.
alter table profiles add column if not exists assigned_category_id uuid references categories(id);

comment on column profiles.assigned_category_id is
  'Only meaningful for role = dri: the single sector (categories row) this DRI may see/act on. '
  'Null for every other role. See migration 0032 and DECISIONS.md #22.';

-- ─── Category → Sector: legacy-preservation flag ────────────────────────────────────────────

-- Old categories were incident *types* (Water & Sanitation Failure, Infrastructure Damage, ...);
-- the new Sector list is humanitarian program *areas* (WASH, Nutrition, Health Services, ...) —
-- a different taxonomy, not a 1:1 rename. Rows referenced by existing Findings must keep their
-- name/id (so historical Findings keep an accurate label and their category_id FK stays intact)
-- but should stop being offered for new submissions — is_active is how 0032 achieves that
-- without deleting anything a Finding still points to.
alter table categories add column if not exists is_active boolean not null default true;

comment on column categories.is_active is
  'False for a legacy category kept only because existing Findings still reference it (see the '
  'category→sector migration 0032) — excluded from any "pick a sector" list for new Findings, '
  'still resolves correctly wherever an existing Finding displays its historical category/sector.';
