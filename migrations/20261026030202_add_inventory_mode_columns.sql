/*
# Add inventory mode metadata to sessions

1. Modified Tables
- `inventory_sessions`: add `inventory_mode` (text, nullable) - records the counting method: 'scan', 'department', or 'category'.
- `inventory_sessions`: add `inventory_department` (text, nullable) - the department code when mode is 'department'.
- `inventory_sessions`: add `inventory_category_id` (uuid, nullable) - the category id when mode is 'category'.
2. Security
- RLS already enabled on inventory_sessions. No policy changes needed; existing grants cover the new columns.
3. Notes
- These columns are informational metadata set by the edge function when an inventory session is applied/closed, so the history and reports can show the method used and filter counts accordingly.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_sessions' AND column_name='inventory_mode') THEN
    ALTER TABLE inventory_sessions ADD COLUMN inventory_mode text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_sessions' AND column_name='inventory_department') THEN
    ALTER TABLE inventory_sessions ADD COLUMN inventory_department text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_sessions' AND column_name='inventory_category_id') THEN
    ALTER TABLE inventory_sessions ADD COLUMN inventory_category_id uuid;
  END IF;
END $$;
