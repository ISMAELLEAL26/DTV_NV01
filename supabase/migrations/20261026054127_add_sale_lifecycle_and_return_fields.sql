/*
# Add sale lifecycle and return tracking

1. Modified tables
- `sales.started_at`: timestamp when the cashier starts the sale.
- `sales.completed_at`: timestamp when the sale is finalized.
- `sales.canceled_at`: timestamp for a full cancellation.
- `sales.canceled_by`: authenticated user who performed a full cancellation.
- `sales.cancellation_reason`: explanation recorded for a full cancellation.
- `sale_items.returned_quantity`: quantity already returned for the line.

2. Data safety
- Existing sales keep their data. Existing completed sales use `created_at` as their fallback start and completion time in reports.
- No rows are deleted and no existing column types are changed.

3. Security
- Existing RLS and grants remain in force.
- Cancellation writes will be performed by a server-side operation in a later step, not by trusting browser totals.

4. Important notes
- Quantities returned are tracked independently so partial returns can be audited.
- The fields are nullable/defaulted for compatibility with historical sales.
*/

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS returned_quantity numeric(14,3) NOT NULL DEFAULT 0;

UPDATE public.sales
SET started_at = COALESCE(started_at, created_at),
    completed_at = COALESCE(completed_at, created_at)
WHERE started_at IS NULL OR completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_branch_completed_at ON public.sales(branch_id, completed_at);
