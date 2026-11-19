/*
# Restrict attendance visibility to the employee or administrator

1. Change
- Employees can read only their own attendance rows.
- Administrators can continue reading attendance for all accessible branches.
- Existing insert, update, and delete rules remain unchanged.

2. Security
- The previous SELECT policy allowed any active employee to read all attendance rows in an accessible branch.
- The new policy enforces the same visibility rule on the database, so hiding rows in the interface is not the only protection.
- Attendance history remains available to the employee who owns it and to administrators.
*/

DROP POLICY IF EXISTS "staff_select_attendance" ON public.attendance;

CREATE POLICY "staff_select_own_or_admin_attendance"
ON public.attendance FOR SELECT
TO authenticated
USING (
  is_active_staff()
  AND (
    is_admin()
    OR (
      user_id = auth.uid()
      AND ((branch_id IS NULL) OR user_can_access_branch(branch_id))
    )
  )
);