/**
 * Business data + solo-max ROI planner.
 * For each business: spend the whole balance on it alone, score ROI,
 * then rank — lazy player goes to one spot, not hopping the map.
 * Sources: businesses.json (explicit levels) + businesses-tiers.json (formulas).
 */

import { locationUnlocked, matchLocation } from "./locations.js";

const RAW_URLS = {
  businesses: [
    "./data/businesses.json",
    "/businesses.json",
    "../businesses.json",
    "https://raw.githubusercontent.com/c7x-services/rise-calc/refs/heads/main/businesses.json",
  ],
  tiers: [
    "./data/businesses-tiers.json",
    "/businesses-tiers.json",
    "../businesses-tiers.json",
    "https://raw.githubusercontent.com/c7x-services/rise-calc/refs/heads/main/businesses-tiers.json",
  ],
};

async function fetchFirst(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("fetch failed");
}

function stepValue(base, step, index) {
  if (!step) return base;
  if (step.type === "fixed") return base + index * step.value;
  if (step.type === "multiplier") return base * step.factor ** index;
  return base;
}

/** Expand tiers formula into cumulative {price, income} levels. */
function expandTier(t) {
  if (Array.isArray(t.levels) && t.levels.length) {
    return t.levels.map((lv) => ({
      price: Number(lv.price),
      income: Number(lv.income),
    }));
  }
  const out = [];
  for (let i = 0; i < t.levelCount; i++) {
    const price = stepValue(t.price1, t.priceStep, i);
    let income;
    if (t.incomeStep == null) {
      income = t.income1 * (i + 1);
    } else {
      income = stepValue(t.income1, t.incomeStep, i);
    }
    out.push({ price: Number(price), income: Number(income) });
  }
  return out;
}

function normalizeBusiness(raw, source) {
  const levelsRaw =
    source === "tiers" ? expandTier(raw) : (raw.levels || []).map((lv) => ({
      price: Number(lv.price),
      income: Number(lv.income),
    }));

  const levels = levelsRaw.map((lv, i) => {
    const prev = i === 0 ? 0 : levelsRaw[i - 1].income;
    return {
      price: lv.price,
      incomeTotal: lv.income,
      incomeDelta: lv.income - prev,
    };
  });

  return {
    id: `${source}:${raw.name}`,
    name: raw.name,
    coords: raw.coords || "",
    location: raw.location || "",
    requirement: Number(raw.requirement || 0),
    source,
    levels,
    maxLevel: levels.length,
  };
}

function mergeCatalog(businesses, tiers) {
  const list = [
    ...businesses.map((b) => normalizeBusiness(b, "biz")),
    ...tiers.map((t) => normalizeBusiness(t, "tiers")),
  ];
  list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return list;
}

let catalogPromise = null;
let catalogCache = null;

export function loadCatalog() {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (catalogPromise) return catalogPromise;
  catalogPromise = Promise.all([
    fetchFirst(RAW_URLS.businesses),
    fetchFirst(RAW_URLS.tiers),
  ])
    .then(([businesses, tiers]) => {
      catalogCache = mergeCatalog(businesses, tiers);
      return catalogCache;
    })
    .catch((err) => {
      catalogPromise = null;
      throw err;
    });
  return catalogPromise;
}

export function getOwned(levelsMap, biz) {
  const n = Number(levelsMap?.[biz.name] || 0);
  return Math.max(0, Math.min(biz.maxLevel, Math.floor(n)));
}

export function nextUpgrade(biz, owned) {
  if (owned >= biz.maxLevel) return null;
  return biz.levels[owned];
}

/** Cost to go from → to levels. Positive = pay, negative = refund. */
export function costBetweenLevels(biz, from, to) {
  const a = Math.max(0, Math.min(biz.maxLevel, Math.floor(Number(from) || 0)));
  const b = Math.max(0, Math.min(biz.maxLevel, Math.floor(Number(to) || 0)));
  let cost = 0;
  if (b > a) {
    for (let i = a; i < b; i++) cost += Number(biz.levels[i]?.price) || 0;
  } else if (b < a) {
    for (let i = b; i < a; i++) cost -= Number(biz.levels[i]?.price) || 0;
  }
  return cost;
}

