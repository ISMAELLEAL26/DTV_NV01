/*
# Add administrator-only product trash emptying

1. New database function
- `empty_deleted_products()` permanently removes every product currently in the product trash.
- It first removes inventory count lines that reference those trashed products because that historical relation currently prevents permanent deletion.
- Other product relations keep their existing database behavior: stock, packages, adjustments, and transfers cascade; sales, purchases, and supplier orders retain their rows with a null product reference.

2. Security
- The function is SECURITY DEFINER with a fixed public search path.
- Only an authenticated administrator can execute it; the function checks `is_admin()` using the caller session.
- Anonymous callers cannot execute it.

3. Important notes
- This action is irreversible and is called only after the application displays a confirmation.
- The function affects only rows where `products.deleted_at` is not null.
*/

CREATE OR REPLACE FUNCTION public.empty_deleted_products()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.inventory_counts
  WHERE product_id IN (
    SELECT id FROM public.products WHERE deleted_at IS NOT NULL
  );

  DELETE FROM public.products
  WHERE deleted_at IS NOT NULL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.empty_deleted_products() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empty_deleted_products() TO authenticated;