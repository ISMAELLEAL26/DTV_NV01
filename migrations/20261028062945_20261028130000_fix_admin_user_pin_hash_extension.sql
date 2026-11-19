/*
# Corregir cifrado de PIN al editar usuarios

1. Función modificada
- `admin_update_user` conserva toda su lógica de actualización de usuarios, pero llama explícitamente a `extensions.crypt` y `extensions.gen_salt`.

2. Motivo
- La función usa un `search_path` restringido por seguridad y por eso PostgreSQL no encontraba `gen_salt` al cambiar el PIN.

3. Seguridad
- Se mantiene `SECURITY DEFINER` con `search_path = public`.
- Se conserva la validación de administrador, usuario, PIN y datos de pago.
- No se eliminan ni modifican registros existentes.
*/

CREATE OR REPLACE FUNCTION public.admin_update_user(
  target_id uuid,
  p_full_name text,
  p_role_id uuid,
  p_branch_id uuid,
  p_active boolean,
  p_phone text,
  p_position text,
  p_avatar_url text,
  p_branch_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_username text DEFAULT NULL,
  p_pin text DEFAULT NULL,
  p_daily_rate numeric DEFAULT 0,
  p_hours_per_day numeric DEFAULT 8,
  p_hourly_rate numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
  v_email text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_username := upper(NULLIF(btrim(p_username), ''));
  IF v_username IS NULL OR v_username !~ '^[A-Z0-9_-]{3,32}$' THEN
    RAISE EXCEPTION 'Usuario inválido';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(v_username) AND id <> target_id) THEN
    RAISE EXCEPTION 'Usuario ya existe';
  END IF;
  IF p_pin IS NOT NULL AND p_pin <> '' AND p_pin !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'PIN inválido';
  END IF;
  IF COALESCE(p_daily_rate, 0) < 0 OR COALESCE(p_hourly_rate, 0) < 0 OR COALESCE(p_hours_per_day, 0) <= 0 OR COALESCE(p_hours_per_day, 0) > 24 THEN
    RAISE EXCEPTION 'Pago u horario inválido';
  END IF;

  v_email := lower(v_username) || '@pos.local';

  UPDATE public.profiles
  SET full_name = trim(p_full_name), email = v_email, username = v_username,
      role_id = p_role_id, branch_id = p_branch_id, active = COALESCE(p_active, active),
      phone = p_phone, position = NULLIF(trim(p_position), ''), avatar_url = NULLIF(trim(p_avatar_url), ''),
      daily_rate = COALESCE(p_daily_rate, daily_rate), hours_per_day = COALESCE(p_hours_per_day, hours_per_day), hourly_rate = COALESCE(p_hourly_rate, hourly_rate)
  WHERE id = target_id;

  UPDATE auth.users
  SET email = v_email,
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', v_username, 'full_name', trim(p_full_name)),
      encrypted_password = CASE WHEN p_pin IS NULL OR p_pin = '' THEN encrypted_password ELSE extensions.crypt(p_pin, extensions.gen_salt('bf')) END
  WHERE id = target_id;

  DELETE FROM public.user_branch_access WHERE user_id = target_id;
  INSERT INTO public.user_branch_access (user_id, branch_id)
  SELECT target_id, x.branch_id
  FROM unnest(COALESCE(p_branch_ids, ARRAY[]::uuid[])) AS x(branch_id)
  JOIN public.branches b ON b.id = x.branch_id AND b.active
  ON CONFLICT (user_id, branch_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text, text, text, uuid[], text, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text, text, text, uuid[], text, text, numeric, numeric, numeric) TO authenticated;