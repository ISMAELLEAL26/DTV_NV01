/*
# Eliminación segura de empleados

Permite al administrador eliminar un empleado cuando ya no tiene nómina pendiente.
Si tiene registros de nómina (payroll_entries / payroll_adjustments), la eliminación se bloquea
para conservar el historial contable y se sugiere inactivar al empleado en su lugar.
*/

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_payroll boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_target_id IS NULL THEN RAISE EXCEPTION 'ID requerido'; END IF;
  IF p_target_id = auth.uid() THEN RAISE EXCEPTION 'No puedes eliminar tu propia cuenta'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.payroll_entries WHERE user_id = p_target_id
  ) OR EXISTS (
    SELECT 1 FROM public.payroll_adjustments WHERE user_id = p_target_id
  ) INTO v_has_payroll;

  IF v_has_payroll THEN
    RAISE EXCEPTION 'Este empleado tiene registros de nómina. Inactívalo en lugar de eliminarlo para conservar el historial contable.';
  END IF;

  DELETE FROM public.user_branch_access WHERE user_id = p_target_id;
  DELETE FROM public.employee_schedules WHERE user_id = p_target_id;
  DELETE FROM public.attendance_incidents WHERE user_id = p_target_id;
  DELETE FROM public.attendance WHERE user_id = p_target_id;
  DELETE FROM public.profiles WHERE id = p_target_id;
  DELETE FROM auth.users WHERE id = p_target_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;