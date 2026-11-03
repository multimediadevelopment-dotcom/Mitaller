-- Migración SQL definitiva (NO ejecutada automáticamente; lista para revisión previa):
-- Propósito: Garantizar de forma estrictamente transaccional que un taller existente nunca
-- quede sin al menos un propietario ('owner'), ante operaciones DELETE o UPDATE individuales,
-- por lotes o concurrentes entre múltiples sesiones.
-- Seguridad:
--   1. SECURITY DEFINER con SET search_path = ''
--   2. Referencias explícitas con esquema calificado (public.workshops, public.workshop_members, pg_catalog.count)
--   3. Bloqueo exclusivo de fila (FOR UPDATE) sobre public.workshops para serializar transacciones concurrentes
--   4. Verificación post-modificación dentro de la misma transacción (AFTER UPDATE OR DELETE)
--      que aborta y revierte automáticamente toda la transacción si el taller queda con 0 owners.

CREATE OR REPLACE FUNCTION public.prevent_removing_last_workshop_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workshop_exists boolean;
  remaining_owners bigint;
BEGIN
  -- Solo interviene si la fila afectada tenía rol 'owner' y dejó de ser 'owner' de ese taller
  -- (por DELETE, cambio de role, o cambio de workshop_id / user_id)
  IF OLD.role = 'owner' AND (
    TG_OP = 'DELETE'
    OR NEW.role IS DISTINCT FROM 'owner'
    OR NEW.workshop_id IS DISTINCT FROM OLD.workshop_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
  ) THEN
    -- Tomar bloqueo exclusivo sobre el taller padre para serializar operaciones concurrentes.
    -- Si el taller padre en sí mismo fue eliminado en cascada, no bloquear el borrado del taller.
    SELECT true
    INTO workshop_exists
    FROM public.workshops
    WHERE id = OLD.workshop_id
    FOR UPDATE;

    IF COALESCE(workshop_exists, false) THEN
      -- Al ejecutarse AFTER UPDATE OR DELETE dentro de la transacción, la tabla ya refleja
      -- el estado resultante real; verificamos que quede al menos 1 propietario activo.
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
