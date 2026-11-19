/*
# Create persistent label print batches

1. New Tables
- `label_print_batches` stores a label queue that can be saved on a phone and opened later on another signed-in device.
- `label_print_batch_items` stores one product snapshot and its requested label quantity for each batch item.

2. New Columns
- `label_print_batches.id` identifies the saved batch.
- `label_print_batches.user_id` identifies the signed-in owner and defaults to the current user.
- `label_print_batches.branch_id` records the working branch at the time of saving.
- `label_print_batches.name` is the human-readable batch name.
- `label_print_batches.status` tracks whether the batch is pending or printed.
- `label_print_batches.total_labels` stores the requested label count for quick display.
- `label_print_batches.created_at` and `printed_at` record lifecycle timestamps.
- `label_print_batch_items.id`, `batch_id`, `product_id`, `product_name`, `product_image_url`, `product_code`, `department`, `sale_price`, `quantity`, and `sort_order` preserve the print-ready product information even if the catalog changes later.

3. Security
- Row level security is enabled on both tables.
- Authenticated users can only read, create, edit, and delete batches they own.
- Batch items are accessible only when their parent batch belongs to the current authenticated user.
- The Data API receives only the authenticated grants required by this feature.

4. Important Notes
- No existing product, sale, inventory, or user data is modified.
- Product information is intentionally snapshotted so a saved phone batch remains printable from the computer.
*/

CREATE TABLE IF NOT EXISTS public.label_print_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT 'Lote de etiquetas',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'printed')),
  total_labels integer NOT NULL DEFAULT 0 CHECK (total_labels >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  printed_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS public.label_print_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.label_print_batches(id) ON DELETE CASCADE,
  product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  product_image_url text NULL,
  product_code text NOT NULL,
  department text NULL,
  sale_price numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS label_print_batches_user_status_idx
  ON public.label_print_batches(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS label_print_batch_items_batch_order_idx
  ON public.label_print_batch_items(batch_id, sort_order);

ALTER TABLE public.label_print_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_print_batch_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_print_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_print_batch_items TO authenticated;

DROP POLICY IF EXISTS "select_own_label_print_batches" ON public.label_print_batches;
CREATE POLICY "select_own_label_print_batches" ON public.label_print_batches
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_label_print_batches" ON public.label_print_batches;
CREATE POLICY "insert_own_label_print_batches" ON public.label_print_batches
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_label_print_batches" ON public.label_print_batches;
CREATE POLICY "update_own_label_print_batches" ON public.label_print_batches
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_label_print_batches" ON public.label_print_batches;
CREATE POLICY "delete_own_label_print_batches" ON public.label_print_batches
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_label_print_batch_items" ON public.label_print_batch_items;
CREATE POLICY "select_own_label_print_batch_items" ON public.label_print_batch_items
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.label_print_batches b
    WHERE b.id = batch_id AND b.user_id = auth.uid()
  ));
DROP POLICY IF EXISTS "insert_own_label_print_batch_items" ON public.label_print_batch_items;
CREATE POLICY "insert_own_label_print_batch_items" ON public.label_print_batch_items
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.label_print_batches b
    WHERE b.id = batch_id AND b.user_id = auth.uid()
  ));
DROP POLICY IF EXISTS "update_own_label_print_batch_items" ON public.label_print_batch_items;
CREATE POLICY "update_own_label_print_batch_items" ON public.label_print_batch_items
  FOR UPDATE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.label_print_batches b
    WHERE b.id = batch_id AND b.user_id = auth.uid()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.label_print_batches b
    WHERE b.id = batch_id AND b.user_id = auth.uid()
  ));
DROP POLICY IF EXISTS "delete_own_label_print_batch_items" ON public.label_print_batch_items;
CREATE POLICY "delete_own_label_print_batch_items" ON public.label_print_batch_items
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.label_print_batches b
    WHERE b.id = batch_id AND b.user_id = auth.uid()
  ));