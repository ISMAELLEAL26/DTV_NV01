/*
# Add locations catalog and product location

1. New Tables
- `locations`: physical places where products are stored (id, name, active, created_at).

2. Modified Tables
- `products`: new nullable column `location_id` referencing `locations`. One location per product for now.

3. Security
- RLS enabled on `locations`.
- Staff can read locations (same rule as categories).
- Users with the products capability can insert and update locations.
- Only admins can delete locations.
- GRANTs limited to `authenticated`.

4. Notes
- Existing product rows keep `location_id` NULL, so nothing changes until locations are assigned.
- Stock is not touched by this migration.
*/

CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON locations TO authenticated;

ALTER TABLE products ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS products_location_id_idx ON products(location_id);

DROP POLICY IF EXISTS staff_select_locations ON locations;
CREATE POLICY staff_select_locations ON locations FOR SELECT TO authenticated USING (is_active_staff());

DROP POLICY IF EXISTS catalog_insert_locations ON locations;
CREATE POLICY catalog_insert_locations ON locations FOR INSERT TO authenticated WITH CHECK (has_capability('products'::text));

DROP POLICY IF EXISTS catalog_update_locations ON locations;
CREATE POLICY catalog_update_locations ON locations FOR UPDATE TO authenticated USING (has_capability('products'::text)) WITH CHECK (has_capability('products'::text));

DROP POLICY IF EXISTS admin_delete_locations ON locations;
CREATE POLICY admin_delete_locations ON locations FOR DELETE TO authenticated USING (is_admin());