/** Base income delta for level change (before player multiplier). */
export function incomeBetweenLevels(biz, from, to) {
  const a = Math.max(0, Math.min(biz.maxLevel, Math.floor(Number(from) || 0)));
  const b = Math.max(0, Math.min(biz.maxLevel, Math.floor(Number(to) || 0)));
  let income = 0;
  if (b > a) {
    for (let i = a; i < b; i++) income += Number(biz.levels[i]?.incomeDelta) || 0;
  } else if (b < a) {
    for (let i = b; i < a; i++) income -= Number(biz.levels[i]?.incomeDelta) || 0;
  }
  return income;
}

/** Sum of catalog incomes at currently owned levels (base, no multiplier). */
export function totalBusinessIncome(catalog, ownedLevels) {
  let sum = 0;
  for (const biz of catalog) {
    const have = getOwned(ownedLevels, biz);
    if (have <= 0) continue;
    sum += Number(biz.levels[have - 1]?.incomeTotal) || 0;
  }
  return sum;
}

/**
 * multiplier = HUD earnings / sum(business base incomes).
 * Returns null if cannot compute.
 */
export function computeEarningsMultiplier(catalog, ownedLevels, earningsPerSec) {
  const base = totalBusinessIncome(catalog, ownedLevels);
  const earn = Number(earningsPerSec) || 0;
  if (!(base > 0) || !(earn > 0) || !Number.isFinite(base) || !Number.isFinite(earn)) {
    return null;
  }
  return earn / base;
}

/**
 * For each unlocked business, simulate dumping the entire balance into it alone
 * (buy as many consecutive levels as afford). Rank by income/price of that pack.
 * Alternatives share the same budget — do not sum them.
 */
export function planPurchases(catalog, { rebirth, balance, ownedLevels }) {
  const budget = Math.max(0, Number(balance) || 0);
  const grouped = [];

  for (const biz of catalog) {
    if (rebirth < biz.requirement) continue;
    if (!locationUnlocked(biz.location, rebirth)) continue;

    const from = getOwned(ownedLevels, biz);
    let have = from;
    let left = budget;
    let price = 0;
    let incomeDelta = 0;
    const steps = [];

    while (have < biz.maxLevel) {
      const up = nextUpgrade(biz, have);
      if (!up || up.price <= 0 || up.price > left) break;
      left -= up.price;
      price += up.price;
      incomeDelta += up.incomeDelta;
      have += 1;
      steps.push({
        biz,
        from: have - 1,
        to: have,
        price: up.price,
        incomeDelta: up.incomeDelta,
        roi: up.incomeDelta / up.price,
      });
    }

    if (have === from) continue;

    grouped.push({
      biz,
      from,
      to: have,
      price,
      incomeDelta,
      buys: have - from,
      roiAvg: price > 0 ? incomeDelta / price : 0,
      left,
      steps,
    });
  }

  grouped.sort(
    (a, b) =>
      b.roiAvg - a.roiAvg ||
      b.incomeDelta - a.incomeDelta ||
      a.price - b.price ||
      a.biz.name.localeCompare(b.biz.name, "ru")
  );

  const best = grouped[0] || null;

  return {
    steps: best ? best.steps : [],
    grouped,
    spent: best ? best.price : 0,
    incomeGain: best ? best.incomeDelta : 0,
    left: best ? best.left : budget,
  };
}

export function listVisibleBusinesses(catalog, { rebirth, ownedLevels, showMaxed = false }) {
  return catalog.filter((biz) => {
    if (rebirth < biz.requirement) return false;
    if (!locationUnlocked(biz.location, rebirth)) return false;
    const have = getOwned(ownedLevels, biz);
    if (!showMaxed && have >= biz.maxLevel) return false;
    return true;
  });
}

export function formatIncome(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 100) return String(Math.round(n));
  if (abs >= 10) return n.toFixed(1).replace(/\.0$/, "");
  if (abs >= 1) return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatRoi(roi) {
  if (!Number.isFinite(roi) || roi <= 0) return "—";
  // income per 1K spent
  const perK = roi * 1000;
  if (perK >= 1) return `${perK.toFixed(2)}/1K`;
  return `${(roi * 1e6).toFixed(2)}/1M`;
}

export { matchLocation, locationUnlocked };
