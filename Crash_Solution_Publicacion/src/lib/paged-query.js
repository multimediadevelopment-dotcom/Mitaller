// Read every bounded page before replacing local state. Offline data is never
// truncated to the server's default row cap or to the first visible UI page.
export async function fetchAllPages(queryFactory, pageSize = 200) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('Tamaño de página inválido.')
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await queryFactory().range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}
