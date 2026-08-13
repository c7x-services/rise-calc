import {
  describeTarget,
  remainingToRebirth,
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
  updateAccount,
} from "./storage.js";

/** @typedef {{ id: string, name: string, rebirth: number, balance: number, balanceRaw: string, earningsPerSec: number, earningsRaw: string, setupComplete: boolean, lastTickAt: number|null, sessionEarned?: number }} Account */

let state = loadState();
let wizardStep = 0;
/** @type {number|null} ms timestamp when balance step was confirmed */
let balanceEnteredAt = null;
/** seconds accrued this browser session (since setup / reset) */
let sessionEarned = 0;
let tickTimer = null;

const $ = (sel) => document.querySelector(sel);

const wizardEl = $("#wizard");
const dashboardEl = $("#dashboard");
const wizardError = $("#wizard-error");
const dashboardError = $("#dashboard-error");
const accountSelect = $("#account-select");

function showWizardError(msg) {
  wizardError.textContent = msg;
  wizardError.classList.toggle("hidden", !msg);
}

function showDashboardError(msg) {
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
  renderDashboard();
}

function computeStatus(acc) {
  const rem = remainingToRebirth(acc.rebirth, acc.balance, parseMoney);
  let eta = null;
  const ready = rem !== null && rem <= 0;
  if (rem !== null && rem > 0 && acc.earningsPerSec > 0) {
    eta = rem / acc.earningsPerSec;
  }
  return { rem, eta, ready, target: describeTarget(acc.rebirth) };
}

function renderDashboard() {
  const acc = activeAccount();
  const st = computeStatus(acc);
  $("#stat-target").textContent = st.target;
  $("#stat-balance").textContent = formatMoney(acc.balance);
  $("#stat-balance").classList.toggle("stat__value--ok", st.ready);
  $("#stat-balance-raw").textContent = acc.balanceRaw ? `HUD: ${acc.balanceRaw}` : "";
  $("#stat-remaining").textContent =
    st.rem == null ? "макс" : st.ready ? "ГОТОВО" : formatMoney(st.rem);
  $("#stat-eta").textContent =
    st.ready ? "—" : st.eta != null ? `≈ ${formatDuration(st.eta)}` : "нет заработка";
  $("#stat-earnings").textContent = acc.earningsRaw ? `+${acc.earningsRaw}/с` : "—";
  $("#stat-session").textContent = formatMoney(sessionEarned);
  $("#stat-session-detail").textContent = "только пока вкладка открыта (можно свернуть)";

  $("#edit-rebirth").value = String(acc.rebirth);
  $("#hint-edit-rebirth").textContent = describeTarget(acc.rebirth);
  $("#edit-earnings").value = acc.earningsRaw || "";
  $("#edit-balance").value = acc.balanceRaw || "";
  updateBalanceSecHint();
  showDashboardError("");
}

function updateBalanceSecHint() {
  const acc = activeAccount();
  const n = Math.max(0, Math.floor(Number($("#edit-balance-sec").value) || 0));
  const delta = acc.earningsPerSec * n;
  const el = $("#hint-balance-sec");
  if (!acc.earningsPerSec) {
    el.textContent = "Задайте заработок, чтобы считать ±N сек";
    return;
  }
  el.textContent =
    n > 0
      ? `±${formatMoney(delta)} (${formatMoney(acc.earningsPerSec)}/с × ${n} сек)`
      : "± заработок × N к балансу";
}

function applyBalancePatch(patch) {
  updateAccount(state, patch);
  renderDashboard();
}

function applyRebirthFromDashboard() {
  const n = Number($("#edit-rebirth").value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_REBIRTH) {
    showDashboardError(`Перерождение: 0–${MAX_REBIRTH}`);
    return;
  }
  applyBalancePatch({ rebirth: n });
}

function applyEarningsFromDashboard() {
  const raw = $("#edit-earnings").value.trim();
  const m = parseMoney(raw);
  if (!m) {
    showDashboardError("Не удалось разобрать заработок");
    return;
  }
  applyBalancePatch({ earningsRaw: m.raw, earningsPerSec: m.nominal });
}

function setBalanceFromDashboard() {
  const raw = $("#edit-balance").value.trim();
  const m = parseBalance(raw);
  if (!m) {
    showDashboardError("Не удалось разобрать баланс");
    return;
  }
  applyBalancePatch({ balanceRaw: m.raw, balance: m.lower });
}

function resetBalanceToZero() {
  applyBalancePatch({ balance: 0, balanceRaw: "0" });
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
  const next = Math.max(0, acc.balance + delta);
  applyBalancePatch({ balance: next });
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
    renderDashboard();
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
    return;
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
  const now = Date.now();

  updateAccount(state, {
    rebirth,
    balance,
    balanceRaw: bal.raw,
    earningsPerSec: earn.nominal,
    earningsRaw: earn.raw,
    setupComplete: true,
    lastTickAt: now,
  });

  console.info(
    `[setup] +${formatMoney(sessionEarned)} за ${formatDuration(elapsedSec)} между балансом и «Продолжить»`
  );

  openDashboard();
}

function switchAccount(id) {
  state.activeAccountId = id;
  saveState(state);
  sessionEarned = 0;
  const acc = activeAccount();
  if (acc.setupComplete) {
    openDashboard();
  } else {
    openWizard(true);
  }
}

function init() {
  renderAccountSelect();
  const acc = activeAccount();

  if (acc.setupComplete) {
    openDashboard();
  } else {
    openWizard(true);
  }

  startTicker();

  $("#input-rebirth").addEventListener("input", () => {
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

  $("#btn-continue").addEventListener("click", onContinue);
  $("#input-earnings").addEventListener("input", updateEarningsElapsedHint);

  $("#btn-apply-rebirth").addEventListener("click", applyRebirthFromDashboard);
  $("#edit-rebirth").addEventListener("input", () => {
    const n = Number($("#edit-rebirth").value) || 0;
    $("#hint-edit-rebirth").textContent = describeTarget(
      Math.min(MAX_REBIRTH, Math.max(0, n))
    );
  });
  $("#btn-apply-earnings").addEventListener("click", applyEarningsFromDashboard);
  $("#btn-set-balance").addEventListener("click", setBalanceFromDashboard);
  $("#btn-reset-balance").addEventListener("click", resetBalanceToZero);
  $("#btn-add-sec").addEventListener("click", () => adjustBalanceBySeconds(1));
  $("#btn-sub-sec").addEventListener("click", () => adjustBalanceBySeconds(-1));
  $("#edit-balance-sec").addEventListener("input", updateBalanceSecHint);
  $("#edit-earnings").addEventListener("input", updateBalanceSecHint);

  accountSelect.addEventListener("change", () => {
    switchAccount(accountSelect.value);
    renderAccountSelect();
  });

  $("#btn-add-account").addEventListener("click", () => {
    const name = prompt("Имя аккаунта:", `Аккаунт ${state.accounts.length + 1}`);
    if (!name) return;
    addAccount(state, name.trim());
    sessionEarned = 0;
    renderAccountSelect();
    openWizard(false);
  });

  $("#btn-del-account").addEventListener("click", () => {
    const acc = activeAccount();
    if (!confirm(`Удалить «${acc.name}»?`)) return;
    if (!removeAccount(state, acc.id)) {
      alert("Нужен хотя бы один аккаунт.");
      return;
    }
    sessionEarned = 0;
    renderAccountSelect();
    switchAccount(state.activeAccountId);
  });

  window.addEventListener("beforeunload", () => {
    saveState(state);
  });
}

init();
