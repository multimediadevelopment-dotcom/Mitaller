-- PROPUESTA PARA REVISIÓN. NO APLICADA. No cambia datos ni políticas RLS.
-- No copiar a migrations ni ejecutar antes de revisar índices equivalentes,
-- cardinalidad, tamaños y EXPLAIN en un entorno de pruebas.
-- CONCURRENTLY requiere ejecución fuera de un bloque de transacción.

-- Revisión previa (solo lectura):
-- SELECT tablename, indexname, indexdef FROM pg_catalog.pg_indexes
-- WHERE schemaname = 'public' AND tablename IN
-- ('jobs', 'stock_items', 'part_compatibility', 'stock_movements', 'workshop_members');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_workshop_updated_id
  ON public.jobs (workshop_id, updated_at DESC, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_items_workshop_name_id
  ON public.stock_items (workshop_id, name, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_part_compatibility_workshop_id
  ON public.part_compatibility (workshop_id, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_movements_workshop_created
  ON public.stock_movements (workshop_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_movements_workshop_item_created
  ON public.stock_movements (workshop_id, stock_item_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workshop_members_user_workshop
  ON public.workshop_members (user_id, workshop_id);

-- IF NOT EXISTS comprueba el nombre; no detecta índices equivalentes con otro
-- nombre. Eliminar propuestas redundantes antes de aprobar. Sin estadísticas
-- ni planes reales no se atribuye una mejora de latencia a estos índices.
