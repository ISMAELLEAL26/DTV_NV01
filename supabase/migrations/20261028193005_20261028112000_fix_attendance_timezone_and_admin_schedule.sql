/*
# Fix Mexico attendance dates and administrator scheduling

1. Problem addressed
- Weekly schedules were stored and read correctly in the database, but browser month helpers could send the previous month because they converted local midnight through UTC.
- Attendance lists grouped records by UTC date, which could show a record on the next day.
- Administrator-created attendance always used `sin_horario`, even when the employee had a weekly schedule.
- Administrator corrections could accept a future date.

2. Application-facing behavior
- The attendance calendar and weekly list use America/Mexico_City dates.
- Manual administrator dates are interpreted as Mexico local time and saved without moving to another day.
- Existing schedules are evaluated against the selected employee and selected attendance date.
- An administrator can correct any past day, including the current week, but cannot create a future attendance record.

3. Security and integrity
- No attendance rows are deleted or rewritten by this migration.
- The administrator RPC remains restricted to `is_admin()` and authenticated callers.
- Future timestamps are rejected server-side so a browser cannot bypass the rule.
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
  v_schedule public.employee_schedules%ROWTYPE;
  v_id uuid;
  v_status text := 'sin_horario';
  v_late integer := 0;
  v_local timestamp;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'No autorizado: solo administradores'; END IF;
  IF p_action NOT IN ('entrada', 'salida') THEN RAISE EXCEPTION 'Acción inválida'; END IF;
  IF (p_action = 'entrada' AND p_check_in_time > now()) OR (p_action = 'salida' AND p_check_out_time > now()) THEN
    RAISE EXCEPTION 'No se puede registrar asistencia en una fecha futura';
  END IF;

  IF p_action = 'entrada' THEN
    v_local := timezone('America/Mexico_City', p_check_in_time);
    SELECT es.* INTO v_schedule
    FROM public.employee_schedules es
    WHERE es.user_id = p_target_user_id
      AND es.month_start = date_trunc('month', v_local::date)::date
      AND es.day_of_week = extract(dow from v_local)::smallint
      AND es.active
      AND (es.branch_id IS NULL OR es.branch_id = p_branch_id)
    ORDER BY (es.branch_id IS NULL), es.created_at DESC
    LIMIT 1;

    SELECT a.* INTO v_open
    FROM public.attendance a
    WHERE a.user_id = p_target_user_id AND a.check_out IS NULL
    ORDER BY a.created_at DESC LIMIT 1;

    IF v_open.id IS NOT NULL THEN
      UPDATE public.attendance a
      SET check_out = p_check_in_time, status = COALESCE(a.status, 'completada'), corrected_by = auth.uid(), correction_reason = 'Cerrada por administrador al registrar nueva entrada'
      WHERE a.id = v_open.id;
    END IF;

    IF v_schedule.id IS NOT NULL AND NOT v_schedule.rest_day AND v_schedule.start_time IS NOT NULL THEN
      v_late := GREATEST(0, floor(extract(epoch from (v_local::time - (v_schedule.start_time + (v_schedule.tolerance_minutes * interval '1 minute')))) / 60)::integer);
      v_status := CASE WHEN v_late > 0 THEN 'retardo' ELSE 'puntual' END;
    END IF;

    INSERT INTO public.attendance (user_id, branch_id, check_in, notes, scheduled_start, scheduled_end, tolerance_minutes, late_minutes, status, source, corrected_by)
    VALUES (p_target_user_id, p_branch_id, p_check_in_time, NULLIF(btrim(p_notes), ''), v_schedule.start_time, v_schedule.end_time, COALESCE(v_schedule.tolerance_minutes, 0), v_late, v_status, 'admin', auth.uid())
    RETURNING attendance.id INTO v_id;
  ELSE
    SELECT a.* INTO v_open
    FROM public.attendance a
    WHERE a.user_id = p_target_user_id AND a.check_out IS NULL
    ORDER BY a.created_at DESC LIMIT 1;

    IF v_open.id IS NULL THEN RAISE EXCEPTION 'No existe una entrada abierta para este empleado'; END IF;

    v_status := COALESCE(v_open.status, 'completada');
    UPDATE public.attendance a
    SET check_out = p_check_out_time, status = v_status, notes = COALESCE(NULLIF(btrim(p_notes), ''), a.notes), corrected_by = auth.uid()
    WHERE a.id = v_open.id
    RETURNING a.id INTO v_id;
  END IF;

  RETURN QUERY SELECT a.id, a.user_id, a.check_in, a.check_out, a.status, a.late_minutes, a.overtime_minutes, a.source
  FROM public.attendance a WHERE a.id = v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_register_attendance(uuid, uuid, text, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_attendance(uuid, uuid, text, timestamptz, timestamptz, text) TO authenticated;