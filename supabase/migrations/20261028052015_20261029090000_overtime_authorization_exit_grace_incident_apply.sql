/*
# Autorización de horas extra, gracia de salida y aplicación de incidencias

## Descripción
Completa el ciclo de asistencia y nómina: el dueño autoriza las horas extra antes de que se paguen, la salida respeta el margen de gracia configurado por día, y las incidencias corrigen la marcación real en lugar de solo guardarse en una tabla aparte.

## Cambos a la tabla attendance
- overtime_authorized boolean: marca si las horas extra fueron autorizadas por el dueño.
- overtime_authorized_by uuid: quién autorizó.
- overtime_authorized_at timestamptz: cuándo se autorizó.

## Función register_attendance (reescribe)
- En la salida usa exit_grace_minutes del horario para decidir si hay horas extra: solo cuenta tiempo extra después de scheduled_end + exit_grace.
- Mantener retardo y puntual intactos.

## Nueva función authorize_overtime()
- SECURITY DEFINER, solo admin.
- Marca overtime_authorized = true y registra quién/cuándo autorizó.
- Recibe p_attendance_id.

## Nueva función apply_attendance_incident()
- SECURITY DEFINER, solo admin.
- Recibe p_incident_id.
- Si el tipo es correccion: actualiza check_in/check_out del registro de asistencia y recalcula late_minutes y overtime_minutes.
- Si el tipo es falta_justificada, vacaciones, incapacidad, permiso: marca el status como justificada.
- Marca approved_by y approved_at en la incidencia.

## Seguridad
- Las nuevas columnas no son editables desde el cliente (RLS existente cubre attendance).
- Las funciones usan SECURITY DEFINER con search_path fijo y validan is_admin().
- REVOKE EXECUTE de anon en las nuevas funciones.
*/

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS overtime_authorized boolean NOT NULL DEFAULT false;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS overtime_authorized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS overtime_authorized_at timestamptz;

CREATE OR REPLACE FUNCTION public.register_attendance(p_branch_id uuid, p_action text, p_notes text DEFAULT NULL)
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
  v_late integer := 0;
  v_overtime integer := 0;
  v_status text := 'sin_horario';
  v_id uuid;
  v_exit_grace integer := 0;
