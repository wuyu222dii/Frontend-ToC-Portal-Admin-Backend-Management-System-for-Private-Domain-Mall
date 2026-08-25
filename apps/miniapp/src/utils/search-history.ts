const SEARCH_HISTORY_KEY = 'qingxu:store-search-history:v1';
const SEARCH_HISTORY_LIMIT = 8;

export function normalizeSearchTerm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  return length >= 1 && length <= 200 ? normalized : null;
}

export function parseSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeSearchTerm(item);
    if (normalized === null) continue;
    const identity = normalized.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(normalized);
    if (result.length === SEARCH_HISTORY_LIMIT) break;
  }
  return result;
}

export function mergeSearchHistory(history: readonly string[], term: string): string[] {
  const normalized = normalizeSearchTerm(term);
  if (normalized === null) return parseSearchHistory(history);
  return parseSearchHistory([
    normalized,
    ...history.filter((item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase()),
  ]);
}

export function loadSearchHistory(): string[] {
  try {
    return parseSearchHistory(uni.getStorageSync(SEARCH_HISTORY_KEY));
  } catch {
    return [];
  }
}

export function saveSearchTerm(history: readonly string[], term: string): string[] {
  const next = mergeSearchHistory(history, term);
  try {
    uni.setStorageSync(SEARCH_HISTORY_KEY, next);
  } catch {
    // Search remains usable when local storage is unavailable.
  }
  return next;
}

export function clearSearchHistory(): void {
  try {
    uni.removeStorageSync(SEARCH_HISTORY_KEY);
  } catch {
    // Clearing history is best-effort.
  }
}
