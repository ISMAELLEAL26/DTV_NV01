/*
# Owner-only stock report data

1. New Functions
- `get_owner_stock_report()` returns, as one JSON object, the active (not deleted) products with the fields the stock summary needs (name, SKU, department, category, cost, sale price, package flag) and every per-branch stock row with its location.

2. Security
- The function checks `is_admin()` (the same owner test used across the app: role permissions include 'all') and raises an access error for anyone else, so the cost and stock figures are never returned to other staff even by calling the API directly.
- EXECUTE is revoked from PUBLIC and anon and granted only to authenticated; the body runs with the definer's rights and a fixed search_path.

3. Notes
- No tables, columns or existing policies are changed. Deleted products are excluded so the summary matches the catalog.
*/

CREATE OR REPLACE FUNCTION public.get_owner_stock_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede consultar el resumen de inventario' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'sku', p.sku,
        'department', p.department,
        'category_id', p.category_id,
        'cost_price', p.cost_price,
        'sale_price', p.sale_price,
        'is_package', p.is_package
      ))
      FROM public.products p
      WHERE p.deleted_at IS NULL
    ), '[]'::jsonb),
    'stock', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', s.product_id,
        'branch_id', s.branch_id,
        'location_id', s.location_id,
        'quantity', s.quantity
      ))
      FROM public.product_stock s
      JOIN public.products p ON p.id = s.product_id
      WHERE p.deleted_at IS NULL
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_owner_stock_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_stock_report() TO authenticated;
