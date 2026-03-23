#!/usr/bin/env node

/**
 * profit-hunter.mjs
 *
 * 使い方:
 * node scripts/profit-hunter.mjs --storage-state C:\Codex\yahoo-state.json
 * node scripts/profit-hunter.mjs --stores yamada-denki,joshin,edion,nojimaonline --pages 3 --max-items 50
 * node scripts/profit-hunter.mjs --keyword iPhone --json result.json --csv result.csv
 */

import fs from "node:fs/promises";
import path from "node:path";
import { searchMobileIchibanByJan } from "./mobile-ichiban.mjs";

const DEFAULTS = {
  stores: ["yamada-denki", "joshin", "edion", "nojimaonline"],
  keyword: "",
  pages: 2,
  maxItems: 40,
  concurrency: 5,
  minProfit: 0,
  mode: "normal",
  pointSource: "with-entry",
  timeoutMs: 30000,
  jsonPath: "profit-hunter-result.json",
  csvPath: "profit-hunter-result.csv",
};

const ACCESSORY_KEYWORDS = [
  "ケース",
  "カバー",
  "フィルム",
  "ガラス",
  "保護",
  "ケーブル",
  "充電",
  "アダプタ",
  "スタンド",
  "ホルダー",
  "ストラップ",
  "バンド",
  "シート",
  "ポーチ",
  "手帳型",
  "マグネット",
  "イヤーピース",
  "レンズ保護",
  "液晶保護",
  "ハイブリッドケース",
  "TPU",
  "ソフトケース",
  "ハードケース",
  "背面型ケース",
  "ガラスフィルム",
  "保護フィルム",
  "クリアケース",
  "充電器",
  "チャージャー",
  "置くだけ充電",
  "ワイヤレス充電器",
  "ACアダプタ",
  "モバイルバッテリー",
  "ケーブル一体",
  "ドック",
  "ドッキング",
  "コントローラー充電",
  "保護カバー",
  "保護ケース",
];

