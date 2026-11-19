/*
# Acceso por usuario y PIN para el personal

## Resumen
Cambia el inicio de sesión visible del sistema de correo y contraseña a usuario y PIN numérico de seis dígitos. El PIN no se guarda en texto visible: se almacena dentro del sistema de autenticación usando un hash seguro.

## Cambios de datos
1. profiles.username — nombre de usuario único para iniciar sesión.
2. auth.users.email — se convierte internamente a un correo técnico no visible para conservar el sistema de sesiones de Supabase.
3. auth.users.encrypted_password — se actualiza con un hash bcrypt del PIN inicial de cada usuario migrado.

## Seguridad
- El usuario debe contener de 3 a 32 caracteres alfanuméricos, guion o guion bajo.
- El PIN debe contener exactamente seis dígitos.
- Se agrega un índice único sin distinguir mayúsculas y minúsculas para impedir usuarios duplicados.
- La lista de acceso solo devuelve nombre, usuario y avatar de personal activo; nunca devuelve PIN ni correo interno.
- La función de lista usa SECURITY DEFINER con search_path fijo y solo expone los campos mínimos necesarios.

## Migración inicial
- ISMAEL LEAL queda como LEPI011208 con PIN 341297 y rol Administrador.
- JOSE ISMAR queda como JOSEISMAR con un PIN inicial que el administrador puede cambiar desde Usuarios y Roles.
- Las cuentas actuales se mantienen activas para no interrumpir la operación.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

UPDATE public.profiles
SET username = CASE
  WHEN upper(full_name) = 'ISMAEL LEAL' THEN 'LEPI011208'
  WHEN upper(full_name) = 'JOSE ISMAR' THEN 'JOSEISMAR'
  ELSE upper(regexp_replace(split_part(email, '@', 1), '[^A-Za-z0-9_-]', '', 'g'))
END
WHERE username IS NULL OR btrim(username) = '';

UPDATE public.profiles
SET username = upper(username)
WHERE username IS NOT NULL;

ALTER TABLE public.profiles
  ALTER COLUMN username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key
  ON public.profiles (lower(username));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
  CHECK (username ~ '^[A-Z0-9_-]{3,32}$');

CREATE OR REPLACE FUNCTION public.get_login_users()
RETURNS TABLE (username text, full_name text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.username, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE p.active
  ORDER BY p.full_name;
$$;

REVOKE ALL ON FUNCTION public.get_login_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_login_users() TO anon, authenticated;

UPDATE auth.users
SET email = 'lepi011208@pos.local',
    encrypted_password = crypt('341297', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', 'LEPI011208', 'full_name', 'ISMAEL LEAL')
WHERE id = (SELECT id FROM public.profiles WHERE username = 'LEPI011208' LIMIT 1);

UPDATE public.profiles
SET email = 'lepi011208@pos.local',
    role_id = (SELECT id FROM public.roles WHERE name = 'Administrador' LIMIT 1),
    active = true
WHERE username = 'LEPI011208';

UPDATE auth.users
SET email = 'joseismar@pos.local',
    encrypted_password = crypt('827416', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', 'JOSEISMAR', 'full_name', 'JOSE ISMAR')
WHERE id = (SELECT id FROM public.profiles WHERE username = 'JOSEISMAR' LIMIT 1);

UPDATE public.profiles
SET email = 'joseismar@pos.local'
WHERE username = 'JOSEISMAR';
