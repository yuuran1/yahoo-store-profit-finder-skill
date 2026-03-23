const MOBILE_ICHIBAN_URL = "https://www.mobile-ichiban.com/";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeYen(value) {
  if (value == null) return null;
  const n = String(value).replace(/[^\d]/g, "");
  if (!n) return null;
  const num = Number(n);
  return Number.isFinite(num) ? num : null;
}

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCandidateBlocks(html) {
  const plain = stripHtml(html);

  const janMatches = [...plain.matchAll(/JAN[:：]\s*([0-9A-Za-z-]{8,20})/g)];
  if (!janMatches.length) return [];

  const blocks = [];

  for (let i = 0; i < janMatches.length; i++) {
    const start = Math.max(0, janMatches[i].index - 150);
    const end =
      i + 1 < janMatches.length
        ? Math.min(plain.length, janMatches[i + 1].index + 40)
        : Math.min(plain.length, janMatches[i].index + 300);

    blocks.push(plain.slice(start, end));
  }

  return blocks;
}

function parseBlock(blockText) {
  const janMatch = blockText.match(/JAN[:：]\s*([0-9A-Za-z-]{8,20})/);
  if (!janMatch) return null;

  const jan = normalizeText(janMatch[1]);

  const priceMatch = blockText.match(/(\d[\d,]{2,})\s*円/);
  if (!priceMatch) return null;

  const price = normalizeYen(priceMatch[1]);

  const title = normalizeText(blockText.slice(0, blockText.indexOf(janMatch[0])));

  return {
    site: "mobile-ichiban",
    siteLabel: "モバイル一番",
    url: MOBILE_ICHIBAN_URL,
    jan,
    title,
    price,
    mode: "normal",
    condition: "unknown",
    notes: [],
  };
}

export function parseMobileIchibanTopPage(html) {
  const blocks = splitCandidateBlocks(html);

  const results = [];

  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (parsed) results.push(parsed);
  }

  return results;
}

export async function searchMobileIchibanByJan(http, jan, timeoutMs = 30000) {
  if (!jan) return null;

  const html = await http.fetchText(MOBILE_ICHIBAN_URL, timeoutMs);

  const items = parseMobileIchibanTopPage(html);

  const hit = items.find((x) => String(x.jan) === String(jan));

  if (!hit) return null;

  return hit;
}
