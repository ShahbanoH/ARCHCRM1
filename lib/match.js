// Company-name and domain matching used by the smart importer.

const STOPWORDS = new Set(["and", "the", "of", "a", "inc", "llc", "co", "corp", "corporation"]);

export function normName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function nameTokens(name) {
  return normName(name)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w));
}

export function extractDomain(url) {
  const s = (url || "").trim().toLowerCase();
  if (!s) return "";
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?([^/\s?#]+)/);
  return m ? m[1] : "";
}

// Parses Apollo's "Subsidiary of" format: "Company Name (domain.com)"
export function parseSubsidiary(value) {
  const s = (value || "").trim();
  if (!s) return null;
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) return { name: m[1].trim(), domain: extractDomain(m[2]) };
  return { name: s, domain: "" };
}

export function formatRevenue(value) {
  const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
  if (!n) return "";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

// Finds the best entity match for a company. Order of confidence:
// website domain, exact normalized name, high token overlap, then
// word-prefix / token-containment (only when a single candidate fits).
export function findMatch(entities, { name, domain }) {
  if (domain) {
    const byDomain = entities.find((e) => e._domain && e._domain === domain);
    if (byDomain) return byDomain;
  }
  const norm = normName(name);
  if (!norm) return null;
  const exact = entities.find((e) => e._norm === norm);
  if (exact) return exact;

  const inTokens = new Set(nameTokens(name));
  if (inTokens.size === 0) return null;

  let best = null;
  let bestScore = 0;
  const loose = [];
  for (const e of entities) {
    const eTokens = e._tokens;
    if (eTokens.size === 0) continue;
    let common = 0;
    for (const t of eTokens) if (inTokens.has(t)) common++;
    const union = eTokens.size + inTokens.size - common;
    const score = union === 0 ? 0 : common / union;
    if (score >= 0.8 && common >= 2 && score > bestScore) {
      best = e;
      bestScore = score;
    }
    const smaller = Math.min(eTokens.size, inTokens.size);
    const contained = common === smaller && smaller >= 1 && eTokens.size !== inTokens.size;
    const prefix =
      e._norm && norm && (norm.startsWith(e._norm + " ") || e._norm.startsWith(norm + " "));
    if (contained && (smaller >= 2 || prefix)) loose.push(e);
  }
  if (best) return best;
  if (loose.length === 1) return loose[0];
  return null;
}

// Precomputes match keys on an entity row (mutates and returns it).
export function indexEntity(entity) {
  entity._norm = normName(entity.name);
  entity._tokens = new Set(nameTokens(entity.name));
  entity._domain = extractDomain(entity.website);
  return entity;
}
