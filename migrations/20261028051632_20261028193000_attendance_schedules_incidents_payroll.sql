/*
# Asistencia avanzada, horarios y nómina

## Descripción
Agrega la estructura necesaria para operar horarios rotativos, tolerancias, retardos, horas extra, incidencias y cortes de nómina sin borrar los registros de asistencia existentes.

## Nuevas columnas
- profiles.daily_rate: pago diario acordado.
- profiles.hours_per_day: horas que integran el pago diario.
- profiles.hourly_rate: pago por hora calculado o capturado por el administrador.
- attendance.scheduled_start / scheduled_end: horario esperado de la marcación.
- attendance.tolerance_minutes: tolerancia aplicada.
- attendance.late_minutes / overtime_minutes: minutos calculados.
- attendance.status: puntual, retardo, incompleta, justificada o horas_extra_pendientes.
- attendance.source / corrected_by / correction_reason: origen y auditoría de correcciones.

## Nuevas tablas
- employee_schedules: horario mensual por empleado, día de la semana y sucursal.
- attendance_incidents: correcciones, permisos, vacaciones, incapacidades, faltas justificadas y otras incidencias.
- payroll_periods: periodos y fechas de pago.
- payroll_entries: resumen por empleado de horas, pago base, horas extra, descuentos y total.
- payroll_adjustments: conceptos de descuento, préstamo, merma, bono u otros ajustes.

## Seguridad
- Todas las tablas nuevas tienen RLS habilitado.
- El personal activo puede consultar sus propios horarios, incidencias y nómina.
- El administrador puede consultar y modificar la información del personal.
- Las marcaciones pasan por register_attendance, que obtiene el empleado desde auth.uid(), busca su horario mensual y calcula retardo y horas extra en servidor.
- La función de marcación no acepta user_id desde el navegador.
- Las funciones administrativas usan SECURITY DEFINER y search_path fijo.
*/

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS daily_rate numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hours_per_day numeric(6,2) NOT NULL DEFAULT 8;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hourly_rate numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS scheduled_start time;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS scheduled_end time;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS tolerance_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS late_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS overtime_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendiente';
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'marcacion';
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS correction_reason text;

CREATE TABLE IF NOT EXISTS public.employee_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  start_time time,
  end_time time,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0 AND break_minutes <= 240),
  tolerance_minutes integer NOT NULL DEFAULT 10 CHECK (tolerance_minutes BETWEEN 0 AND 180),
  exit_grace_minutes integer NOT NULL DEFAULT 0 CHECK (exit_grace_minutes BETWEEN 0 AND 180),
  rest_day boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month_start, day_of_week)
);
ALTER TABLE public.employee_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_schedules TO authenticated;
DROP POLICY IF EXISTS "staff_select_own_schedules" ON public.employee_schedules;
CREATE POLICY "staff_select_own_schedules" ON public.employee_schedules FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "admin_insert_schedules" ON public.employee_schedules;
CREATE POLICY "admin_insert_schedules" ON public.employee_schedules FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_update_schedules" ON public.employee_schedules;
CREATE POLICY "admin_update_schedules" ON public.employee_schedules FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_delete_schedules" ON public.employee_schedules;
CREATE POLICY "admin_delete_schedules" ON public.employee_schedules FOR DELETE TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.attendance_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attendance_id uuid REFERENCES public.attendance(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  incident_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('correccion', 'permiso', 'vacaciones', 'incapacidad', 'falta_justificada', 'descanso', 'otro')),
  corrected_check_in timestamptz,
  corrected_check_out timestamptz,
  minutes integer NOT NULL DEFAULT 0,
  reason text NOT NULL,
  notes text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_incidents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_incidents TO authenticated;
DROP POLICY IF EXISTS "staff_select_own_incidents" ON public.attendance_incidents;
CREATE POLICY "staff_select_own_incidents" ON public.attendance_incidents FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "staff_insert_incidents" ON public.attendance_incidents;
CREATE POLICY "staff_insert_incidents" ON public.attendance_incidents FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR user_id = auth.uid());
DROP POLICY IF EXISTS "admin_update_incidents" ON public.attendance_incidents;
CREATE POLICY "admin_update_incidents" ON public.attendance_incidents FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_delete_incidents" ON public.attendance_incidents;
CREATE POLICY "admin_delete_incidents" ON public.attendance_incidents FOR DELETE TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  pay_date date,
  status text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto', 'calculado', 'cerrado', 'pagado')),
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_periods TO authenticated;
DROP POLICY IF EXISTS "staff_select_payroll_periods" ON public.payroll_periods;
CREATE POLICY "staff_select_payroll_periods" ON public.payroll_periods FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "admin_insert_payroll_periods" ON public.payroll_periods;
CREATE POLICY "admin_insert_payroll_periods" ON public.payroll_periods FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_update_payroll_periods" ON public.payroll_periods;
CREATE POLICY "admin_update_payroll_periods" ON public.payroll_periods FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_delete_payroll_periods" ON public.payroll_periods;
CREATE POLICY "admin_delete_payroll_periods" ON public.payroll_periods FOR DELETE TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  regular_hours numeric(10,2) NOT NULL DEFAULT 0,
  overtime_hours numeric(10,2) NOT NULL DEFAULT 0,
  hourly_rate numeric(12,2) NOT NULL DEFAULT 0,
  base_pay numeric(12,2) NOT NULL DEFAULT 0,
  overtime_pay numeric(12,2) NOT NULL DEFAULT 0,
  adjustments_total numeric(12,2) NOT NULL DEFAULT 0,
  total_pay numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, user_id)
);
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_entries TO authenticated;
DROP POLICY IF EXISTS "staff_select_own_payroll" ON public.payroll_entries;
CREATE POLICY "staff_select_own_payroll" ON public.payroll_entries FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "admin_insert_payroll" ON public.payroll_entries;
CREATE POLICY "admin_insert_payroll" ON public.payroll_entries FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_update_payroll" ON public.payroll_entries;
CREATE POLICY "admin_update_payroll" ON public.payroll_entries FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_delete_payroll" ON public.payroll_entries;
CREATE POLICY "admin_delete_payroll" ON public.payroll_entries FOR DELETE TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('descuento', 'bono', 'prestamo', 'merma', 'anticipo', 'otro')),
  concept text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_adjustments TO authenticated;
DROP POLICY IF EXISTS "staff_select_own_adjustments" ON public.payroll_adjustments;
CREATE POLICY "staff_select_own_adjustments" ON public.payroll_adjustments FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "admin_insert_adjustments" ON public.payroll_adjustments;
CREATE POLICY "admin_insert_adjustments" ON public.payroll_adjustments FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_update_adjustments" ON public.payroll_adjustments;
CREATE POLICY "admin_update_adjustments" ON public.payroll_adjustments FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin_delete_adjustments" ON public.payroll_adjustments;
CREATE POLICY "admin_delete_adjustments" ON public.payroll_adjustments FOR DELETE TO authenticated USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_employee_schedules_month ON public.employee_schedules (user_id, month_start);
CREATE INDEX IF NOT EXISTS idx_attendance_incidents_user_date ON public.attendance_incidents (user_id, incident_date);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_period ON public.payroll_entries (period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_period_user ON public.payroll_adjustments (period_id, user_id);

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
    IF v_open.scheduled_end IS NOT NULL THEN
      v_overtime := GREATEST(0, floor(extract(epoch from (v_local::time - (v_open.scheduled_end + (COALESCE(v_open.tolerance_minutes, 0) * interval '1 minute')))) / 60)::integer);
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
