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
import {
  loadCatalog,
  planPurchases,
  listVisibleBusinesses,
  getOwned,
  nextUpgrade,
  costBetweenLevels,
  incomeBetweenLevels,
  totalBusinessIncome,
  computeEarningsMultiplier,
  formatIncome,
  formatRoi,
  matchLocation,
} from "./businesses.js";

let state = loadState();
let wizardStep = 0;
/** @type {number|null} */
let balanceEnteredAt = null;
let sessionEarned = 0;
let tickTimer = null;
/** @type {Awaited<ReturnType<typeof loadCatalog>>|null} */
let bizCatalog = null;
let bizShowMaxed = false;
let bizChargeMoney = false;
let bizAddEarnings = false;
let bizListDirty = true;
/** @type {string} */
let bizPlanSignature = "";
let bizPlanAt = 0;
const BIZ_PLAN_MIN_MS = 8000;

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
  document.body.classList.remove("theme-ready");
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
      ? "круг заполняется по часовой"
      : st.eta != null && st.eta > ETA_RING_MAX_S
        ? "круг скрыт (>14 дн.)"
        : "";
  }
  if (!show) return;

  // Done fraction grows clockwise from 12 o'clock.
  const done = 1 - Math.min(1, Math.max(0, st.rem / st.need));
  prog.style.strokeDasharray = String(ETA_RING_C);
  prog.style.strokeDashoffset = String(ETA_RING_C * (1 - done));
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
  const multEl = $("#stat-mult");
  if (multEl) {
    const m = Number(acc.earningsMultiplier);
    if (Number.isFinite(m) && m > 0) {
      const base = bizCatalog
        ? totalBusinessIncome(bizCatalog, acc.businessLevels || {})
        : 0;
      multEl.textContent =
        base > 0
          ? `множитель ×${formatMult(m)} · база бизнесов ${formatIncome(base)}/с`
          : `множитель ×${formatMult(m)}`;
    } else {
      multEl.textContent = "множитель: — (отметь уровни бизнесов и нажми «Посчитать»)";
    }
  }
  syncAddEarningsToggle(acc);
  $("#stat-session").textContent = formatMoney(sessionEarned);
  $("#stat-session-detail").textContent = "только пока вкладка открыта (можно свернуть)";

  updateEtaRing(st);
  document.body.classList.toggle(
    "theme-ready",
    Boolean(st.ready && acc.setupComplete && !dashboardEl.classList.contains("hidden"))
  );

  if (syncInputs) {
    const rebirthEl = $("#edit-rebirth");
    const earnEl = $("#edit-earnings");
    const balEl = $("#edit-balance");
    if (!isFocused(rebirthEl)) rebirthEl.value = String(acc.rebirth);
    if (!isFocused(earnEl)) earnEl.value = acc.earningsRaw || "";
    if (!isFocused(balEl)) balEl.value = acc.balanceRaw || "";
  }

  updateBalanceSecHint();
  // Stats tick often; business plan is throttled separately.
  renderBusinessHints({
    rebuildList: syncInputs || bizListDirty,
    forcePlan: syncInputs || bizListDirty,
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMult(m) {
  if (!Number.isFinite(m)) return "—";
  if (m >= 100) return m.toFixed(0);
  if (m >= 10) return m.toFixed(1).replace(/\.0$/, "");
  return m.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatEarningsRaw(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return formatMoney(v);
  return formatIncome(v);
}

function knownMultiplier(acc = activeAccount()) {
  const m = Number(acc.earningsMultiplier);
  return Number.isFinite(m) && m > 0 ? m : null;
}

function syncAddEarningsToggle(acc = activeAccount()) {
  const cb = $("#biz-add-earnings");
  const label = $("#biz-add-earn-label");
  const ok = knownMultiplier(acc) != null;
  if (cb) {
    cb.disabled = !ok;
    if (!ok) {
      cb.checked = false;
      bizAddEarnings = false;
    } else {
      cb.checked = bizAddEarnings;
    }
  }
  if (label) {
    label.title = ok
      ? "При ±/Скуплен меняет заработок на Δдоход × множитель"
      : "Сначала посчитай множитель в блоке «Заработок»";
    label.classList.toggle("biz-check--disabled", !ok);
  }
}

function setBizOwned(name, level) {
  const acc = activeAccount();
  const biz = bizCatalog?.find((b) => b.name === name) || null;
  const from = biz ? getOwned(acc.businessLevels, biz) : Number(acc.businessLevels?.[name] || 0);
  const levels = { ...(acc.businessLevels || {}) };
  const n = Math.max(0, Math.floor(Number(level) || 0));
  const to = biz ? Math.min(biz.maxLevel, n) : n;
  if (to <= 0) delete levels[name];
  else levels[name] = to;

  const patch = { businessLevels: levels };
  if (biz && to !== from) {
    if (bizChargeMoney) {
      const cost = costBetweenLevels(biz, from, to);
      patch.balance = Math.max(0, acc.balance - cost);
    }
    const mult = knownMultiplier(acc);
    if (bizAddEarnings && mult != null) {
      const baseDelta = incomeBetweenLevels(biz, from, to);
      const nextEarn = Math.max(0, (Number(acc.earningsPerSec) || 0) + baseDelta * mult);
      patch.earningsPerSec = nextEarn;
      patch.earningsRaw = formatEarningsRaw(nextEarn);
    }
  }

  updateAccount(state, patch);
  bizListDirty = true;
  bizPlanSignature = "";
  if (patch.balance != null || patch.earningsPerSec != null) {
    renderDashboard({ syncInputs: patch.earningsPerSec != null });
  } else {
    renderBusinessHints({ rebuildList: true, forcePlan: true });
  }
}

function calcEarningsMultiplier() {
  showDashboardError("");
  if (!bizCatalog) {
    showDashboardError("Каталог бизнесов ещё не загружен");
    return;
  }
  const acc = activeAccount();
  const owned = acc.businessLevels || {};
  const base = totalBusinessIncome(bizCatalog, owned);
  if (!(base > 0)) {
    showDashboardError("Отметь уровни купленных бизнесов (−/+/Скуплен), иначе базы нет");
    return;
  }
  if (!(acc.earningsPerSec > 0)) {
    showDashboardError("Сначала задай текущий заработок /сек");
    return;
  }
  const mult = computeEarningsMultiplier(bizCatalog, owned, acc.earningsPerSec);
  if (mult == null) {
    showDashboardError("Не удалось посчитать множитель");
    return;
  }
  applyPatch({ earningsMultiplier: mult });
}

function bizControlsHtml(biz, have) {
  return `<div class="biz-row__lv">
    <button type="button" class="btn btn--ghost btn--sm biz-minus" data-name="${escapeHtml(biz.name)}" title="−1">−</button>
    <span class="biz-lv">${have}/${biz.maxLevel}</span>
    <button type="button" class="btn btn--ghost btn--sm biz-plus" data-name="${escapeHtml(biz.name)}" data-max="${biz.maxLevel}" title="+1">+</button>
    <button type="button" class="btn btn--primary btn--sm biz-bought" data-name="${escapeHtml(biz.name)}" data-max="${biz.maxLevel}" title="Отметить все уровни">Скуплен</button>
  </div>`;
}

function renderBusinessHints({ rebuildList = false, forcePlan = false } = {}) {
  const status = $("#biz-status");
  const planEl = $("#biz-plan");
  const toolbar = $("#biz-toolbar");
  const ageEl = $("#biz-plan-age");
  if (!status || !planEl) return;

  if (!bizCatalog) {
    status.textContent = "Загрузка каталога…";
    status.classList.remove("hidden");
    planEl.classList.add("hidden");
    toolbar?.classList.add("hidden");
    return;
  }

  const acc = activeAccount();
  if (!acc.setupComplete) {
    status.textContent = "Сначала заверши мастер ввода (перерождение → баланс → заработок).";
    status.classList.remove("hidden");
    planEl.classList.add("hidden");
    toolbar?.classList.add("hidden");
    return;
  }

  status.classList.add("hidden");
  toolbar?.classList.remove("hidden");
  planEl.classList.remove("hidden");

  const ownedLevels = acc.businessLevels || {};
  const now = Date.now();
  const sig = `${acc.id}|${acc.rebirth}|${Math.floor(acc.balance / 1000)}|${JSON.stringify(ownedLevels)}|${bizShowMaxed}`;
  const due =
    forcePlan ||
    rebuildList ||
    bizListDirty ||
    sig !== bizPlanSignature ||
    now - bizPlanAt >= BIZ_PLAN_MIN_MS;

  if (ageEl) {
    const ago = bizPlanAt ? Math.max(0, Math.floor((now - bizPlanAt) / 1000)) : 0;
    ageEl.textContent = bizPlanAt ? `обновлено ${ago}с назад` : "";
  }

  if (!due) return;

  const plan = planPurchases(bizCatalog, {
    rebirth: acc.rebirth,
    balance: acc.balance,
    ownedLevels,
  });
  const planRank = new Map(plan.grouped.map((g, i) => [g.biz.name, i]));
  const planByName = new Map(plan.grouped.map((g) => [g.biz.name, g]));

  bizPlanSignature = sig;
  bizPlanAt = now;
  bizListDirty = false;

  const visible = listVisibleBusinesses(bizCatalog, {
    rebirth: acc.rebirth,
    ownedLevels,
    showMaxed: bizShowMaxed,
  });

  visible.sort((a, b) => {
    const pa = planByName.get(a.name);
    const pb = planByName.get(b.name);
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    if (pa && pb) return planRank.get(a.name) - planRank.get(b.name);
    const oa = getOwned(ownedLevels, a);
    const ob = getOwned(ownedLevels, b);
    const ua = nextUpgrade(a, oa);
    const ub = nextUpgrade(b, ob);
    const ra = ua && ua.price > 0 ? ua.incomeDelta / ua.price : -1;
    const rb = ub && ub.price > 0 ? ub.incomeDelta / ub.price : -1;
    return rb - ra || a.name.localeCompare(b.name, "ru");
  });

  const rows = visible
    .map((biz) => {
      const have = getOwned(ownedLevels, biz);
      const up = nextUpgrade(biz, have);
      const loc = matchLocation(biz.location);
      const locName = loc?.name || biz.location || "—";
      const req = biz.requirement > 0 ? `R${biz.requirement}+` : "R0+";
      const g = planByName.get(biz.name);
      const rank = planRank.get(biz.name);
      let meta;
      if (g) {
        const tag =
          rank === 0
            ? `<span class="biz-tag">лучше</span>`
            : `<span class="biz-tag biz-tag--alt">#${rank + 1}</span>`;
        meta = `
          ${tag}
          <span>на баланс: Lv ${g.from}→${g.to}</span>
          <span>+${formatIncome(g.incomeDelta)}/с</span>
          <span>−${formatMoney(Math.round(g.price))}</span>
          <span class="muted">${formatRoi(g.roiAvg)}</span>`;
      } else if (have >= biz.maxLevel) {
        meta = `<span class="muted">полностью куплен · ${have}/${biz.maxLevel}</span>`;
      } else if (up) {
        meta = `
          <span class="muted">мало денег · след. ${formatMoney(Math.round(up.price))} → +${formatIncome(up.incomeDelta)}/с</span>
          <span class="muted">${formatRoi(up.incomeDelta / up.price)}</span>`;
      } else {
        meta = `<span class="muted">—</span>`;
      }

      return {
        name: biz.name,
        isBest: rank === 0,
        className: `biz-plan__item${g ? " biz-plan__item--plan" : ""}${rank === 0 ? " biz-plan__item--best" : ""}`,
        innerHtml: `
        <div class="biz-plan__top">
          <div class="biz-plan__main">
            <strong>${escapeHtml(biz.name)}</strong>
            <span class="biz-pill">${req}</span>
            <span class="muted">${escapeHtml(locName)}</span>
          </div>
          ${bizControlsHtml(biz, have)}
        </div>
        <div class="biz-plan__meta">${meta}</div>
        ${biz.coords ? `<code class="biz-coords">${escapeHtml(biz.coords)}</code>` : ""}`,
      };
    });

  const best = plan.grouped[0];
  let sum;
  if (best) {
    const bestLoc = matchLocation(best.biz.location);
    const bestLocName = bestLoc?.name || best.biz.location || "—";
    const coords = best.biz.coords
      ? ` · <code class="biz-coords">${escapeHtml(best.biz.coords)}</code>`
      : "";
    sum = `Иди в <strong>${escapeHtml(best.biz.name)}</strong>
        <span class="muted">(${escapeHtml(bestLocName)}${coords})</span>
        и скупи на баланс:
        Lv ${best.from}→${best.to} · −${formatMoney(Math.round(best.price))} ·
        +${formatIncome(best.incomeDelta)}/с
        <span class="muted"> · ROI = полный выкуп одного бизнеса, не бегай по карте</span>`;
  } else {
    sum = "На баланс нечего купить — копи или смени R";
  }

  animateBizPlanReorder(planEl, { sumHtml: sum, items: rows });

  if (ageEl) ageEl.textContent = "обновлено только что";
}

/**
 * Patch/reorder existing cards (keeps best-card shimmer alive).
 * FLIP only when position changes.
 */
function animateBizPlanReorder(planEl, { sumHtml, items }) {
  let sumEl = planEl.querySelector(".biz-plan__sum");
  let list = planEl.querySelector(".biz-plan__list");
  if (!sumEl || !list) {
    planEl.innerHTML = `<div class="biz-plan__sum"></div><ol class="biz-plan__list"></ol>`;
    sumEl = planEl.querySelector(".biz-plan__sum");
    list = planEl.querySelector(".biz-plan__list");
  }

  sumEl.innerHTML = sumHtml;

  const first = new Map();
  for (const el of list.querySelectorAll(".biz-plan__item[data-biz]")) {
    first.set(el.dataset.biz, el.getBoundingClientRect());
  }
  const scrollTop = list.scrollTop;

  const existing = new Map();
  for (const el of [...list.querySelectorAll(".biz-plan__item[data-biz]")]) {
    existing.set(el.dataset.biz, el);
  }

  const nextNames = new Set(items.map((i) => i.name));
  for (const [name, el] of existing) {
    if (!nextNames.has(name)) el.remove();
  }

  if (!items.length) {
    list.innerHTML = `<p class="muted">Нет доступных бизнесов.</p>`;
    return;
  }

  // Clear leftover empty-state message
  for (const node of [...list.children]) {
    if (!(node instanceof HTMLElement) || !node.dataset.biz) node.remove();
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const created = [];

  for (const item of items) {
    let el = existing.get(item.name);
    if (el) {
      el.className = item.className;
      // Same <li> node → ::before shimmer keeps running if still best.
      el.innerHTML = item.innerHtml;
      list.appendChild(el);
    } else {
      el = document.createElement("li");
      el.className = item.className;
      el.dataset.biz = item.name;
      el.innerHTML = item.innerHtml;
      list.appendChild(el);
      created.push(el);
    }
  }

  list.scrollTop = scrollTop;

  if (reduceMotion) return;

  for (const el of list.querySelectorAll(".biz-plan__item[data-biz]")) {
    const prev = first.get(el.dataset.biz);
    const last = el.getBoundingClientRect();
    if (prev) {
      const dy = prev.top - last.top;
      if (Math.abs(dy) < 0.5) continue;
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
        { duration: 480, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    } else if (first.size && created.includes(el)) {
      el.animate(
        [
          { opacity: 0, transform: "translateY(12px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    }
  }
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
  bizListDirty = true;
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

  loadCatalog()
    .then((cat) => {
      bizCatalog = cat;
      bizListDirty = true;
      renderBusinessHints({ rebuildList: true });
    })
    .catch((err) => {
      console.error(err);
      const status = $("#biz-status");
      if (status) {
        status.classList.remove("hidden");
        status.textContent = "Не удалось загрузить businesses.json";
      }
    });

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
  on("#btn-calc-mult", "click", calcEarningsMultiplier);
  on("#btn-set-balance", "click", setBalanceFromDashboard);
  on("#btn-reset-balance", "click", resetBalanceToZero);
  on("#btn-add-sec", "click", () => adjustBalanceBySeconds(1));
  on("#btn-sub-sec", "click", () => adjustBalanceBySeconds(-1));
  on("#edit-balance-sec", "input", updateBalanceSecHint);

  function onEnter(sel, fn) {
    on(sel, "keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      fn();
    });
  }
  onEnter("#input-rebirth", onWizardNext);
  onEnter("#input-balance", onWizardNext);
  onEnter("#input-earnings", onContinue);
  onEnter("#edit-rebirth", applyRebirthFromDashboard);
  onEnter("#edit-earnings", applyEarningsFromDashboard);
  onEnter("#edit-balance", setBalanceFromDashboard);
  onEnter("#edit-balance-sec", () => adjustBalanceBySeconds(1));

  on("#biz-show-maxed", "change", (e) => {
    bizShowMaxed = Boolean(e.target.checked);
    bizListDirty = true;
    renderBusinessHints({ rebuildList: true, forcePlan: true });
  });

  on("#biz-charge-money", "change", (e) => {
    bizChargeMoney = Boolean(e.target.checked);
  });

  on("#biz-add-earnings", "change", (e) => {
    if (!knownMultiplier()) {
      e.target.checked = false;
      bizAddEarnings = false;
      showDashboardError("Сначала посчитай множитель в блоке «Заработок»");
      return;
    }
    bizAddEarnings = Boolean(e.target.checked);
    showDashboardError("");
  });

  $("#hints-panel")?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const name = t.dataset.name;
    if (!name) return;
    const acc = activeAccount();
    const have = Number(acc.businessLevels?.[name] || 0);
    if (t.classList.contains("biz-minus")) {
      setBizOwned(name, have - 1);
    } else if (t.classList.contains("biz-plus")) {
      const max = Number(t.dataset.max || 99);
      setBizOwned(name, Math.min(max, have + 1));
    } else if (t.classList.contains("biz-bought")) {
      const max = Number(t.dataset.max || 99);
      setBizOwned(name, max);
    }
  });

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