const POSITIVE_HINTS = [
  "iphone",
  "ipad",
  "pixel",
  "xperia",
  "galaxy",
  "surface",
  "switch",
  "ps5",
  "playstation",
  "macbook",
  "apple watch",
  "airpods",
  "ipad pro",
  "ipad air",
  "ipad mini",
  "iphone se",
  "simフリー",
  "本体",
  "未使用",
  "新品",
];

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--stores") {
      args.stores = String(next || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === "--store") {
      args.stores = [String(next || "").trim()].filter(Boolean);
      i += 1;
    } else if (arg === "--keyword") {
      args.keyword = next ?? "";
      i += 1;
    } else if (arg === "--pages") {
      args.pages = Number(next);
      i += 1;
    } else if (arg === "--max-items") {
      args.maxItems = Number(next);
      i += 1;
    } else if (arg === "--concurrency") {
      args.concurrency = Number(next);
      i += 1;
    } else if (arg === "--min-profit") {
      args.minProfit = Number(next);
      i += 1;
    } else if (arg === "--mode") {
      args.mode = next;
      i += 1;
    } else if (arg === "--point-source") {
      args.pointSource = next;
      i += 1;
    } else if (arg === "--timeout") {
      args.timeoutMs = Number(next);
      i += 1;
    } else if (arg === "--storage-state") {
      args.storageState = next;
      i += 1;
    } else if (arg === "--json") {
      args.jsonPath = next;
      i += 1;
    } else if (arg === "--csv") {
      args.csvPath = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/profit-hunter.mjs [options]

Options:
  --stores <a,b,c>       Yahoo store ids (default: yamada-denki,joshin,edion,nojimaonline)
  --store <id>           Single store
  --keyword <text>       Search keyword in store
  --pages <n>            Number of pages per store (default: 2)
  --max-items <n>        Max item detail pages per store (default: 40)
  --concurrency <n>      Parallel fetch count (default: 5)
  --mode <normal|yutori|deposit>
                         Morimori price mode (default: normal)
  --point-source <total|with-entry>
                         Yahoo point source (default: with-entry)
  --min-profit <yen>     Minimum profit filter (default: 0)
  --timeout <ms>         Fetch timeout in ms (default: 30000)
  --storage-state <path> Playwright storageState JSON
  --json <path>          Write JSON result (default: profit-hunter-result.json)
  --csv <path>           Write CSV result (default: profit-hunter-result.csv)
  --help                 Show this help
`);
}

function ensureValidArgs(args) {
  if (!Array.isArray(args.stores) || !args.stores.length) {
    throw new Error("--stores or --store is required");
  }
  if (!Number.isFinite(args.pages) || args.pages < 1) {
    throw new Error("--pages must be >= 1");
  }
  if (!Number.isFinite(args.maxItems) || args.maxItems < 1) {
    throw new Error("--max-items must be >= 1");
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be >= 1");
  }
  if (!["normal", "yutori", "deposit"].includes(args.mode)) {
    throw new Error("--mode must be one of: normal, yutori, deposit");
  }
  if (!["total", "with-entry"].includes(args.pointSource)) {
    throw new Error("--point-source must be one of: total, with-entry");
  }
}

function normalizeYen(value) {
  if (value == null) return null;
  const n = String(value).replace(/[^\d.-]/g, "");
  if (!n) return null;
  const num = Number(n);
  return Number.isFinite(num) ? num : null;
}

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, timeoutMs = DEFAULTS.timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function createHttpClient(args) {
  if (!args.storageState) {
    return {
      fetchText: (url, timeoutMs) => fetchText(url, timeoutMs),
      close: async () => {},
      mode: "default-fetch",
    };
  }

  let request;
  try {
    ({ request } = await import("playwright"));
  } catch {
    throw new Error("playwright is required when --storage-state is used. Run: npm install playwright");
  }

  const ctx = await request.newContext({
    storageState: args.storageState,
    extraHTTPHeaders: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    ignoreHTTPSErrors: true,
  });

  return {
    mode: "playwright-storage-state",
    fetchText: async (url, timeoutMs = DEFAULTS.timeoutMs) => {
      const res = await ctx.get(url, { timeout: timeoutMs });
      if (!res.ok()) {
        throw new Error(`HTTP ${res.status()} for ${url}`);
      }
      return await res.text();
    },
    close: async () => {
      await ctx.dispose();
    },
  };
}

async function runPool(items, concurrency, worker) {
  const out = [];
  let idx = 0;

  async function loop() {
    while (idx < items.length) {
      const myIdx = idx;
      idx += 1;
      try {
        out[myIdx] = await worker(items[myIdx], myIdx);
      } catch (err) {
        out[myIdx] = { error: err?.message || String(err) };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => loop());
  await Promise.all(workers);
  return out;
}

function buildStoreSearchUrl(storeId, keyword, page) {
  const q = new URLSearchParams();
  q.set("p", keyword || "");
  if (page > 1) q.set("page", String(page));
  return `https://store.shopping.yahoo.co.jp/${storeId}/search.html?${q.toString()}`;
}

function extractYahooItemUrls(searchHtml, storeId) {
  const absRe = new RegExp(
    `https://store\\.shopping\\.yahoo\\.co\\.jp/${storeId}/[^"'\\s<>]+\\.html`,
    "g",
  );
  const relRe = new RegExp(`href=["'](/${storeId}/[^"'#?\\s<>]+\\.html)`, "g");

  const urls = new Set();

  for (const m of searchHtml.matchAll(absRe)) {
    urls.add(m[0]);
  }
  for (const m of searchHtml.matchAll(relRe)) {
    urls.add(`https://store.shopping.yahoo.co.jp${m[1]}`);
  }

  const blocked = new Set(["guide.html", "info.html", "review.html"]);
  return [...urls].filter((u) => ![...blocked].some((x) => u.includes(x)));
}

