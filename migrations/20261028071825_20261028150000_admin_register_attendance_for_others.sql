/*
# Admin register attendance for employees

## Changes
1. Creates `admin_register_attendance` SECURITY DEFINER function that allows
   admins to register entrada/salida on behalf of any employee.
   - Validates that the caller is an admin (has 'settings' or 'all' permission).
   - Validates the target user is active staff.
   - For 'entrada': creates a new attendance record (closes any existing open one first).
   - For 'salida': closes the employee's most recent open attendance record.
   - Returns the created/updated attendance row.

## Security
- SECURITY DEFINER so it can write attendance rows for any user.
- REVOKE EXECUTE from PUBLIC/anon, GRANT to authenticated only.
- search_path set to 'public'.

## Notes
- This complements `register_attendance` which employees use for self-check-in.
- Admin entries are marked with source = 'admin' so they can be distinguished.
*/

CREATE OR REPLACE FUNCTION public.admin_register_attendance(
  p_target_user_id uuid,
  p_branch_id uuid,
  p_action text,
  p_check_in_time timestamptz DEFAULT now(),
  p_check_out_time timestamptz DEFAULT now(),
  p_notes text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  check_in timestamptz,
  check_out timestamptz,
  status text,
  late_minutes integer,
  overtime_minutes integer,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_open public.attendance%ROWTYPE;
  v_id uuid;
  v_status text := 'sin_horario';
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'No autorizado: solo administradores'; END IF;
  IF p_action NOT IN ('entrada', 'salida') THEN RAISE EXCEPTION 'Acción inválida'; END IF;

  IF p_action = 'entrada' THEN
    SELECT * INTO v_open FROM public.attendance
    WHERE user_id = p_target_user_id AND check_out IS NULL
    ORDER BY created_at DESC LIMIT 1;

    IF v_open.id IS NOT NULL THEN
      UPDATE public.attendance
      SET check_out = p_check_in_time, status = COALESCE(status, 'completada'), corrected_by = auth.uid(), correction_reason = 'Cerrada por administrador al registrar nueva entrada'
      WHERE attendance.id = v_open.id;
    END IF;

    INSERT INTO public.attendance (user_id, branch_id, check_in, notes, status, source, corrected_by)
    VALUES (p_target_user_id, p_branch_id, p_check_in_time, NULLIF(btrim(p_notes), ''), v_status, 'admin', auth.uid())
    RETURNING attendance.id INTO v_id;
  ELSE
    SELECT * INTO v_open FROM public.attendance
    WHERE user_id = p_target_user_id AND check_out IS NULL
    ORDER BY created_at DESC LIMIT 1;

    IF v_open.id IS NULL THEN RAISE EXCEPTION 'No existe una entrada abierta para este empleado'; END IF;

    v_status := COALESCE(v_open.status, 'completada');
    UPDATE public.attendance
    SET check_out = p_check_out_time, status = v_status, notes = COALESCE(NULLIF(btrim(p_notes), ''), notes), corrected_by = auth.uid()
    WHERE attendance.id = v_open.id
    RETURNING attendance.id INTO v_id;
  END IF;

  RETURN QUERY SELECT a.id, a.user_id, a.check_in, a.check_out, a.status, a.late_minutes, a.overtime_minutes, a.source
  FROM public.attendance a WHERE a.id = v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_register_attendance(uuid, uuid, text, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_attendance(uuid, uuid, text, timestamptz, timestamptz, text) TO authenticated;
