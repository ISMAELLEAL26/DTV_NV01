/*
# Owner stock report uses branch prices and skips untracked products

## Plain-English summary
The owner-only stock report now values each branch's stock with that branch's cost and sale price when a product has per-branch prices. Products that do not track inventory are left out of the report, matching the inventory screens.

## 1. Changed function
- `get_owner_stock_report()` (still owner-only, same access check):
  - Each stock row now includes the effective `cost_price` and `sale_price` for its branch.
  - Products are returned with `track_inventory` and `prices_shared` fields.
  - Stock rows and products without inventory tracking are excluded.

## 2. Security
- Same owner check (`is_admin()`), same grants: executable by authenticated only.
- No tables or policies changed.

## Notes
- Idempotent: the function is replaced in place.
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
        'is_package', p.is_package,
        'prices_shared', p.prices_shared
      ))
      FROM public.products p
      WHERE p.deleted_at IS NULL AND p.track_inventory
    ), '[]'::jsonb),
    'stock', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', s.product_id,
        'branch_id', s.branch_id,
        'location_id', s.location_id,
        'quantity', s.quantity,
        'cost_price', CASE WHEN p.prices_shared THEN p.cost_price ELSE COALESCE(bp.cost_price, p.cost_price) END,
        'sale_price', CASE WHEN p.prices_shared THEN p.sale_price ELSE COALESCE(bp.sale_price, p.sale_price) END
      ))
      FROM public.product_stock s
      JOIN public.products p ON p.id = s.product_id
      LEFT JOIN public.product_branch_prices bp ON bp.product_id = s.product_id AND bp.branch_id = s.branch_id
      WHERE p.deleted_at IS NULL AND p.track_inventory
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_owner_stock_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_stock_report() TO authenticated;
