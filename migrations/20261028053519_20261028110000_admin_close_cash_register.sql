/*
# Corrección del cierre administrativo de caja

Corrige la función de cierre administrativo para evitar la ambigüedad del campo
`id` y usar conversiones numéricas compatibles con PostgreSQL.

## Seguridad
- Mantiene el cierre restringido a administradores.
- Mantiene el cierre limitado a la caja seleccionada.
- No modifica otras cajas ni configuraciones.
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
  v_closed_at timestamptz := now();
  v_cashier_name text := '';
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_register_id IS NULL THEN RAISE EXCEPTION 'ID de caja requerido'; END IF;

  SELECT cr.* INTO v_register
  FROM public.cash_registers AS cr
  WHERE cr.id = p_register_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Caja no encontrada'; END IF;
  IF v_register.status <> 'abierta' THEN RAISE EXCEPTION 'La caja ya está cerrada'; END IF;

  SELECT COALESCE(SUM(s.total::numeric), 0)
  INTO v_cash_sales
  FROM public.sales AS s
  WHERE s.cash_register_id = p_register_id
    AND s.status = 'completada'
    AND s.payment_method = 'efectivo';

  SELECT
    COALESCE(SUM(CASE WHEN cm.type = 'ingreso' THEN cm.amount::numeric ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.type = 'egreso' THEN cm.amount::numeric ELSE 0 END), 0)
  INTO v_ingresos, v_egresos
  FROM public.cash_movements AS cm
  WHERE cm.cash_register_id = p_register_id;

  v_expected := v_register.opening_amount::numeric + v_cash_sales + v_ingresos - v_egresos;
  v_diff := p_counted_amount::numeric - v_expected;

  UPDATE public.cash_registers AS cr
  SET status = 'cerrada',
      closing_amount = p_counted_amount,
      expected_amount = v_expected,
      difference = v_diff,
      closed_at = v_closed_at,
      closing_breakdown = jsonb_build_object(
        'admin_close', true,
        'closed_by', auth.uid(),
        'cash', jsonb_build_object('expected', v_expected, 'counted', p_counted_amount, 'difference', v_diff)
      )
  WHERE cr.id = p_register_id;

  SELECT p.full_name INTO v_cashier_name
  FROM public.profiles AS p
  WHERE p.id = v_register.user_id;

  RETURN QUERY SELECT
    v_register.id,
    v_register.folio,
    v_register.opening_amount::numeric,
    v_cash_sales,
    v_ingresos,
    v_egresos,
    v_expected,
    p_counted_amount::numeric,
    v_diff,
    v_closed_at,
    v_cashier_name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_close_cash_register(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_cash_register(uuid, numeric) TO authenticated;