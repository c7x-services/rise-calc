/** Rebirth cost table — mirrors bomj_rebirth/costs.py */
export const REBIRTH_COST_RAW = {
  1: "50M",
  2: "60M",
  3: "75M",
  4: "100M",
  5: "130M",
  6: "150M",
  7: "180M",
  8: "200M",
  9: "225M",
  10: "250M",
  11: "275M",
  12: "300M",
  13: "350M",
  14: "375M",
  15: "400M",
  16: "500M",
  17: "900M",
  18: "1.5B",
  19: "2.5B",
  20: "5B",
  21: "10B",
  22: "25B",
  23: "100B",
  24: "250B",
  25: "500B",
  26: "50T",
  27: "100T",
  28: "200T",
  29: "500T",
  30: "1Q",
  31: "10Q",
  32: "20Q",
  33: "50Q",
  34: "100Q",
  35: "10S",
  36: "20S",
  37: "50S",
};

export const MAX_REBIRTH = 37;

export function nextCostLabel(currentRebirth) {
  return REBIRTH_COST_RAW[currentRebirth + 1] || "—";
}

export function describeTarget(currentRebirth) {
  const nxt = currentRebirth + 1;
  if (nxt > MAX_REBIRTH) return `R${currentRebirth} (макс)`;
  return `R${currentRebirth} → R${nxt} (${nextCostLabel(currentRebirth)})`;
}

export function nextCostNominal(currentRebirth, parseMoney) {
  const raw = REBIRTH_COST_RAW[currentRebirth + 1];
  if (!raw) return null;
  const m = parseMoney(raw);
  return m ? m.nominal : null;
}

export function remainingToRebirth(currentRebirth, balance, parseMoney) {
  const need = nextCostNominal(currentRebirth, parseMoney);
  if (need == null) return null;
  return Math.max(0, need - balance);
}
