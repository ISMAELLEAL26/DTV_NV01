/*
# Funciones de administración para usuario y PIN

## Resumen
Actualiza las funciones internas que crean y editan empleados para trabajar con usuario y PIN de seis dígitos.

## Cambios
1. handle_new_user — genera el usuario desde los datos de registro y conserva un valor válido para perfiles creados por el sistema.
2. admin_update_user — permite al administrador cambiar usuario, PIN, nombre, rol, estado, sucursales y datos del empleado.
3. auth.users — el correo técnico se actualiza junto con el usuario y el PIN se guarda como hash bcrypt.

## Seguridad
- Solo un usuario con permiso `all` puede crear o editar empleados.
- El usuario se normaliza a mayúsculas y se valida en la base de datos.
- El PIN se valida como exactamente seis dígitos y nunca se devuelve.
- La función usa SECURITY DEFINER con search_path fijo.
- No se conceden permisos de ejecución al rol anon para funciones administrativas.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id uuid;
  v_first boolean;
  v_username text;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO v_first;
  SELECT id INTO v_role_id FROM public.roles WHERE name = CASE WHEN v_first THEN 'Administrador' ELSE 'Cajero' END LIMIT 1;
  v_username := upper(COALESCE(NULLIF(NEW.raw_user_meta_data->>'username', ''), regexp_replace(split_part(NEW.email, '@', 1), '[^A-Za-z0-9_-]', '', 'g')));

  INSERT INTO public.profiles (id, email, username, full_name, role_id, active)
  VALUES (
    NEW.id,
    NEW.email,
    v_username,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    v_role_id,
    v_first
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

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
  p_pin text DEFAULT NULL
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
  IF p_pin IS NOT NULL AND (p_pin !~ '^[0-9]{6}$') THEN
    RAISE EXCEPTION 'PIN inválido';
  END IF;

  v_email := lower(v_username) || '@pos.local';

  UPDATE public.profiles
  SET full_name = trim(p_full_name),
      email = v_email,
      username = v_username,
      role_id = p_role_id,
      branch_id = p_branch_id,
      active = COALESCE(p_active, active),
      phone = p_phone,
      position = NULLIF(trim(p_position), ''),
      avatar_url = NULLIF(trim(p_avatar_url), '')
  WHERE id = target_id;

  UPDATE auth.users
  SET email = v_email,
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', v_username, 'full_name', trim(p_full_name)),
      encrypted_password = CASE WHEN p_pin IS NULL OR p_pin = '' THEN encrypted_password ELSE crypt(p_pin, gen_salt('bf')) END
  WHERE id = target_id;

  DELETE FROM public.user_branch_access WHERE user_id = target_id;
  INSERT INTO public.user_branch_access (user_id, branch_id)
  SELECT target_id, x.branch_id
  FROM unnest(COALESCE(p_branch_ids, ARRAY[]::uuid[])) AS x(branch_id)
  JOIN public.branches b ON b.id = x.branch_id AND b.active
  ON CONFLICT (user_id, branch_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text, text, text, uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, uuid, uuid, boolean, text, text, text, uuid[], text, text) TO authenticated;