BEGIN
  IF NOT public.is_active_staff() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_action NOT IN ('entrada', 'salida') THEN RAISE EXCEPTION 'Acción inválida'; END IF;

  SELECT * INTO v_schedule
  FROM public.employee_schedules
  WHERE user_id = auth.uid()
    AND month_start = date_trunc('month', v_local::date)::date
    AND day_of_week = extract(dow from v_local)::smallint
    AND active
  LIMIT 1;

  SELECT * INTO v_open FROM public.attendance
  WHERE user_id = auth.uid() AND check_out IS NULL
  ORDER BY created_at DESC LIMIT 1;

  IF p_action = 'entrada' THEN
    IF v_open.id IS NOT NULL THEN RAISE EXCEPTION 'Ya existe una entrada abierta'; END IF;
    IF v_schedule.id IS NOT NULL AND NOT v_schedule.rest_day AND v_schedule.start_time IS NOT NULL THEN
      v_late := GREATEST(0, floor(extract(epoch from (v_local::time - (v_schedule.start_time + (v_schedule.tolerance_minutes * interval '1 minute')))) / 60)::integer);
      v_status := CASE WHEN v_late > 0 THEN 'retardo' ELSE 'puntual' END;
    END IF;
    INSERT INTO public.attendance (user_id, branch_id, check_in, notes, scheduled_start, scheduled_end, tolerance_minutes, late_minutes, status, source)
    VALUES (auth.uid(), p_branch_id, v_now, NULLIF(btrim(p_notes), ''), v_schedule.start_time, v_schedule.end_time, COALESCE(v_schedule.tolerance_minutes, 0), v_late, v_status, 'marcacion')
    RETURNING attendance.id INTO v_id;
  ELSE
    IF v_open.id IS NULL THEN RAISE EXCEPTION 'No existe una entrada abierta'; END IF;
    v_exit_grace := COALESCE(v_schedule.exit_grace_minutes, 0);
    IF v_open.scheduled_end IS NOT NULL THEN
      v_overtime := GREATEST(0, floor(extract(epoch from (v_local::time - (v_open.scheduled_end + ((COALESCE(v_open.tolerance_minutes, 0) + v_exit_grace) * interval '1 minute')))) / 60)::integer);
    END IF;
    v_status := CASE WHEN v_overtime > 0 THEN 'horas_extra_pendientes' ELSE COALESCE(v_open.status, 'completada') END;
    UPDATE public.attendance
    SET check_out = v_now, overtime_minutes = v_overtime, status = v_status, notes = COALESCE(NULLIF(btrim(p_notes), ''), notes)
    WHERE attendance.id = v_open.id
    RETURNING attendance.id INTO v_id;
  END IF;

  RETURN QUERY SELECT a.id, a.check_in, a.check_out, a.status, a.late_minutes, a.overtime_minutes
  FROM public.attendance a WHERE a.id = v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_attendance(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_attendance(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.authorize_overtime(p_attendance_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_attendance_id IS NULL THEN RAISE EXCEPTION 'ID de asistencia requerido'; END IF;
  UPDATE public.attendance
  SET overtime_authorized = true,
      overtime_authorized_by = auth.uid(),
      overtime_authorized_at = now(),
      status = 'horas_extra_autorizadas'
  WHERE id = p_attendance_id AND overtime_minutes > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró registro con horas extra pendientes'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_overtime(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_overtime(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_attendance_incident(p_incident_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inc public.attendance_incidents%ROWTYPE;
  v_att public.attendance%ROWTYPE;
  v_local_in timestamp;
  v_local_out timestamp;
  v_late integer := 0;
  v_overtime integer := 0;
  v_new_status text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_incident_id IS NULL THEN RAISE EXCEPTION 'ID de incidencia requerido'; END IF;

  SELECT * INTO v_inc FROM public.attendance_incidents WHERE id = p_incident_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Incidencia no encontrada'; END IF;

  IF v_inc.type = 'correccion' AND v_inc.attendance_id IS NOT NULL THEN
    SELECT * INTO v_att FROM public.attendance WHERE id = v_inc.attendance_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro de asistencia no encontrado'; END IF;

    v_late := 0;
    v_overtime := 0;
    v_new_status := 'completada';

    IF v_inc.corrected_check_in IS NOT NULL AND v_att.scheduled_start IS NOT NULL THEN
      v_local_in := timezone('America/Mexico_City', v_inc.corrected_check_in);
      v_late := GREATEST(0, floor(extract(epoch from (v_local_in::time - (v_att.scheduled_start + (COALESCE(v_att.tolerance_minutes, 0) * interval '1 minute')))) / 60)::integer);
    END IF;

    IF v_inc.corrected_check_out IS NOT NULL AND v_att.scheduled_end IS NOT NULL THEN
      v_local_out := timezone('America/Mexico_City', v_inc.corrected_check_out);
      v_overtime := GREATEST(0, floor(extract(epoch from (v_local_out::time - (v_att.scheduled_end + (COALESCE(v_att.tolerance_minutes, 0) * interval '1 minute')))) / 60)::integer);
    END IF;

    IF v_late > 0 THEN
      v_new_status := 'retardo';
    ELSIF v_overtime > 0 THEN
      v_new_status := 'horas_extra_pendientes';
    ELSIF v_inc.corrected_check_in IS NOT NULL THEN
      v_new_status := 'puntual';
    END IF;

    UPDATE public.attendance
    SET check_in = COALESCE(v_inc.corrected_check_in, check_in),
        check_out = COALESCE(v_inc.corrected_check_out, check_out),
        late_minutes = v_late,
        overtime_minutes = v_overtime,
        status = v_new_status,
        source = 'correccion',
        corrected_by = auth.uid(),
        correction_reason = v_inc.reason
    WHERE id = v_inc.attendance_id;

  ELSIF v_inc.type IN ('falta_justificada', 'vacaciones', 'incapacidad', 'permiso') THEN
    IF v_inc.attendance_id IS NOT NULL THEN
      UPDATE public.attendance
      SET status = 'justificada',
          source = 'incidencia',
          corrected_by = auth.uid(),
          correction_reason = v_inc.reason
      WHERE id = v_inc.attendance_id;
    END IF;
  END IF;

  UPDATE public.attendance_incidents
  SET approved_by = auth.uid(), approved_at = now()
  WHERE id = p_incident_id;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_attendance_incident(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_attendance_incident(uuid) TO authenticated;