function extractModelHint(title) {
  if (!title) return "";
  const parts = title
    .replace(/[【】\[\]（）()]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const candidate = parts.find((p) => /[A-Za-z].*\d|\d.*[A-Za-z]/.test(p) && p.length >= 5);
  return candidate || parts.slice(0, 3).join(" ");
}

function parseNextDataFromYahooItem(html) {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) return null;

  let root;
  try {
    root = JSON.parse(m[1]);
  } catch {
    return null;
  }

  const pp = root?.props?.pageProps;
  if (!pp || typeof pp !== "object") return null;

  const item = pp.item || {};
  const point = pp.point || {};

  const price =
    item.applicablePrice ?? item.regularPrice ?? item?.priceTable?.oneLayersPrice?.price ?? null;
  const totalPoint = point.totalPoint ?? 0;
  const totalPointWithEntry = point.totalPointWithEntry ?? totalPoint;
  const janRaw = item.janCode;
  const jan = janRaw != null ? String(janRaw).replace(/\D/g, "") : null;

  return {
    title: item.name || null,
    jan: jan || null,
    price: normalizeYen(price),
    point: normalizeYen(totalPoint) ?? 0,
    pointWithEntry: normalizeYen(totalPointWithEntry) ?? normalizeYen(totalPoint) ?? 0,
    modelHint: extractModelHint(item.name || ""),
  };
}

function isAccessory(title) {
  const text = String(title || "").toLowerCase();

  if (ACCESSORY_KEYWORDS.some((k) => text.includes(k.toLowerCase()))) {
    return true;
  }

  const hasPositiveHint = POSITIVE_HINTS.some((k) => text.includes(k));
  if (!hasPositiveHint) {
    return false;
  }

  const obviousBodyWords = [
    "simフリー",
    "本体",
    "未使用",
    "新品",
    "128gb",
    "256gb",
    "512gb",
    "1tb",
  ];

  if (obviousBodyWords.some((k) => text.includes(k.toLowerCase()))) {
    return false;
  }

  return false;
}

