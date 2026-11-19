/*
# Shared or per-branch product prices

## Plain-English summary
Each product can now either use one price for every branch (the default, unchanged behavior) or set its own cost, sale and price 2/3 for each branch.

## 1. Changes to `products`
- New column `prices_shared` (boolean, not null, default true). When true, the product's own cost and price fields apply to every branch. When false, the per-branch rows below are used.

## 2. New table `product_branch_prices`
- `product_id` and `branch_id` form the primary key. One row per product and branch.
- `cost_price`, `sale_price`, `price_2`, `price_3` (numeric 12,2, default 0).
- `updated_at` timestamp.
- Rows are kept when a product goes back to shared prices, so no data is lost when toggling.

## 3. Security
- RLS enabled on `product_branch_prices`.
- SELECT: active staff who can access the branch (same rule as branch stock).
- INSERT and UPDATE: users with the products capability, limited to branches they can access.
- DELETE: administrators only.
- Grants: authenticated only, with the verbs above.

## Notes
- Existing products keep `prices_shared = true`, so nothing changes until someone switches a product to per-branch prices.
- Idempotent: safe to re-run.
*/

ALTER TABLE products ADD COLUMN IF NOT EXISTS prices_shared boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS product_branch_prices (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  sale_price numeric(12,2) NOT NULL DEFAULT 0,
  price_2 numeric(12,2) NOT NULL DEFAULT 0,
  price_3 numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, branch_id)
);

CREATE INDEX IF NOT EXISTS product_branch_prices_branch_idx ON product_branch_prices (branch_id);

ALTER TABLE product_branch_prices ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON product_branch_prices TO authenticated;

DROP POLICY IF EXISTS "staff_select_product_branch_prices" ON product_branch_prices;
CREATE POLICY "staff_select_product_branch_prices" ON product_branch_prices FOR SELECT
  TO authenticated USING (is_active_staff() AND user_can_access_branch(branch_id));

DROP POLICY IF EXISTS "catalog_insert_product_branch_prices" ON product_branch_prices;
CREATE POLICY "catalog_insert_product_branch_prices" ON product_branch_prices FOR INSERT
  TO authenticated WITH CHECK (has_capability('products') AND user_can_access_branch(branch_id));

DROP POLICY IF EXISTS "catalog_update_product_branch_prices" ON product_branch_prices;
CREATE POLICY "catalog_update_product_branch_prices" ON product_branch_prices FOR UPDATE
  TO authenticated USING (has_capability('products') AND user_can_access_branch(branch_id))
  WITH CHECK (has_capability('products') AND user_can_access_branch(branch_id));

DROP POLICY IF EXISTS "admin_delete_product_branch_prices" ON product_branch_prices;
CREATE POLICY "admin_delete_product_branch_prices" ON product_branch_prices FOR DELETE
  TO authenticated USING (is_admin());
