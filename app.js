import {
  describeTarget,
  remainingToRebirth,
  nextCostNominal,
  MAX_REBIRTH,
} from "./costs.js";
import {
  parseBalance,
  parseMoney,
  formatMoney,
  formatDuration,
} from "./money.js";
import {
  loadState,
  saveState,
  getActiveAccount,
  addAccount,
  removeAccount,
  renameAccount,
  updateAccount,
} from "./storage.js";

let state = loadState();
let wizardStep = 0;
/** @type {number|null} */
let balanceEnteredAt = null;
let sessionEarned = 0;
let tickTimer = null;

const $ = (sel) => document.querySelector(sel);

const wizardEl = $("#wizard");
const dashboardEl = $("#dashboard");
const wizardError = $("#wizard-error");
const dashboardError = $("#dashboard-error");
const accountSelect = $("#account-select");

function showWizardError(msg) {
  if (!wizardError) return;
  wizardError.textContent = msg;
  wizardError.classList.toggle("hidden", !msg);
}

function showDashboardError(msg) {
  if (!dashboardError) return;
  dashboardError.textContent = msg;
  dashboardError.classList.toggle("hidden", !msg);
}

function showError(msg) {
  showWizardError(msg);
}

function activeAccount() {
  return getActiveAccount(state);
}

function renderAccountSelect() {
  accountSelect.innerHTML = "";
  for (const acc of state.accounts) {
    const opt = document.createElement("option");
    opt.value = acc.id;
    opt.textContent = acc.name;
    if (acc.id === state.activeAccountId) opt.selected = true;
    accountSelect.appendChild(opt);
  }
}

function setWizardStep(step) {
  wizardStep = step;
  document.querySelectorAll(".step").forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle("step--active", n === step);
    el.classList.toggle("step--done", n < step);
  });
  $("#panel-rebirth").classList.toggle("hidden", step !== 0);
  $("#panel-balance").classList.toggle("hidden", step !== 1);
  $("#panel-earnings").classList.toggle("hidden", step !== 2);

  if (step === 0) {
    const acc = activeAccount();
    $("#input-rebirth").value = String(acc.rebirth ?? 0);
    $("#hint-rebirth").textContent = describeTarget(Number($("#input-rebirth").value) || 0);
  }
  if (step === 1) {
    $("#input-balance").value = activeAccount().balanceRaw || "";
    balanceEnteredAt = null;
  }
  if (step === 2) {
    $("#input-earnings").value = activeAccount().earningsRaw || "";
    updateEarningsElapsedHint();
  }
  showError("");
}

function updateEarningsElapsedHint() {
  const el = $("#hint-earnings-elapsed");
  if (!balanceEnteredAt) {
    el.textContent = "Сначала подтвердите баланс на предыдущем шаге.";
    return;
  }
  const sec = Math.max(0, Math.floor((Date.now() - balanceEnteredAt) / 1000));
  const earn = parseMoney($("#input-earnings").value.trim());
  const add = earn ? earn.nominal * sec : 0;
  el.textContent = `С момента ввода баланса: ${formatDuration(sec)} → начислим +${formatMoney(add)} при «Продолжить».`;
}

function openWizard(prefill = true) {
  wizardEl.classList.remove("hidden");
  dashboardEl.classList.add("hidden");
  if (prefill) {
    const acc = activeAccount();
    setWizardStep(0);
    if (acc.setupComplete) {
      $("#input-rebirth").value = String(acc.rebirth);
      $("#input-balance").value = acc.balanceRaw;
      $("#input-earnings").value = acc.earningsRaw;
    }
  } else {
    setWizardStep(0);
  }
}

function openDashboard() {
  wizardEl.classList.add("hidden");
  dashboardEl.classList.remove("hidden");
  renderDashboard({ syncInputs: true });
}

const ETA_RING_MAX_S = 14 * 24 * 3600;
const ETA_RING_R = 52;
const ETA_RING_C = 2 * Math.PI * ETA_RING_R;

function computeStatus(acc) {
  const rem = remainingToRebirth(acc.rebirth, acc.balance, parseMoney);
  const need = nextCostNominal(acc.rebirth, parseMoney);
  let eta = null;
  const ready = rem !== null && rem <= 0;
  if (rem !== null && rem > 0 && acc.earningsPerSec > 0) {
    eta = rem / acc.earningsPerSec;
  }
  return { rem, need, eta, ready, target: describeTarget(acc.rebirth) };
}

function isFocused(el) {
  return el && document.activeElement === el;
}

