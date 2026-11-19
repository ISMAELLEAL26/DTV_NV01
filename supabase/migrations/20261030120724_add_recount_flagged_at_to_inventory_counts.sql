/*
# Add recount flag timestamp to inventory counts

1. Modified Tables
- `inventory_counts`
- New column `recount_flagged_at` (timestamptz, nullable): the moment a product was sent to recount because it was sold during the inventory session.

2. Security
- No change to RLS policies or grants. The column is only written by the inventory edge function.

3. Important notes
- Existing rows keep NULL, meaning they have never been flagged.
- Used so a flagged product stays pending until it is counted again after the flag, instead of being re-flagged in a loop.
*/

ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS recount_flagged_at timestamptz;
