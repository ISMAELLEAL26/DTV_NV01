/*
# Campos de cliente: código único, apellidos y dirección estructurada

1. Cambios a la tabla `customers`
- `codigo_cliente` (text, único). Código único de cliente generado por la aplicación.
- `paterno` (text). Apellido pateno.
- `materno` (text). Apellido materno.
- `calle` (text). Calle del domicilio.
- `numero_ext` (text). Número exterior.
- `colonia` (text). Colonia.
- `poblacion` (text). Población/localidad.
- `municipio` (text). Municipio.
- El campo existente `name` se conserva como nombre compuesto.

2. Seguridad
- La tabla `customers` ya tiene RLS y políticas CRUD para `authenticated`.
- No se cambian políticas ni grants existentes.
- El trigger `customers_protect_wallet_balance` sigue protegiendo `saldo_monedero`.
- Se agrega un índice único para `codigo_cliente`.
*/

ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_cliente text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS paterno text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS materno text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS calle text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS numero_ext text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS colonia text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS poblacion text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS municipio text;

CREATE UNIQUE INDEX IF NOT EXISTS customers_codigo_cliente_unique ON customers (codigo_cliente) WHERE codigo_cliente IS NOT NULL;