function updateEtaRing(st) {
  const wrap = $("#eta-ring-wrap");
  const prog = $("#eta-ring-prog");
  const text = $("#eta-ring-text");
  const hint = $("#stat-eta-hint");
  if (!wrap || !prog || !text) return;

  const show =
    st.eta != null &&
    Number.isFinite(st.eta) &&
    st.eta > 0 &&
    st.eta <= ETA_RING_MAX_S &&
    st.need != null &&
    st.need > 0 &&
    st.rem != null;

  wrap.classList.toggle("hidden", !show);
  if (hint) {
    hint.textContent = show
      ? "круг — доля оставшегося до R"
      : st.eta != null && st.eta > ETA_RING_MAX_S
        ? "круг скрыт (>14 дн.)"
        : "";
  }
  if (!show) return;

  // Remaining fraction of rebirth cost (1 = только начали, 0 = готово).
  const left = Math.min(1, Math.max(0, st.rem / st.need));
  prog.style.strokeDasharray = String(ETA_RING_C);
  prog.style.strokeDashoffset = String(ETA_RING_C * (1 - left));
  text.textContent = formatDuration(st.eta);
}

function renderDashboard({ syncInputs = false } = {}) {
  const acc = activeAccount();
  const st = computeStatus(acc);
  $("#stat-target").textContent = st.target;
  $("#stat-balance").textContent = formatMoney(acc.balance);
  $("#stat-balance").classList.toggle("stat__value--ok", st.ready);
  $("#stat-balance-raw").textContent = acc.balanceRaw ? `HUD: ${acc.balanceRaw}` : "";
  $("#stat-remaining").textContent =
    st.rem == null ? "макс" : st.ready ? "ГОТОВО" : formatMoney(st.rem);
  $("#stat-eta").textContent =
    st.ready ? "ГОТОВО" : st.eta != null ? `≈ ${formatDuration(st.eta)}` : "нет заработка";
  $("#stat-earnings").textContent = acc.earningsRaw ? `+${acc.earningsRaw}/с` : "—";
  $("#stat-session").textContent = formatMoney(sessionEarned);
  $("#stat-session-detail").textContent = "только пока вкладка открыта (можно свернуть)";

  updateEtaRing(st);

  if (syncInputs) {
    const rebirthEl = $("#edit-rebirth");
    const earnEl = $("#edit-earnings");
    const balEl = $("#edit-balance");
    if (!isFocused(rebirthEl)) rebirthEl.value = String(acc.rebirth);
    if (!isFocused(earnEl)) earnEl.value = acc.earningsRaw || "";
    if (!isFocused(balEl)) balEl.value = acc.balanceRaw || "";
  }

  updateBalanceSecHint();
}

function updateBalanceSecHint() {
  const acc = activeAccount();
  const el = $("#hint-balance-sec");
  if (!el) return;
  const n = Math.max(0, Math.floor(Number($("#edit-balance-sec").value) || 0));
  const delta = acc.earningsPerSec * n;
  if (!acc.earningsPerSec) {
    el.textContent = "сначала задай заработок";
    return;
  }
  el.textContent =
    n > 0
      ? `±${formatMoney(delta)} (${formatMoney(acc.earningsPerSec)}/с × ${n})`
      : "± заработок × N";
}

function applyPatch(patch) {
  updateAccount(state, patch);
  renderDashboard({ syncInputs: true });
  showDashboardError("");
}

function applyRebirthFromDashboard() {
  const n = Number($("#edit-rebirth").value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_REBIRTH) {
    showDashboardError(`Перерождение: 0–${MAX_REBIRTH}`);
    return;
  }
  applyPatch({ rebirth: n });
}

function applyEarningsFromDashboard() {
  const raw = $("#edit-earnings").value.trim();
  const m = parseMoney(raw);
  if (!m) {
    showDashboardError("Не удалось разобрать заработок");
    return;
  }
  applyPatch({ earningsRaw: m.raw, earningsPerSec: m.nominal });
}

function setBalanceFromDashboard() {
  const raw = $("#edit-balance").value.trim();
  const m = parseBalance(raw);
  if (!m) {
    showDashboardError("Не удалось разобрать баланс");
    return;
  }
  applyPatch({ balanceRaw: m.raw, balance: m.lower });
}

function resetBalanceToZero() {
  applyPatch({ balance: 0, balanceRaw: "0" });
}

function adjustBalanceBySeconds(sign) {
  const acc = activeAccount();
  const n = Math.floor(Number($("#edit-balance-sec").value) || 0);
  if (n <= 0) {
    showDashboardError("Укажите N > 0");
    return;
  }
  if (acc.earningsPerSec <= 0) {
    showDashboardError("Заработок не задан");
    return;
  }
  const delta = acc.earningsPerSec * n * sign;
  applyPatch({ balance: Math.max(0, acc.balance + delta) });
}

function tick() {
  const acc = activeAccount();
  if (!acc.setupComplete || acc.earningsPerSec <= 0) return;
  acc.balance += acc.earningsPerSec;
  acc.lastTickAt = Date.now();
  sessionEarned += acc.earningsPerSec;
  updateAccount(state, {
    balance: acc.balance,
    lastTickAt: acc.lastTickAt,
  });
  if (!dashboardEl.classList.contains("hidden")) {
    renderDashboard({ syncInputs: false });
  }
}

function startTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
}

