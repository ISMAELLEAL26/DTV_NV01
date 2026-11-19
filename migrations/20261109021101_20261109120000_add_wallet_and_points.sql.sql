/*
# Monedero electrónico y puntos de cliente

1. Clientes
- Usa la columna `phone` existente como teléfono de 10 dígitos. Es única (si no está vacía) y sirve para buscar al cliente en caja.
- Nueva columna `saldo_monedero` (numérico, por defecto 0). Solo cambia por medio de la función de cobro.

2. Productos
- Nueva columna `acumula_puntos` (booleano, por defecto TRUE).
- Un disparador marca `acumula_puntos = FALSE` para productos cuyo departamento o categoría contenga "PROGRAMA FEDERAL", "DICONSA" o "BIENESTAR" (sin distinguir mayúsculas ni acentos).
- Se ejecuta una vez al aplicar la migración para los productos ya existentes.

3. Historial de monedero (`wallet_movements`)
- Guarda cada movimiento: cliente, venta, folio, tipo (ACUMULACION, ABONO_CAMBIO, PAGO_REDENCION), monto y fecha.
- Solo lectura para usuarios autenticados. Las escrituras se hacen por la función de cobro.

4. Función `apply_wallet_sale`
- Se llama después de guardar la venta. Calcula en el servidor el 1% de los productos que acumulan puntos.
- Valida que la venta esté completada, que el cliente sea el de la venta, que no se haya aplicado antes, que el saldo alcance y que el cambio guardado no exceda el cambio real.
- Registra los movimientos y actualiza el saldo en una sola transacción.

5. Seguridad
- Un disparador impide cambiar `saldo_monedero` fuera de la función de cobro.
- La función solo puede ser ejecutada por usuarios autenticados.
*/

ALTER TABLE customers ADD COLUMN IF NOT EXISTS saldo_monedero numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_phone_ten_digits') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_phone_ten_digits CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON customers (phone) WHERE phone IS NOT NULL;

ALTER TABLE products ADD COLUMN IF NOT EXISTS acumula_puntos boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION is_points_exempt_label(label text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(translate(coalesce(label, ''), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')) ~ '(PROGRAMA FEDERAL|DICONSA|BIENESTAR)';
$$;

CREATE OR REPLACE FUNCTION apply_points_exemption()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  category_label text;
BEGIN
  SELECT name INTO category_label FROM categories WHERE id = NEW.category_id;
  IF is_points_exempt_label(NEW.department) OR is_points_exempt_label(category_label) THEN
    NEW.acumula_puntos := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_points_exemption ON products;
CREATE TRIGGER products_points_exemption
  BEFORE INSERT OR UPDATE OF category_id, department ON products
  FOR EACH ROW EXECUTE FUNCTION apply_points_exemption();

UPDATE products p
SET acumula_puntos = false
WHERE is_points_exempt_label(p.department)
  OR is_points_exempt_label((SELECT c.name FROM categories c WHERE c.id = p.category_id));

CREATE TABLE IF NOT EXISTS wallet_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  folio_venta text,
  tipo text NOT NULL CHECK (tipo IN ('ACUMULACION', 'ABONO_CAMBIO', 'PAGO_REDENCION')),
  monto numeric NOT NULL CHECK (monto > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_movements_customer_idx ON wallet_movements (customer_id, created_at);
CREATE INDEX IF NOT EXISTS wallet_movements_sale_idx ON wallet_movements (sale_id);

ALTER TABLE wallet_movements ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON wallet_movements TO authenticated;

DROP POLICY IF EXISTS "select_wallet_movements" ON wallet_movements;
CREATE POLICY "select_wallet_movements" ON wallet_movements FOR SELECT
  TO authenticated USING (true);

CREATE OR REPLACE FUNCTION protect_customer_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.saldo_monedero IS DISTINCT FROM OLD.saldo_monedero
     AND coalesce(current_setting('app.wallet_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'El saldo del monedero solo se modifica desde una venta';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_protect_wallet_balance ON customers;
CREATE TRIGGER customers_protect_wallet_balance
  BEFORE UPDATE OF saldo_monedero ON customers
  FOR EACH ROW EXECUTE FUNCTION protect_customer_wallet_balance();

CREATE OR REPLACE FUNCTION apply_wallet_sale(
  p_sale_id uuid,
  p_redeem numeric,
  p_change_to_wallet numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_balance numeric;
  v_earned numeric;
  v_change numeric;
  v_redeem numeric := round(coalesce(p_redeem, 0), 2);
  v_to_wallet numeric := round(coalesce(p_change_to_wallet, 0), 2);
BEGIN
  IF v_redeem < 0 OR v_to_wallet < 0 THEN
    RAISE EXCEPTION 'Montos inválidos';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.customer_id IS NULL OR v_sale.status <> 'completada' THEN
    RAISE EXCEPTION 'La venta no es válida para el monedero';
  END IF;
  IF v_redeem > v_sale.total THEN
    RAISE EXCEPTION 'El pago con monedero excede el total de la venta';
  END IF;
  IF v_to_wallet > v_sale.change THEN
    RAISE EXCEPTION 'El cambio a monedero excede el cambio de la venta';
  END IF;
  IF EXISTS (SELECT 1 FROM wallet_movements WHERE sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'El monedero de esta venta ya fue aplicado';
  END IF;

  SELECT saldo_monedero INTO v_balance FROM customers WHERE id = v_sale.customer_id FOR UPDATE;
  IF v_redeem > v_balance THEN
    RAISE EXCEPTION 'Saldo de monedero insuficiente';
  END IF;

  SELECT coalesce(round(sum(si.line_total) * 0.01, 2), 0) INTO v_earned
  FROM sale_items si
  JOIN products p ON p.id = si.product_id
  WHERE si.sale_id = p_sale_id AND p.acumula_puntos = true;

  PERFORM set_config('app.wallet_rpc', 'on', true);

  UPDATE customers
  SET saldo_monedero = saldo_monedero + v_earned + v_to_wallet - v_redeem
  WHERE id = v_sale.customer_id
  RETURNING saldo_monedero INTO v_balance;

  INSERT INTO wallet_movements (customer_id, sale_id, folio_venta, tipo, monto)
  SELECT v_sale.customer_id, p_sale_id, v_sale.folio, m.tipo, m.monto
  FROM (VALUES
    ('PAGO_REDENCION', v_redeem),
    ('ACUMULACION', v_earned),
    ('ABONO_CAMBIO', v_to_wallet)
  ) AS m(tipo, monto)
  WHERE m.monto > 0;

  UPDATE sales
  SET payment_details = coalesce(payment_details, '{}'::jsonb) || jsonb_build_object(
    'wallet_redeemed', v_redeem,
    'wallet_points_earned', v_earned,
    'wallet_change_saved', v_to_wallet,
    'wallet_balance_after', v_balance
  )
  WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'redeemed', v_redeem,
    'points_earned', v_earned,
    'change_saved', v_to_wallet,
    'balance', v_balance
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_wallet_sale(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_wallet_sale(uuid, numeric, numeric) TO authenticated;
