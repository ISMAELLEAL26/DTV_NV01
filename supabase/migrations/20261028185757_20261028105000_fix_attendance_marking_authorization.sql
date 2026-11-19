/*
# Fix attendance marking and incident authorization

1. Purpose
- Allow active employees to mark attendance even when they have no schedule.
- Require a one-time manager token only when a scheduled employee marks outside the allowed entry or exit window.
- Allow administrators to mark their own attendance without a schedule or token.
- Fix the administrator attendance function error caused by an ambiguous `user_id` reference.

2. Database changes
- Add `applied_at` and `applied_by` to `authorization_requests` so an attendance authorization cannot be reused.
- Extend authorization operation types with `attendance_incident`.
- Replace `register_attendance` with a version that accepts an optional consumed authorization request.
- Replace `admin_register_attendance` with qualified column references.

3. Security
- Attendance authorization is checked on the server, not only in the browser.
- The authorization request must belong to the employee marking attendance, match the action and branch, be consumed, and not have been applied before.
- The token authorization is atomically claimed when the attendance row is saved.
- Existing row-level security and function grants remain in place.

4. Behavior
- No schedule: attendance is accepted with `sin_horario`.
- Scheduled entry within the start time plus tolerance: attendance is accepted as `puntual`.
- Scheduled entry before the start or after tolerance: token required and saved as `retardo` when authorized.
- Scheduled exit before the scheduled end: token required.
- Scheduled exit at or after the scheduled end: attendance is accepted, with overtime calculated as before.
*/

ALTER TABLE public.authorization_requests
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.authorization_requests
  DROP CONSTRAINT IF EXISTS authorization_requests_operation_type_check;

ALTER TABLE public.authorization_requests
  ADD CONSTRAINT authorization_requests_operation_type_check
  CHECK (operation_type IN ('inventory', 'sale_cancel', 'cash_cut', 'attendance_incident'));

DROP FUNCTION IF EXISTS public.register_attendance(uuid, text, text);