function validateRebirth() {
  const n = Number($("#input-rebirth").value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_REBIRTH) {
    showError(`Перерождение: целое число 0–${MAX_REBIRTH}`);
    return null;
  }
  return n;
}

function validateBalance() {
  const raw = $("#input-balance").value.trim();
  const m = parseBalance(raw);
  if (!m) {
    showError("Не удалось разобрать баланс (пример: 38.97K, 1.45M)");
    return null;
  }
  return { raw: m.raw, lower: m.lower };
}

function validateEarnings() {
  const raw = $("#input-earnings").value.trim();
  const m = parseMoney(raw);
  if (!m) {
    showError("Не удалось разобрать заработок (пример: 343.55, 100)");
    return null;
  }
  return { raw: m.raw, nominal: m.nominal };
}

function onWizardNext() {
  if (wizardStep === 0) {
    const rebirth = validateRebirth();
    if (rebirth == null) return;
    updateAccount(state, { rebirth });
    setWizardStep(1);
    return;
  }
  if (wizardStep === 1) {
    const bal = validateBalance();
    if (!bal) return;
    balanceEnteredAt = Date.now();
    updateAccount(state, { balanceRaw: bal.raw, balance: bal.lower });
    setWizardStep(2);
  }
}

function onContinue() {
  const rebirth = validateRebirth();
  if (rebirth == null) {
    setWizardStep(0);
    return;
  }
  const bal = validateBalance();
  if (!bal) {
    setWizardStep(1);
    return;
  }
  const earn = validateEarnings();
  if (!earn) return;

  let balance = bal.lower;
  let elapsedSec = 0;
  if (balanceEnteredAt) {
    elapsedSec = Math.max(0, Math.floor((Date.now() - balanceEnteredAt) / 1000));
    balance += earn.nominal * elapsedSec;
  }

  sessionEarned = earn.nominal * elapsedSec;

  updateAccount(state, {
    rebirth,
    balance,
    balanceRaw: bal.raw,
    earningsPerSec: earn.nominal,
    earningsRaw: earn.raw,
    setupComplete: true,
    lastTickAt: Date.now(),
  });

  openDashboard();
}

function switchAccount(id) {
  state.activeAccountId = id;
  saveState(state);
  sessionEarned = 0;
  const acc = activeAccount();
  if (acc.setupComplete) openDashboard();
  else openWizard(true);
}

function on(id, event, handler) {
  const el = $(id);
  if (!el) {
    console.warn("missing element", id);
    return;
  }
  el.addEventListener(event, handler);
}

function init() {
  renderAccountSelect();
  const acc = activeAccount();
  if (acc.setupComplete) openDashboard();
  else openWizard(true);

  startTicker();

  on("#input-rebirth", "input", () => {
    const n = Number($("#input-rebirth").value) || 0;
    $("#hint-rebirth").textContent = describeTarget(Math.min(MAX_REBIRTH, Math.max(0, n)));
  });

  document.querySelectorAll(".wizard-next").forEach((btn) => {
    btn.addEventListener("click", onWizardNext);
  });
  document.querySelectorAll(".wizard-back").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (wizardStep > 0) setWizardStep(wizardStep - 1);
    });
  });

  on("#btn-continue", "click", onContinue);
  on("#input-earnings", "input", updateEarningsElapsedHint);

  on("#btn-apply-rebirth", "click", applyRebirthFromDashboard);
  on("#btn-apply-earnings", "click", applyEarningsFromDashboard);
  on("#btn-set-balance", "click", setBalanceFromDashboard);
  on("#btn-reset-balance", "click", resetBalanceToZero);
  on("#btn-add-sec", "click", () => adjustBalanceBySeconds(1));
  on("#btn-sub-sec", "click", () => adjustBalanceBySeconds(-1));
  on("#edit-balance-sec", "input", updateBalanceSecHint);

  accountSelect.addEventListener("change", () => {
    switchAccount(accountSelect.value);
    renderAccountSelect();
  });

  on("#btn-rename-account", "click", () => {
    const cur = activeAccount();
    const name = prompt("Новое имя аккаунта:", cur.name);
    if (name == null) return;
    if (!renameAccount(state, cur.id, name)) {
      alert("Имя не может быть пустым.");
      return;
    }
    renderAccountSelect();
  });

  on("#btn-add-account", "click", () => {
    const name = prompt("Имя аккаунта:", `Аккаунт ${state.accounts.length + 1}`);
    if (!name) return;
    addAccount(state, name.trim());
    sessionEarned = 0;
    renderAccountSelect();
    openWizard(false);
  });

  on("#btn-del-account", "click", () => {
    const cur = activeAccount();
    if (!confirm(`Удалить «${cur.name}»?`)) return;
    if (!removeAccount(state, cur.id)) {
      alert("Нужен хотя бы один аккаунт.");
      return;
    }
    sessionEarned = 0;
    renderAccountSelect();
    switchAccount(state.activeAccountId);
  });

  window.addEventListener("beforeunload", () => saveState(state));
}

init();
