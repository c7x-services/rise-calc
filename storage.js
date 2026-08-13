/** Multi-account persistence in localStorage. */

const STORAGE_KEY = "bomj_rebirth_web_v1";

function emptyAccount(name) {
  return {
    id: crypto.randomUUID(),
    name,
    rebirth: 0,
    balance: 0,
    balanceRaw: "",
    earningsPerSec: 0,
    earningsRaw: "",
    setupComplete: false,
    lastTickAt: null,
    businessLevels: {},
    createdAt: Date.now(),
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const acc = emptyAccount("Аккаунт 1");
      return { accounts: [acc], activeAccountId: acc.id };
    }
    const data = JSON.parse(raw);
    if (!Array.isArray(data.accounts) || data.accounts.length === 0) {
      const acc = emptyAccount("Аккаунт 1");
      return { accounts: [acc], activeAccountId: acc.id };
    }
    for (const a of data.accounts) {
      if (!a.businessLevels || typeof a.businessLevels !== "object") {
        a.businessLevels = {};
      }
    }
    return data;
  } catch {
    const acc = emptyAccount("Аккаунт 1");
    return { accounts: [acc], activeAccountId: acc.id };
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getActiveAccount(state) {
  return state.accounts.find((a) => a.id === state.activeAccountId) || state.accounts[0];
}

export function addAccount(state, name) {
  const acc = emptyAccount(name || `Аккаунт ${state.accounts.length + 1}`);
  state.accounts.push(acc);
  state.activeAccountId = acc.id;
  saveState(state);
  return acc;
}

export function removeAccount(state, id) {
  if (state.accounts.length <= 1) return false;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  if (state.activeAccountId === id) {
    state.activeAccountId = state.accounts[0].id;
  }
  saveState(state);
  return true;
}

export function renameAccount(state, id, name) {
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc) return null;
  const next = (name || "").trim();
  if (!next) return null;
  acc.name = next;
  saveState(state);
  return acc;
}

export function updateAccount(state, patch) {
  const acc = getActiveAccount(state);
  Object.assign(acc, patch);
  saveState(state);
  return acc;
}
