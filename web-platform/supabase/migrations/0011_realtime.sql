-- TPM Monitoring Platform — schema migration 11/11
-- Realtime: publish the tables the Dashboard, GIS Map, Issues list, and
-- notification bell subscribe to. RLS still applies to Realtime — a client
-- only receives change events for rows it's allowed to SELECT.

alter publication supabase_realtime add table issues;
alter publication supabase_realtime add table issue_history;
alter publication supabase_realtime add table notifications;

-- Full row images on UPDATE (not just changed columns/PK) so the client can
-- reconcile issue state without an extra round-trip.
alter table issues replica identity full;
