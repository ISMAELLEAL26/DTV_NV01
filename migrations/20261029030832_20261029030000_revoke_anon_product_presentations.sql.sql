/*
# Revoke anon access to product presentations

1. Changes
- Removes all table privileges granted to the anon role on product_presentations.

2. Security
- Only authenticated staff keep access, through the existing row level security policies.
- Re-running is safe: REVOKE on a missing privilege is a no-op.
*/

REVOKE ALL ON product_presentations FROM anon;
