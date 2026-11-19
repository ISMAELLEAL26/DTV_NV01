/*
# Share label batches by branch

1. Purpose
- Label print batches were private to the saving user. Now any signed-in user
  of the same branch (and users without a branch, e.g. owner/admin profiles)
  can see, update, and delete batches, including their items.

2. Modified tables
- `label_print_batches`: owner-only policies replaced by branch-scoped ones.
  `user_id` stays to remember who saved each batch.
- `label_print_batch_items`: policies now follow the parent batch's branch.

3. Security
- RLS stays enabled on both tables; policies scoped TO authenticated.
- Grants unchanged.

4. Notes
- No data is modified; only policies are replaced.
*/

-- label_print_batches
DROP POLICY IF EXISTS "select_own_label_print_batches" ON public.label_print_batches;
DROP POLICY IF EXISTS "insert_own_label_print_batches" ON public.label_print_batches;
DROP POLICY IF EXISTS "update_own_label_print_batches" ON public.label_print_batches;
DROP POLICY IF EXISTS "delete_own_label_print_batches" ON public.label_print_batches;
DROP POLICY IF EXISTS "select_branch_label_print_batches" ON public.label_print_batches;
DROP POLICY IF EXISTS "insert_branch_label_print_batches" ON public.label_print_batches;
DROP POLICY IF EXISTS "update_branch_label_print_batches" ON public.label_print_batches;
DROP POLICY IF EXISTS "delete_branch_label_print_batches" ON public.label_print_batches;

CREATE POLICY "select_branch_label_print_batches" ON public.label_print_batches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND (me.branch_id IS NULL OR me.branch_id = label_print_batches.branch_id)
    )
  );

CREATE POLICY "insert_branch_label_print_batches" ON public.label_print_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND (me.branch_id IS NULL OR me.branch_id = label_print_batches.branch_id)
    )
  );

CREATE POLICY "update_branch_label_print_batches" ON public.label_print_batches
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND (me.branch_id IS NULL OR me.branch_id = label_print_batches.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND (me.branch_id IS NULL OR me.branch_id = label_print_batches.branch_id)
    )
  );

CREATE POLICY "delete_branch_label_print_batches" ON public.label_print_batches
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND (me.branch_id IS NULL OR me.branch_id = label_print_batches.branch_id)
    )
  );

-- label_print_batch_items
DROP POLICY IF EXISTS "select_own_label_print_batch_items" ON public.label_print_batch_items;
DROP POLICY IF EXISTS "insert_own_label_print_batch_items" ON public.label_print_batch_items;
DROP POLICY IF EXISTS "update_own_label_print_batch_items" ON public.label_print_batch_items;
DROP POLICY IF EXISTS "delete_own_label_print_batch_items" ON public.label_print_batch_items;
DROP POLICY IF EXISTS "select_branch_label_print_batch_items" ON public.label_print_batch_items;
DROP POLICY IF EXISTS "insert_branch_label_print_batch_items" ON public.label_print_batch_items;
DROP POLICY IF EXISTS "update_branch_label_print_batch_items" ON public.label_print_batch_items;
DROP POLICY IF EXISTS "delete_branch_label_print_batch_items" ON public.label_print_batch_items;

CREATE POLICY "select_branch_label_print_batch_items" ON public.label_print_batch_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.label_print_batches b
      WHERE b.id = label_print_batch_items.batch_id
        AND EXISTS (
          SELECT 1 FROM public.profiles me
          WHERE me.id = auth.uid()
            AND (me.branch_id IS NULL OR me.branch_id = b.branch_id)
        )
    )
  );

CREATE POLICY "insert_branch_label_print_batch_items" ON public.label_print_batch_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.label_print_batches b
      WHERE b.id = label_print_batch_items.batch_id
        AND EXISTS (
          SELECT 1 FROM public.profiles me
          WHERE me.id = auth.uid()
            AND (me.branch_id IS NULL OR me.branch_id = b.branch_id)
        )
    )
  );

CREATE POLICY "update_branch_label_print_batch_items" ON public.label_print_batch_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.label_print_batches b
      WHERE b.id = label_print_batch_items.batch_id
        AND EXISTS (
          SELECT 1 FROM public.profiles me
          WHERE me.id = auth.uid()
            AND (me.branch_id IS NULL OR me.branch_id = b.branch_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.label_print_batches b
      WHERE b.id = label_print_batch_items.batch_id
        AND EXISTS (
          SELECT 1 FROM public.profiles me
          WHERE me.id = auth.uid()
            AND (me.branch_id IS NULL OR me.branch_id = b.branch_id)
        )
    )
  );

CREATE POLICY "delete_branch_label_print_batch_items" ON public.label_print_batch_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.label_print_batches b
      WHERE b.id = label_print_batch_items.batch_id
        AND EXISTS (
          SELECT 1 FROM public.profiles me
          WHERE me.id = auth.uid()
            AND (me.branch_id IS NULL OR me.branch_id = b.branch_id)
        )
    )
  );