/*
# Add attendance permission to Cajero role

## Changes
1. Updates the `Cajero` role's permissions array to include `attendance`.
   This allows cashiers to see and use the Asistencia module to:
   - Check their own attendance (entrada/salida)
   - View their own weekly attendance history
   - Submit attendance incidents

## Notes
- This only adds the `attendance` permission; no other permissions change.
- Admins already have `all` permissions, so they can manage everyone's attendance.
*/

UPDATE roles
SET permissions = permissions || '["attendance"]'::jsonb
WHERE name = 'Cajero'
AND NOT permissions ? 'attendance';
