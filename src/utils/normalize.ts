export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')              // colapsa espacios
    .replace(/[¿¡]/g, '')             // quita signos de apertura españoles
    .replace(/[.,;:!?]$/g, '')        // quita puntuación final
}