function parseMorimoriProducts(html) {
  const blocks = html.split(/<div class="product-item\b/).slice(1);
  const rows = [];

  for (const block of blocks) {
    const nameRaw = block.match(/<h4 class="search-product-details-name">([\s\S]*?)<\/h4>/i)?.[1] || "";
    const name = stripHtml(nameRaw);
    const jan = block.match(/JAN\s*[:：]\s*(\d{8,14})/i)?.[1] || null;
    const normal = normalizeYen(
      block.match(/<div class="price-normal-number">([\s\S]*?)<\/div>/i)?.[1] || "",
    );
    const yutori = normalizeYen(
      block.match(/<div class="price y-price-color">([\s\S]*?)<\/div>/i)?.[1] || "",
    );
    const deposit = normalizeYen(
      block.match(/<div class="deposit-price-number[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "",
    );
    const relUrl = block.match(/<a href=['"]([^'"]*\/product\/[^'"]+)['"]/i)?.[1] || null;

    if (!name && !jan) continue;

    rows.push({
      name,
      jan,
      normal,
      yutori,
      deposit,
      url: relUrl ? new URL(relUrl, "https://www.morimori-kaitori.jp").href : null,
    });
  }

  return rows;
}

function pickMorimoriBest(products, yahooItem, mode) {
  if (!products.length) return null;

  const priceKey = mode;
  const withPrice = products.filter((p) => normalizeYen(p[priceKey]) != null);
  if (!withPrice.length) return null;

  if (yahooItem.jan) {
    const exactJan = withPrice.filter((p) => p.jan && p.jan === yahooItem.jan);
    if (exactJan.length) {
      return exactJan.sort((a, b) => (b[priceKey] || 0) - (a[priceKey] || 0))[0];
    }
  }

  const hint = (yahooItem.modelHint || "").toLowerCase();
  if (hint) {
    const hinted = withPrice.filter((p) => p.name.toLowerCase().includes(hint));
    if (hinted.length) {
      return hinted.sort((a, b) => (b[priceKey] || 0) - (a[priceKey] || 0))[0];
    }
  }

  return withPrice.sort((a, b) => (b[priceKey] || 0) - (a[priceKey] || 0))[0];
}

function buildMorimoriQuery(yahooItem) {
  if (yahooItem.jan) return yahooItem.jan;
  if (yahooItem.modelHint) return yahooItem.modelHint;
  return (yahooItem.title || "").slice(0, 40);
}

function chooseBestBuyer(row) {
  const candidates = [];

  if (Number.isFinite(row.morimoriPrice)) {
    candidates.push({
      buyerName: `森森(${row.morimoriMode})`,
      buyerPrice: row.morimoriPrice,
      buyerProfit: row.morimoriSelectedProfit,
      buyerUrl: row.morimoriMatched?.url || row.morimoriSearchUrl || null,
    });
  }

  if (Number.isFinite(row.mobileIchibanPrice)) {
    candidates.push({
      buyerName: "モバイル一番",
      buyerPrice: row.mobileIchibanPrice,
      buyerProfit: row.mobileIchibanProfit,
      buyerUrl: row.mobileIchibanMatched?.url || null,
    });
  }

  if (!candidates.length) {
    return {
      buyerName: "-",
      buyerPrice: null,
      buyerProfit: null,
      buyerUrl: null,
    };
  }

  return candidates.sort((a, b) => (b.buyerProfit ?? -Infinity) - (a.buyerProfit ?? -Infinity))[0];
}

function calcScore(row) {
  let score = 0;
  if (Number.isFinite(row.bestProfit)) score += Math.min(80, row.bestProfit / 100);
  if (Number.isFinite(row.selectedEffectivePrice) && row.selectedEffectivePrice > 0) {
    const roi = (row.bestProfit / row.selectedEffectivePrice) * 100;
    if (Number.isFinite(roi)) score += Math.min(20, roi);
  }
  return Math.round(score * 100) / 100;
}

function formatYen(n) {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${Math.round(n).toLocaleString("ja-JP")}円`;
}

function printResultTable(results) {
  if (!results.length) {
    console.log("\n利益が出る候補は見つかりませんでした。");
    return;
  }

  const header = [
    "No",
    "Store",
    "買取先",
    "利益",
    "Yahoo実質",
    "買取価格",
    "JAN",
    "商品名",
  ];

  console.log(`\n${header.join(" | ")}`);
  console.log(header.map(() => "---").join(" | "));

  results.forEach((r, i) => {
    const line = [
      String(i + 1),
      r.storeId || "-",
      r.bestBuyerName || "-",
      formatYen(r.bestProfit),
      formatYen(r.selectedEffectivePrice),
      formatYen(r.bestBuyerPrice),
      r.jan || "-",
      (r.title || "").slice(0, 60),
    ];
    console.log(line.join(" | "));
  });
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeCsv(csvPath, rows) {
  const headers = [
    "score",
    "storeId",
    "title",
    "jan",
    "yahooPrice",
    "selectedPoint",
    "selectedEffectivePrice",
    "bestBuyerName",
    "bestBuyerPrice",
    "bestProfit",
    "itemUrl",
    "bestBuyerUrl",
    "morimoriPrice",
    "mobileIchibanPrice",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((h) => csvEscape(row[h])).join(","),
    ),
  ];

  await fs.writeFile(csvPath, lines.join("\n"), "utf8");
}

async function scanStore(client, storeId, args) {
  console.log(`\n=== store: ${storeId} ===`);

  const pageUrls = Array.from({ length: args.pages }, (_, i) =>
    buildStoreSearchUrl(storeId, args.keyword || "", i + 
