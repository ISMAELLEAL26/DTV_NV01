/*
# Add register_id to get_occupied_cash_boxes

1. Purpose
- The Purchases screen needs the cash register (turn) id to insert a cash
  exit movement for the purchase payment, but the previous version of the
  function only returned the box id and the user name, so the frontend could
  not map an open turn to its register row.

2. Modified functions
- `get_occupied_cash_boxes(uuid)`: now returns an extra `register_id uuid`
  column alongside `box_id` and `user_name`. Logic unchanged: open turns
  (`status = 'abierta'`) for the given branch with a box assigned.

3. Security
- Recreated as SECURITY DEFINER (needed so cashiers can see which boxes have
  open turns owned by other users, which the raw `cash_registers` RLS policy
  hides from them).
- Same grants as before: EXECUTE revoked from anon/PUBLIC, granted to
  `authenticated`.

4. Notes
- Existing callers (`cashTurn.ts`) only read `box_id`/`user_name`; the extra
  column is additive and backwards compatible.
*/

DROP FUNCTION IF EXISTS public.get_occupied_cash_boxes(uuid);

CREATE FUNCTION public.get_occupied_cash_boxes(p_branch_id uuid)
RETURNS TABLE (box_id uuid, register_id uuid, user_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.cash_box_id AS box_id,
         r.id AS register_id,
         COALESCE(p.full_name, 'Otro usuario') AS user_name
  FROM public.cash_registers r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.branch_id = p_branch_id
    AND r.status = 'abierta'
    AND r.cash_box_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_occupied_cash_boxes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_occupied_cash_boxes(uuid) TO authenticated;
