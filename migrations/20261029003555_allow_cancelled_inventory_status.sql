/*
# Allow "cancelled" status on inventory_sessions

1. Modified tables
- `inventory_sessions`: the `status` CHECK constraint now also accepts `cancelled`,
  so an open or authorization_requested inventory can be aborted without leaving
  pending sessions behind.

2. Security
- No RLS or grant changes. `service_role` already has full CRUD on this table.
*/

ALTER TABLE public.inventory_sessions
  DROP CONSTRAINT IF EXISTS inventory_sessions_status_check;

ALTER TABLE public.inventory_sessions
  ADD CONSTRAINT inventory_sessions_status_check
  CHECK (status IN ('open', 'authorization_requested', 'closed', 'cancelled'));