CREATE OR REPLACE FUNCTION public.register_attendance(
  p_branch_id uuid,
  p_action text,
  p_notes text DEFAULT NULL,
  p_authorization_request_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, check_in timestamptz, check_out timestamptz, status text, late_minutes integer, overtime_minutes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_local timestamp := timezone('America/Mexico_City', v_now);
  v_schedule public.employee_schedules%ROWTYPE;
  v_open public.attendance%ROWTYPE;
  v_auth public.authorization_requests%ROWTYPE;
  v_late integer := 0;
  v_overtime integer := 0;
  v_status text := 'sin_horario';
  v_id uuid;
  v_requires_auth boolean := false;
BEGIN
  IF NOT public.is_active_staff() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_action NOT IN ('entrada', 'salida') THEN RAISE EXCEPTION 'Acción inválida'; END IF;

  SELECT es.* INTO v_schedule
  FROM public.employee_schedules es
  WHERE es.user_id = auth.uid()
    AND es.month_start = date_trunc('month', v_local::date)::date
    AND es.day_of_week = extract(dow from v_local)::smallint
    AND es.active
    AND (es.branch_id IS NULL OR es.branch_id = p_branch_id)
  ORDER BY (es.branch_id IS NULL), es.created_at DESC
  LIMIT 1;

  SELECT a.* INTO v_open
  FROM public.attendance a
  WHERE a.user_id = auth.uid() AND a.check_out IS NULL
  ORDER BY a.created_at DESC LIMIT 1;

  IF p_action = 'entrada' THEN
    IF v_open.id IS NOT NULL THEN RAISE EXCEPTION 'Ya existe una entrada abierta'; END IF;

    IF v_schedule.id IS NOT NULL AND NOT v_schedule.rest_day AND v_schedule.start_time IS NOT NULL THEN
      v_late := GREATEST(0, floor(extract(epoch from (v_local::time - (v_schedule.start_time + (v_schedule.tolerance_minutes * interval '1 minute')))) / 60)::integer);
      v_status := CASE WHEN v_late > 0 THEN 'retardo' ELSE 'puntual' END;
      v_requires_auth := v_local::time < v_schedule.start_time OR v_late > 0;
    END IF;

    INSERT INTO public.attendance (user_id, branch_id, check_in, notes, scheduled_start, scheduled_end, tolerance_minutes, late_minutes, status, source)
    VALUES (auth.uid(), p_branch_id, v_now, NULLIF(btrim(p_notes), ''), v_schedule.start_time, v_schedule.end_time, COALESCE(v_schedule.tolerance_minutes, 0), v_late, v_status, 'marcacion')
    RETURNING attendance.id INTO v_id;
  ELSE
    IF v_open.id IS NULL THEN RAISE EXCEPTION 'No existe una entrada abierta'; END IF;
    IF v_open.scheduled_end IS NOT NULL THEN
      v_overtime := GREATEST(0, floor(extract(epoch from (v_local::time - (v_open.scheduled_end + (COALESCE(v_open.tolerance_minutes, 0) * interval '1 minute')))) / 60)::integer);
      v_requires_auth := v_local::time < v_open.scheduled_end;
    END IF;
    v_status := CASE WHEN v_overtime > 0 THEN 'horas_extra_pendientes' ELSE COALESCE(v_open.status, 'completada') END;
    UPDATE public.attendance a
    SET check_out = v_now, overtime_minutes = v_overtime, status = v_status, notes = COALESCE(NULLIF(btrim(p_notes), ''), a.notes)
    WHERE a.id = v_open.id
    RETURNING a.id INTO v_id;
  END IF;

  IF v_requires_auth AND NOT public.is_admin() THEN
    IF p_authorization_request_id IS NULL THEN RAISE EXCEPTION 'ATTENDANCE_AUTH_REQUIRED'; END IF;

    SELECT ar.* INTO v_auth
    FROM public.authorization_requests ar
    WHERE ar.id = p_authorization_request_id
      AND ar.requester_id = auth.uid()
      AND ar.operation_type = 'attendance_incident'
      AND ar.status = 'consumed'
      AND ar.applied_at IS NULL
      AND ar.payload ->> 'action' = p_action
      AND ar.payload ->> 'branchId' = p_branch_id::text
    FOR UPDATE;

    IF v_auth.id IS NULL THEN RAISE EXCEPTION 'La autorización de asistencia no es válida.'; END IF;

    UPDATE public.authorization_requests ar
    SET applied_at = now(), applied_by = auth.uid()
    WHERE ar.id = v_auth.id AND ar.applied_at IS NULL;

    IF NOT FOUND THEN RAISE EXCEPTION 'La autorización de asistencia ya fue utilizada.'; END IF;
  END IF;

  RETURN QUERY SELECT a.id, a.check_in, a.check_out, a.status, a.late_minutes, a.overtime_minutes
  FROM public.attendance a WHERE a.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_attendance(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_attendance(uuid, text, text, uuid) TO authenticated;

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
    SELECT a.* INTO v_open FROM public.attendance a
    WHERE a.user_id = p_target_user_id AND a.check_out IS NULL
    ORDER BY a.created_at DESC LIMIT 1;

    IF v_open.id IS NOT NULL THEN
      UPDATE public.attendance a
      SET check_out = p_check_in_time, status = COALESCE(a.status, 'completada'), corrected_by = auth.uid(), correction_reason = 'Cerrada por administrador al registrar nueva entrada'
      WHERE a.id = v_open.id;
    END IF;

    INSERT INTO public.attendance (user_id, branch_id, check_in, notes, status, source, corrected_by)
    VALUES (p_target_user_id, p_branch_id, p_check_in_time, NULLIF(btrim(p_notes), ''), v_status, 'admin', auth.uid())
    RETURNING attendance.id INTO v_id;
  ELSE
    SELECT a.* INTO v_open FROM public.attendance a
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