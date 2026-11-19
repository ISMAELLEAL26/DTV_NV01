/*
# Add branch authorization email copy

1. Purpose
- Adds an optional copy address to each branch so authorization-token emails can reach both the configured branch mailbox and an additional mailbox.

2. Modified Tables
- `branches.email_cc` (text, nullable): optional comma-separated email address list used as CC for branch authorization emails.

3. Security
- No new table is created.
- Existing branch permissions and row-level security remain unchanged.

4. Notes
- Existing branch email values are preserved.
- The field is optional and can contain one or more comma-separated addresses.
*/

ALTER TABLE public.branches
ADD COLUMN IF NOT EXISTS email_cc text;
