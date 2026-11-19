/*
# Link cash refunds to sales and label full cancellations

1. Modified tables
- `cash_movements`: new nullable column `sale_id` that points to the sale a movement belongs to. Manual cash movements keep it empty.

2. Modified function
- `process_sale_return`: when a cash sale is cancelled or partly returned, the automatic cash outflow is still recorded on the cash register where the sale was made. Full cancellations now read "Cancelación de venta <folio>", partial returns keep "Devolución de venta <folio>". Each outflow stores the sale it belongs to.

3. Data backfill
- Existing automatic outflows whose reason matches a sale folio are linked to that sale.

4. Security
- No grants or policies change. The function keeps its existing permission checks and SECURITY DEFINER settings.
- Re-running is safe: the column is added only if missing, the function is replaced, and the backfill only touches unlinked rows.

5. Notes
- Cash expected totals must not subtract sale-linked outflows a second time, because the sale total is already reduced by the refund.
*/

ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cash_movements_sale_id ON public.cash_movements (sale_id);

CREATE OR REPLACE FUNCTION public.process_sale_return(p_sale_id uuid, p_full boolean, p_items jsonb, p_reason text)
 RETURNS TABLE(refund_total numeric, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_actor uuid := auth.uid();
v_sale public.sales%ROWTYPE;
v_item record;
v_requested numeric;
v_remaining numeric;
v_refund numeric := 0;
v_ratio numeric;
v_subtotal_refund numeric := 0;
v_tax_refund numeric := 0;
v_discount_refund numeric := 0;
BEGIN
IF v_actor IS NULL OR NOT EXISTS (
SELECT 1 FROM public.profiles p
JOIN public.roles r ON r.id = p.role_id
WHERE p.id = v_actor AND p.active = true
AND (r.permissions ? 'all' OR r.permissions ? 'settings' OR r.permissions ? 'reports')
) THEN
RAISE EXCEPTION 'No autorizado para devolver esta venta.';
END IF;

SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
IF NOT FOUND OR v_sale.status <> 'completada' THEN
RAISE EXCEPTION 'La venta ya no está disponible para devolución.';
END IF;

IF p_full THEN
IF EXISTS (SELECT 1 FROM public.sale_items WHERE sale_id = p_sale_id AND returned_quantity > 0) THEN
RAISE EXCEPTION 'La venta ya tiene devoluciones parciales.';
END IF;
FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id = p_sale_id FOR UPDATE LOOP
IF v_item.product_id IS NOT NULL THEN
UPDATE public.product_stock SET quantity = quantity + v_item.quantity
WHERE product_id = v_item.product_id AND branch_id = v_sale.branch_id;
END IF;
UPDATE public.sale_items SET returned_quantity = quantity WHERE id = v_item.id;
END LOOP;
v_refund := v_sale.total;
UPDATE public.sales SET status = 'cancelada', canceled_at = now(), canceled_by = v_actor, cancellation_reason = NULLIF(trim(p_reason), ''), total = 0, subtotal = 0, tax = 0, discount = 0 WHERE id = p_sale_id;
ELSE
IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
RAISE EXCEPTION 'Selecciona al menos un producto para devolver.';
END IF;
FOR v_item IN SELECT si.*, requested.quantity AS requested_quantity
FROM public.sale_items si
JOIN LATERAL jsonb_to_recordset(p_items) AS requested(item_id uuid, quantity numeric) ON requested.item_id = si.id
WHERE si.sale_id = p_sale_id FOR UPDATE LOOP
v_requested := v_item.requested_quantity;
v_remaining := v_item.quantity - v_item.returned_quantity;
IF v_requested IS NULL OR v_requested <= 0 OR v_requested > v_remaining THEN
RAISE EXCEPTION 'La cantidad devuelta no es válida.';
END IF;
v_ratio := v_requested / v_item.quantity;
v_refund := v_refund + v_item.line_total * v_ratio;
v_subtotal_refund := v_subtotal_refund + (v_item.line_total * v_ratio);
UPDATE public.sale_items SET returned_quantity = returned_quantity + v_requested WHERE id = v_item.id;
IF v_item.product_id IS NOT NULL THEN
UPDATE public.product_stock SET quantity = quantity + v_requested
WHERE product_id = v_item.product_id AND branch_id = v_sale.branch_id;
END IF;
END LOOP;
IF v_refund <= 0 THEN RAISE EXCEPTION 'No se encontraron productos válidos para devolver.'; END IF;
v_ratio := v_refund / NULLIF(v_sale.subtotal, 0);
v_tax_refund := v_sale.tax * COALESCE(v_ratio, 0);
v_discount_refund := v_sale.discount * COALESCE(v_ratio, 0);
UPDATE public.sales SET subtotal = GREATEST(0, subtotal - v_subtotal_refund), tax = GREATEST(0, tax - v_tax_refund), discount = GREATEST(0, discount - v_discount_refund), total = GREATEST(0, total - v_refund), canceled_at = now(), canceled_by = v_actor, cancellation_reason = NULLIF(trim(p_reason), ''), status = CASE WHEN NOT EXISTS (SELECT 1 FROM public.sale_items WHERE sale_id = p_sale_id AND returned_quantity < quantity) THEN 'cancelada' ELSE status END WHERE id = p_sale_id;
END IF;

IF v_sale.payment_method = 'efectivo' AND v_sale.cash_register_id IS NOT NULL AND v_refund > 0 THEN
INSERT INTO public.cash_movements (cash_register_id, type, amount, reason, sale_id)
VALUES (
v_sale.cash_register_id,
'egreso',
v_refund,
CASE WHEN p_full THEN 'Cancelación de venta ' ELSE 'Devolución de venta ' END || COALESCE(v_sale.folio, p_sale_id::text),
p_sale_id
);
END IF;

RETURN QUERY SELECT v_refund, CASE WHEN p_full THEN 'cancelada' ELSE 'devolución registrada' END;
END;
$function$;

UPDATE public.cash_movements m
SET sale_id = s.id
FROM public.sales s
WHERE m.sale_id IS NULL
AND m.type = 'egreso'
AND m.reason = 'Devolución de venta ' || COALESCE(s.folio, s.id::text);
