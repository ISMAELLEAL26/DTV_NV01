/*
# Permitir PIN numérico de empleados

1. Funciones nuevas
- `set_auth_user_pin` actualiza de forma segura la contraseña interna de una cuenta existente usando el PIN numérico validado por el servidor.

2. Comportamiento
- La aplicación puede continuar usando PIN de exactamente seis dígitos.
- La función solo acepta un identificador de usuario y un PIN numérico de seis dígitos.
- El PIN se guarda como hash usando la extensión criptográfica existente; nunca se almacena en texto visible.

3. Seguridad
- La función usa SECURITY DEFINER y search_path fijo.
- Se revoca su ejecución a PUBLIC, anon y authenticated.
- Solo el rol service_role utilizado por la función administrativa puede ejecutarla.
- No se modifican tablas públicas ni políticas existentes.
*/

CREATE OR REPLACE FUNCTION public.set_auth_user_pin(p_user_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF p_user_id IS NULL OR p_pin IS NULL OR p_pin !~ '^\\d{6}$' THEN
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