/*
# Corregir validación de PIN numérico

1. Función modificada
- `set_auth_user_pin` ahora valida seis dígitos con una expresión compatible con PostgreSQL sin depender del escape de `\\d`.

2. Seguridad
- Conserva SECURITY DEFINER y search_path fijo.
- Mantiene el acceso exclusivo para service_role.
- No modifica ni elimina datos existentes.
*/

CREATE OR REPLACE FUNCTION public.set_auth_user_pin(p_user_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF p_user_id IS NULL OR p_pin IS NULL OR p_pin !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'PIN inválido';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_pin, gen_salt('bf')),
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_auth_user_pin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_auth_user_pin(uuid, text) TO service_role;