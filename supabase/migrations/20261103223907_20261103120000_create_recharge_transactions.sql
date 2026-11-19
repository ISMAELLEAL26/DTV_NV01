/*
# Create recharge transaction tracking

1. New Tables
- `recharge_transactions`: records each recharge attempt separately from a sale until the provider result is confirmed.
- `id`: unique recharge attempt identifier.
- `branch_id`: branch where the recharge was processed.
- `user_id`: authenticated employee who initiated the recharge.
- `cash_register_id`: open cash register used for the collection.
- `company`: provider company selected by the employee.
- `phone`: destination phone number.
- `amount`: collected recharge amount.
- `provider_folio`: authorization folio returned by the provider.
- `provider_reference`: provider response metadata kept for traceability.
- `status`: `pendiente`, `exitosa`, or `anulada`.
- `failure_reason`: required explanation when the employee confirms the recharge did not succeed.
- `sale_id`: linked sale after confirmation.
- `created_at`, `confirmed_at`: lifecycle timestamps.

2. Security
- Row level security is enabled.
- Authenticated users can only read and update their own recharge attempts.
- Authenticated users can insert attempts owned by their current session.
- No delete access is granted so the operational history remains auditable.

3. Important notes
- A recharge attempt is not a sale by itself.
- The sale link is filled only after the provider result is confirmed.
- An unsuccessful attempt remains visible as `anulada` with its reason.
*/

CREATE TABLE IF NOT EXISTS public.recharge_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  cash_register_id uuid NULL REFERENCES public.cash_registers(id),
  company text NOT NULL,
  phone text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  provider_folio text NULL,
  provider_reference jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'exitosa', 'anulada')),
  failure_reason text NULL,
  sale_id uuid NULL REFERENCES public.sales(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS recharge_transactions_branch_created_idx
  ON public.recharge_transactions (branch_id, created_at DESC);

ALTER TABLE public.recharge_transactions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.recharge_transactions TO authenticated;

DROP POLICY IF EXISTS "recharge_select_own" ON public.recharge_transactions;
CREATE POLICY "recharge_select_own" ON public.recharge_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "recharge_insert_own" ON public.recharge_transactions;
CREATE POLICY "recharge_insert_own" ON public.recharge_transactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "recharge_update_own" ON public.recharge_transactions;
CREATE POLICY "recharge_update_own" ON public.recharge_transactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
