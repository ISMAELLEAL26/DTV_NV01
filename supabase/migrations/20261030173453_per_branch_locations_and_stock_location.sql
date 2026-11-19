/*
# Per-branch locations and product location per branch

1. Modified Tables
- `locations`: new column `branch_id` (required). Each location now belongs to one branch, so two branches can have different locations.
  - Unique (id, branch_id) so other tables can reference a location together with its branch.
  - Unique (branch_id, name) so a branch cannot have two locations with the same name.
- `product_stock`: new nullable column `location_id`. It stores where the product is kept in that branch.
  - Composite foreign key (location_id, branch_id) -> locations (id, branch_id). A product cannot be placed in a location of another branch.
  - Index on (branch_id, location_id) for location filters.

2. Notes
- The `locations` table had no rows when this migration was written, so the required branch column is safe to add.
- `products.location_id` is no longer used by the app. It is kept (not dropped) to avoid losing data; it is empty.
- Security: no policy or grant changes. Existing policies on `locations` and `product_stock` still apply.
*/

ALTER TABLE locations ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM locations WHERE branch_id IS NULL) THEN
    ALTER TABLE locations ALTER COLUMN branch_id SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS locations_id_branch_key ON locations (id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS locations_branch_name_key ON locations (branch_id, lower(name));

ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS location_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_stock_location_same_branch_fkey') THEN
    ALTER TABLE product_stock
      ADD CONSTRAINT product_stock_location_same_branch_fkey
      FOREIGN KEY (location_id, branch_id) REFERENCES locations (id, branch_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS product_stock_branch_location_idx ON product_stock (branch_id, location_id);
