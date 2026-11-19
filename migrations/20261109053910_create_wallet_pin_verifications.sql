/*
# Wallet PIN verifications table

## Purpose
Store one-time PIN codes for wallet/monedero payment authorization.
The edge function generates a PIN, stores its hash, and the POS verifies it
before allowing the sale to proceed.

## New Tables
- `wallet_pin_verifications`
  - `id` (uuid, PK)
  - `customer_id` (uuid, FK to customers)
  - `sale_id` (uuid, nullable, FK to sales — set after verification)
  - `pin_hash` (text, SHA-256 of the PIN, never store the raw PIN)
  - `email` (text, where the PIN was sent)
  - `amount` (numeric, the amount being authorized)
  - `status` (text: 'pending', 'verified', 'expired', 'cancelled')
  - `expires_at` (timestamptz, 10 minutes from creation)
  - `verified_at` (timestamptz, nullable)
  - `created_at` (timestamptz, default now())

## Security
- RLS enabled
- GRANT to authenticated only (requires sign-in)
- Users can read/insert/update only their own records (by user_id)
- service_role granted for edge function access
*/

CREATE TABLE IF NOT EXISTS wallet_pin_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  pin_hash text NOT NULL,
  email text NOT NULL,
  amount numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wallet_pin_verifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON wallet_pin_verifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON wallet_pin_verifications TO service_role;

DROP POLICY IF EXISTS "select_own_pin_verifications" ON wallet_pin_verifications;
CREATE POLICY "select_own_pin_verifications"
ON wallet_pin_verifications FOR SELECT
TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_pin_verifications" ON wallet_pin_verifications;
CREATE POLICY "insert_own_pin_verifications"
ON wallet_pin_verifications FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_pin_verifications" ON wallet_pin_verifications;
CREATE POLICY "update_own_pin_verifications"
ON wallet_pin_verifications FOR UPDATE
TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_pin_verifications" ON wallet_pin_verifications;
CREATE POLICY "delete_own_pin_verifications"
ON wallet_pin_verifications FOR DELETE
TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_wallet_pin_verifications_status ON wallet_pin_verifications (status, expires_at);
