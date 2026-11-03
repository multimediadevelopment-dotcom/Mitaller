-- Migración SQL definitiva (NO ejecutada automáticamente; lista para revisión previa):
-- Propósito: Garantizar de forma estrictamente transaccional que un taller existente nunca
-- quede sin al menos un propietario ('owner'), ante operaciones DELETE o UPDATE individuales,
-- por lotes o concurrentes entre múltiples sesiones.
-- Seguridad:
--   1. SECURITY DEFINER con SET search_path = ''
--   2. Referencias explícitas con esquema calificado (public.workshops, public.workshop_members, pg_catalog.count)
--   3. Separación estricta de TG_OP = 'DELETE' y TG_OP = 'UPDATE' para nunca referenciar NEW en DELETE
--   4. Bloqueo exclusivo de fila (FOR UPDATE) sobre public.workshops para serializar transacciones concurrentes
--   5. Verificación post-modificación dentro de la misma transacción (AFTER UPDATE OR DELETE)
--      que aborta y revierte automáticamente toda la transacción si el taller queda con 0 owners.

CREATE OR REPLACE FUNCTION public.prevent_removing_last_workshop_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  should_check_owners boolean := false;
  workshop_exists boolean := false;
  remaining_owners bigint := 0;
BEGIN
  -- 1. Separar explícitamente DELETE y UPDATE para no evaluar campos de NEW cuando TG_OP = 'DELETE'
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      should_check_owners := true;
    ELSE
      RETURN OLD;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' AND (
      NEW.role IS DISTINCT FROM 'owner'
      OR NEW.workshop_id IS DISTINCT FROM OLD.workshop_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
    ) THEN
      should_check_owners := true;
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- 2. Si se quitó o desplazó un owner, serializar contra la fila del taller y verificar owners restantes
  IF should_check_owners THEN
    SELECT true
    INTO workshop_exists
    FROM public.workshops
    WHERE id = OLD.workshop_id
    FOR UPDATE;

    -- Si el taller padre sigue existiendo (no es un borrado en cascada del taller completo),
    -- exigir que conserve al menos 1 propietario activo en la transacción actual.
    IF COALESCE(workshop_exists, false) THEN
      SELECT pg_catalog.count(*)
      INTO remaining_owners
      FROM public.workshop_members
      WHERE workshop_id = OLD.workshop_id
        AND role = 'owner';

      IF remaining_owners < 1 THEN
        RAISE EXCEPTION 'LAST_OWNER_PROTECTED: El taller debe conservar al menos un propietario (owner).'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_removing_last_workshop_owner ON public.workshop_members;

CREATE TRIGGER trg_prevent_removing_last_workshop_owner
AFTER UPDATE OR DELETE ON public.workshop_members
FOR EACH ROW
EXECUTE FUNCTION public.prevent_removing_last_workshop_owner();
