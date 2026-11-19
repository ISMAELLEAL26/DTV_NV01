/*
# Cierre administrativo de caja

Permite al administrador cerrar cualquier caja abierta de cualquier vendedor,
calculando el total esperado en el servidor y liberando la caja para uso.

## Nueva función admin_close_cash_register
- SECURITY DEFINER, solo admin.
- Recibe p_register_id y p_counted_amount.
- Calcula el esperado: apertura + ventas en efectivo + ingresos - egresos.
- Guarda closing_amount, expected_amount, difference, closed_at.
- Devuelve un resumen con todos los totales para mostrar en el reporte.

## Seguridad
- Solo is_admin() puede ejecutarla.
- REVOKE EXECUTE de anon.
- No modifica ninguna otra configuración ni caja.
*/

CREATE OR REPLACE FUNCTION public.admin_close_cash_register(p_register_id uuid, p_counted_amount numeric DEFAULT 0)
RETURNS TABLE (
  id uuid,
  folio text,
  opening_amount numeric,
  cash_sales numeric,
  ingresos numeric,
  egresos numeric,
  expected_amount numeric,
  counted_amount numeric,
  difference numeric,
  closed_at timestamptz,
  cashier_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_register public.cash_registers%ROWTYPE;
  v_cash_sales numeric := 0;
  v_ingresos numeric := 0;
  v_egresos numeric := 0;
  v_expected numeric := 0;
  v_diff numeric := 0;
  v_cashier_name text := '';
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_register_id IS NULL THEN RAISE EXCEPTION 'ID de caja requerido'; END IF;

  SELECT * INTO v_register FROM public.cash_registers WHERE id = p_register_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caja no encontrada'; END IF;
  IF v_register.status <> 'abierta' THEN RAISE EXCEPTION 'La caja ya está cerrada'; END IF;

  SELECT COALESCE(SUM(Number(s.total)), 0) INTO v_cash_sales
  FROM public.sales s
  WHERE s.cash_register_id = p_register_id AND s.status = 'completada' AND s.payment_method = 'efectivo';

  SELECT COALESCE(SUM(CASE WHEN m.type = 'ingreso' THEN Number(m.amount) ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN m.type = 'egreso' THEN Number(m.amount) ELSE 0 END), 0)
  INTO v_ingresos, v_egresos
  FROM public.cash_movements m
  WHERE m.cash_register_id = p_register_id;

  v_expected := Number(v_register.opening_amount) + v_cash_sales + v_ingresos - v_egresos;
  v_diff := Number(p_counted_amount) - v_expected;

  UPDATE public.cash_registers
  SET status = 'cerrada',
      closing_amount = Number(p_counted_amount),
      expected_amount = v_expected,
      difference = v_diff,
      closed_at = now(),
      closing_breakdown = jsonb_build_object(
        'admin_close', true,
        'closed_by', auth.uid(),
        'cash', jsonb_build_object('expected', v_expected, 'counted', Number(p_counted_amount), 'difference', v_diff)
      )
  WHERE id = p_register_id;

  SELECT p.full_name INTO v_cashier_name
  FROM public.profiles p
  WHERE p.id = v_register.user_id;

  RETURN QUERY SELECT
    v_register.id,
    v_register.folio,
    v_register.opening_amount,
    v_cash_sales,
    v_ingresos,
    v_egresos,
    v_expected,
    Number(p_counted_amount),
    v_diff,
    now(),
    v_cashier_name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_close_cash_register(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_cash_register(uuid, numeric) TO authenticated;