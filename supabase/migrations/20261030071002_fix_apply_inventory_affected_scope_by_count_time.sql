/*
# Only flag products whose sales happened after their last count

1. Modified function
- `apply_inventory_authorization`: when it marks products as affected by cash operations, it now only marks a product if its latest sale (since the inventory session started) is newer than the time that product was last counted.

2. Why
- Previously any product with a sale since the session started was flagged, even after the user had recounted it. Recounting could never clear the block, so authorization kept failing with "Hay productos afectados".

3. Security
- No change to grants, policies, or the function signature. The function stays SECURITY DEFINER with the same search path.

4. Notes
- The change is applied with a text replacement inside the existing function body so the rest of the logic is untouched.
- Re-running this migration is safe: if the fix is already present, nothing changes.
*/

DO $$
DECLARE
  v_def text;
  v_old text := 'AND (p_product_ids IS NULL OR c.product_id = ANY(p_product_ids));';
  v_new text := 'AND (c.counted_at IS NULL OR o.last_at > c.counted_at)' || E'\n' || 'AND (p_product_ids IS NULL OR c.product_id = ANY(p_product_ids));';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'apply_inventory_authorization'
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'apply_inventory_authorization not found';
  END IF;

  IF position('o.last_at > c.counted_at' in v_def) > 0 THEN
    RETURN;
  END IF;

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected affected-scope clause not found in apply_inventory_authorization';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END $$;
