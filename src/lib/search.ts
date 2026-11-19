/**
 * Strips characters that have a special meaning inside a PostgREST `or=` /
 * `ilike` filter expression, so user-typed search text cannot change the
 * structure of the filter (adding extra conditions or referencing other
 * columns). Only plain search text survives.
 */
export function sanitizeFilterValue(value: string): string {
  return value
    .replace(/[,.()%*\\:"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Normalizes a string for search: removes accents/diacritics, converts to
 * lowercase, and collapses whitespace. This allows searching "cafe" to match
 * "Café", "CAFE", "Café Latte", etc.
 */
function normalize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenizes a search query into individual words. Each word is normalized.
 * Empty words are discarded.
 */
function tokenize(query: string): string[] {
  return normalize(query).split(' ').filter(Boolean);
}

/**
 * Checks whether every token in the query appears as a substring of the
 * combined haystack. This means searching "leche deslacteada" will match
 * "Leche Deslacteada Lala 1L" but not just "Leche Entera".
 */
export function matchesQuery(query: string, ...haystacks: (string | null | undefined)[]): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const hay = normalize(haystacks.filter(Boolean).join(' '));
  return tokens.every((token) => hay.includes(token));
}

/**
 * Scores a single item against the query. Higher = more relevant.
 * - Exact name match: +100
 * - Name starts with query: +50
 * - Name contains query as a word-prefix: +20
 * - Name contains query anywhere: +10
 * - Other fields match: +5 each
 *
 * Returns 0 if the item doesn't match at all.
 */
export function scoreItem(query: string, name: string, ...otherFields: (string | null | undefined)[]): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 1; // no query = neutral, keep original order
  const normalizedName = normalize(name);
  const fullQuery = tokens.join(' ');
  const otherNorm = normalize(otherFields.filter(Boolean).join(' '));

  if (!tokens.every((t) => normalizedName.includes(t) || otherNorm.includes(t))) return 0;

  let score = 0;

  if (normalizedName === fullQuery) {
    score += 100;
  } else if (normalizedName.startsWith(fullQuery)) {
    score += 50;
  } else if (tokens.every((t) => normalizedName.startsWith(t) || normalizedName.includes(' ' + t))) {
    score += 20;
  } else if (normalizedName.includes(fullQuery)) {
    score += 15;
  } else {
    score += 10; // name matched individual tokens but not the full phrase
  }

  // bonus for other field matches
  if (tokens.some((t) => otherNorm.includes(t))) {
    score += 5;
  }

  // penalty: longer names are slightly less relevant for short queries
  if (fullQuery.length < normalizedName.length / 2) {
    score -= 2;
  }

  return score;
}

/**
 * Filters and sorts a list of items by search relevance.
 * The `getSearchableText` function returns a tuple of [primaryName, ...otherFields].
 */
export function searchAndRank<T>(
  query: string,
  items: T[],
  getSearchableText: (item: T) => [string, ...(string | null | undefined)[]]
): T[] {
  const q = query.trim();
  if (!q) return items;
  return items
    .map((item) => {
      const [name, ...rest] = getSearchableText(item);
      return { item, score: scoreItem(q, name, ...rest) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}
