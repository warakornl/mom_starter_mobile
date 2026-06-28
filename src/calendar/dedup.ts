/**
 * Collapse projected (future) and materialized occurrences that share the same
 * deterministic id into a single row. Materialized wins when both exist.
 */
export interface HasId {
  id: string;
  materialized?: boolean;
}

export function dedupOccurrences<T extends HasId>(occurrences: T[]): T[] {
  const byId = new Map<string, T>();
  for (const occ of occurrences) {
    const existing = byId.get(occ.id);
    if (!existing || (occ.materialized && !existing.materialized)) {
      byId.set(occ.id, occ);
    }
  }
  return Array.from(byId.values());
}
