/** Money parse/format — mirrors bomj_rebirth/money.py (integer rubles internally). */

const SUFFIX_MUL = {
  "": 1,
  K: 1e3,
  M: 1e6,
  B: 1e9,
  T: 1e12,
  Q: 1e15,
  Qi: 1e18,
  S: 1e21,
};

const SUFFIX_CANON = {
  "": "",
  K: "K",
  M: "M",
  B: "B",
  T: "T",
  Q: "Q",
  QI: "Qi",
  S: "S",
};

const MONEY_RE = /^\s*([-+]?\d+(?:\.\d+)?)\s*(QI|K|M|B|T|Q|S)?\s*$/i;

function countDecimals(num) {
  const i = num.indexOf(".");
  return i < 0 ? 0 : num.length - i - 1;
}

function normalizeSuffix(suf) {
  return SUFFIX_CANON[(suf || "").toUpperCase()] ?? "";
}

export function scrubBalanceRaw(text) {
  if (!text) return text;
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  const m = parseMoney(cleaned);
  if (!m) return cleaned;
  if (["Q", "Qi", "S", "T"].includes(m.suffix) && m.display >= 100) {
    return m.raw.slice(0, m.raw.length - m.suffix.length);
  }
  return m.raw;
}

export function parseMoney(text, { forceDecimals = null } = {}) {
  if (!text) return null;
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  const m = MONEY_RE.exec(cleaned);
  if (!m) return null;
  const numS = m[1];
  const suf = normalizeSuffix(m[2] || "");
  if (!(suf in SUFFIX_MUL)) return null;
  const display = Number(numS);
  if (Number.isNaN(display)) return null;
  const seen = countDecimals(numS);
  const decimals = forceDecimals == null ? seen : forceDecimals;
  const mul = SUFFIX_MUL[suf];
  const ulp = 0.5 * 10 ** -decimals;
  const lower = Math.floor((display - ulp) * mul);
  const nominal = Math.round(display * mul);
  return {
    raw: `${numS}${suf}`,
    display,
    suffix: suf,
    decimals,
    multiplier: mul,
    lower,
    nominal,
  };
}

export function parseBalance(text) {
  return parseMoney(scrubBalanceRaw(text), { forceDecimals: 2 });
}

export function formatMoney(value, maxDecimals = 2) {
  let v = Math.round(Number(value) || 0);
  if (v < 0) return `-${formatMoney(-v, maxDecimals)}`;
  const tiers = [
    ["S", 1e21],
    ["Qi", 1e18],
    ["Q", 1e15],
    ["T", 1e12],
    ["B", 1e9],
    ["M", 1e6],
    ["K", 1e3],
  ];
  let chosen = "";
  let mul = 1;
  for (const [suf, m] of tiers) {
    if (v >= m) {
      chosen = suf;
      mul = m;
      break;
    }
  }
  if (!chosen) return v >= 100 ? String(v) : String(v);
  const scale = 10 ** maxDecimals;
  const scaled = Math.floor((v * scale + mul / 2) / mul);
  const whole = Math.floor(scaled / scale);
  const frac = scaled % scale;
  if (whole >= 100) return `${whole}${chosen}`;
  if (whole >= 10) {
    const d1 = Math.floor((v * 10 + mul / 2) / mul);
    const w = Math.floor(d1 / 10);
    const f = d1 % 10;
    if (f === 0) return `${w}${chosen}`;
    return `${w}.${f}${chosen}`;
  }
  if (frac === 0) return `${whole}${chosen}`;
  const fracS = String(frac).padStart(maxDecimals, "0").replace(/0+$/, "");
  return `${whole}.${fracS}${chosen}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds === Infinity) return "∞";
  let sec = Math.round(seconds);
  if (sec < 60) return `${sec}с`;
  let mins = Math.floor(sec / 60);
  sec %= 60;
  if (mins < 60) return `${mins}м ${String(sec).padStart(2, "0")}с`;
  let hours = Math.floor(mins / 60);
  mins %= 60;
  if (hours < 48) return `${hours}ч ${String(mins).padStart(2, "0")}м`;
  const days = Math.floor(hours / 24);
  hours %= 24;
  return `${days}д ${hours}ч`;
}
