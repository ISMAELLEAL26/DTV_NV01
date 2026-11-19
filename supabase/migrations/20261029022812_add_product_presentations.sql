/*
# Add product presentations (sub-codes sold in packs)

1. New Tables
- `product_presentations`: a sellable pack of a master product (e.g. "Casillero 30 pz" of "Huevo blanco").
  - `id` uuid primary key
  - `product_id` master product whose stock is discounted
  - `name` presentation label shown on the ticket
  - `code` its own barcode/code, unique across presentations
  - `pieces` how many master units (pz) one presentation contains
  - `sale_price` price of the presentation (cost is calculated as pieces x master cost)
  - `active` soft on/off flag
  - `created_at` timestamp

2. Modified Tables
- `sale_items`: new nullable `presentation_id` to record which presentation was sold.
  Quantity on sale lines stays in master pieces, so reports, returns and inventory checks keep working.

3. Security
- RLS enabled on `product_presentations`.
- Active staff can read presentations.
- Users with the products capability can insert and update them.
- Only admins can delete them.
- Grants are given only to `authenticated`.

4. Notes
- Stock is never stored per presentation; sales discount pieces from the master product.
*/

CREATE TABLE IF NOT EXISTS public.product_presentations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  pieces numeric NOT NULL CHECK (pieces > 0),
  sale_price numeric NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_presentations_code_key ON public.product_presentations (lower(code));
CREATE INDEX IF NOT EXISTS product_presentations_product_id_idx ON public.product_presentations (product_id);

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS presentation_id uuid REFERENCES public.product_presentations(id) ON DELETE SET NULL;

ALTER TABLE public.product_presentations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_presentations TO authenticated;

DROP POLICY IF EXISTS "staff_select_product_presentations" ON public.product_presentations;
CREATE POLICY "staff_select_product_presentations" ON public.product_presentations FOR SELECT
  TO authenticated USING (is_active_staff());

DROP POLICY IF EXISTS "catalog_insert_product_presentations" ON public.product_presentations;
CREATE POLICY "catalog_insert_product_presentations" ON public.product_presentations FOR INSERT
  TO authenticated WITH CHECK (has_capability('products'::text));

DROP POLICY IF EXISTS "catalog_update_product_presentations" ON public.product_presentations;
CREATE POLICY "catalog_update_product_presentations" ON public.product_presentations FOR UPDATE
  TO authenticated USING (has_capability('products'::text)) WITH CHECK (has_capability('products'::text));

DROP POLICY IF EXISTS "admin_delete_product_presentations" ON public.product_presentations;
CREATE POLICY "admin_delete_product_presentations" ON public.product_presentations FOR DELETE
  TO authenticated USING (is_admin());
