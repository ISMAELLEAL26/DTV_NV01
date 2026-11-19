/*
# Proveedores completos y compras avanzadas

1. Proveedores
- Amplía `suppliers` con razón social, nombre comercial, teléfonos, días de visita, días de entrega, ruta de reparto y condiciones de crédito.
- `balance_due` conserva el saldo pendiente mostrado en el catálogo; la aplicación lo presenta junto con el historial de compras.

2. Compras y pedidos
- Amplía `purchases` y `supplier_orders` con subtotal antes de impuestos, subtotal con impuestos y total de impuestos.
- Amplía `purchase_items` y `supplier_order_items` para guardar si la compra fue por pieza o caja, cajas, piezas por caja, piezas totales, tipo de impuesto, inclusión de impuestos y precios antes/después de impuestos.

3. Seguridad
- Se conservan RLS y políticas existentes de las tablas ya protegidas.
- Los nuevos campos siguen la protección de las tablas existentes y no se crean accesos públicos nuevos.

4. Compatibilidad
- Todos los campos nuevos tienen valores predeterminados seguros para conservar órdenes y compras anteriores.
- No se eliminan columnas ni registros existentes.
*/

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS commercial_name text,
  ADD COLUMN IF NOT EXISTS phone_secondary text,
  ADD COLUMN IF NOT EXISTS visit_days text,
  ADD COLUMN IF NOT EXISTS delivery_days text,
  ADD COLUMN IF NOT EXISTS distribution_route text,
  ADD COLUMN IF NOT EXISTS credit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_term_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_due numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS subtotal_before_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_after_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE supplier_orders
  ADD COLUMN IF NOT EXISTS subtotal_before_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_after_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS purchase_unit text NOT NULL DEFAULT 'pieza',
  ADD COLUMN IF NOT EXISTS box_count numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pieces_per_box numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS piece_quantity numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tax_type text NOT NULL DEFAULT 'sin_impuesto',
  ADD COLUMN IF NOT EXISTS includes_tax boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unit_cost_before_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_after_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_subtotal_before_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_subtotal_after_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE supplier_order_items
  ADD COLUMN IF NOT EXISTS purchase_unit text NOT NULL DEFAULT 'pieza',
  ADD COLUMN IF NOT EXISTS box_count numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pieces_per_box numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS piece_quantity numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tax_type text NOT NULL DEFAULT 'sin_impuesto',
  ADD COLUMN IF NOT EXISTS includes_tax boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unit_cost_before_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_after_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_subtotal_before_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_subtotal_after_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_purchases_supplier_created ON purchases(supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_supplier_created ON supplier_orders(supplier_id, created_at DESC);
