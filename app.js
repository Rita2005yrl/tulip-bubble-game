import {
  COLOR_IDS,
  PRICE_LEVEL_NAMES,
  PRICE_TABLE,
  findCollectorSets,
  getMarketPrice,
} from "./rules.js";

const COLORS = {
  red: { name: "红色", short: "红" },
  yellow: { name: "黄色", short: "黄" },
  white: { name: "白色", short: "白" },
};

const PHASE_LABELS = {
  lobby: "等待玩家",
  event: "市场事件",
  sell: "出售阶段",
  "queen-check": "夜后购买",
  bid: "购买/拍卖",
  resolve: "购买/拍卖",
  supply: "供需调价",
  cleanup: "清理阶段",
  finished: "游戏结束",
};

const VARIETY_NAMES = {
  A: "名品 A",
  B1: "良种 B1",
  B2: "良种 B2",
  C1: "常种 C1",
  C2: "常种 C2",
  C3: "常种 C3",
};

const ART_VARIANTS = {
  A: { position: "0% 0%" },
  B1: { position: "50% 0%" },
  B2: { position: "100% 0%" },
  C1: { position: "0% 100%" },
  C2: { position: "50% 100%" },
  C3: { position: "100% 100%" },
};

const COLLECTOR_SPRITES = {
  noble: "0% 0%",
  housekeeper: "33.333% 0%",
  clergyman: "66.667% 0%",
  scholar: "100% 0%",
  madame: "0% 100%",
  "young-man": "33.333% 100%",
  "fair-lady": "66.667% 100%",
  "tavern-owner": "100% 100%",
};

const ids = [
  "setup-screen", "entry-panel", "lobby-panel", "online-form", "create-mode", "join-mode", "player-name",
  "player-count", "room-size-field", "room-code-field", "room-code", "online-submit", "entry-error",
  "lobby-room-code", "copy-room-link", "lobby-count", "lobby-players", "start-player-field", "start-player",
  "start-game", "lobby-wait", "connection-status", "tabletop", "round-label", "phase-label", "event-title",
  "event-symbol", "event-text", "market-deck-count", "price-tracks", "collectors", "market-lanes", "active-player",
  "incoming-row", "stock-row", "sold-row", "action-kicker", "action-title", "action-text", "pass-button",
  "next-button", "bid-entry", "bid-amount", "buy-queen", "players", "game-log", "rules-button", "reset-game",
  "rules-dialog", "close-rules", "choice-dialog", "choice-kicker", "choice-title", "choice-text", "choice-actions",
  "table-toast", "room-ribbon", "table-room-code", "copy-table-link", "phase-timeline", "supply-explainer",
];
const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

let state = null;
let session = null;
let mode = "create";
let pollTimer = null;
let requestPending = false;
let toastTimer = null;
let choiceKey = "";
let activeMarketTransition = null;
let marketTransitionSerial = 0;
let activeSaleTransition = null;
let saleTransitionSerial = 0;
let activePurchaseTransition = null;
let purchaseTransitionSerial = 0;
let activePriceTransition = null;
let priceTransitionSerial = 0;
let activeSupplySettlement = null;
let supplySettlementSerial = 0;
let settledSupplyRevision = null;
let pendingSupplySettlementRevision = null;
let activeMarketEventReveal = null;
let marketEventRevealSerial = 0;
let pendingMarketEventPresentation = null;
let activeAuctionFeedback = null;
let auctionFeedbackSerial = 0;
let pendingAuctionCompletion = null;
const expandedLedgers = new Set();

const MARKET_TRANSFER_DURATION = 700;
const INCOMING_REVEAL_STAGGER = 100;
const INCOMING_REVEAL_DURATION = 420;
const SALE_TRANSFER_DURATION = 700;
const PURCHASE_TRANSFER_DURATION = 700;
const CASH_COUNT_DURATION = 420;
const PRICE_LEVEL_DURATION = 300;
const PRICE_COLOR_STAGGER = 100;
const SUPPLY_COUNT_DURATION = 360;
const SUPPLY_PANEL_FADE_DURATION = 220;
const SUPPLY_BALANCE_HOLD = 700;
const EVENT_REVEAL_ENTRANCE_DURATION = 250;
const EVENT_REVEAL_FLIP_DURATION = 600;
const EVENT_REVEAL_HOLD_DURATION = 800;
const EVENT_REVEAL_EXIT_DURATION = 250;
const AUCTION_BID_PULSE_DURATION = 240;
const AUCTION_GAVEL_DURATION = 640;

function money(value) {
  return `ƒ${value}`;
}

function loadSession() {
  try {
    const stored = JSON.parse(localStorage.getItem("tulip-online-session") ?? "null");
    return stored?.roomCode && stored?.token ? stored : null;
  } catch {
    return null;
  }
}

function saveSession(next) {
  if (session?.roomCode !== next?.roomCode) {
    settledSupplyRevision = null;
    pendingSupplySettlementRevision = null;
    pendingMarketEventPresentation = null;
    pendingAuctionCompletion = null;
  }
  session = next;
  if (next) localStorage.setItem("tulip-online-session", JSON.stringify(next));
  else localStorage.removeItem("tulip-online-session");
}

function setConnection(status, label) {
  els["connection-status"].className = `connection-status ${status}`;
  els["connection-status"].querySelector("b").textContent = label;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els["table-toast"].textContent = message;
  els["table-toast"].classList.add("visible");
  toastTimer = window.setTimeout(() => els["table-toast"].classList.remove("visible"), 2300);
}

function showEntryError(message = "") {
  els["entry-error"].textContent = message;
  els["entry-error"].classList.toggle("hidden", !message);
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  if (session?.token) headers.authorization = `Bearer ${session.token}`;
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "联机服务暂时不可用");
  return data;
}

function setMode(nextMode) {
  mode = nextMode;
  const joining = mode === "join";
  els["create-mode"].classList.toggle("active", !joining);
  els["join-mode"].classList.toggle("active", joining);
  els["create-mode"].setAttribute("aria-selected", String(!joining));
  els["join-mode"].setAttribute("aria-selected", String(joining));
  els["room-size-field"].classList.toggle("hidden", joining);
  els["room-code-field"].classList.toggle("hidden", !joining);
  els["room-code"].required = joining;
  els["online-submit"].textContent = joining ? "加入联机房间" : "创建联机房间";
  showEntryError();
}

function invitationUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", session.roomCode);
  return url.toString();
}

async function copyInvitation() {
  try {
    await navigator.clipboard.writeText(invitationUrl());
    showToast("邀请链接已复制");
  } catch {
    showToast(`房间码：${session.roomCode}`);
  }
}

async function createOrJoin(event) {
  event.preventDefault();
  if (requestPending) return;
  requestPending = true;
  showEntryError();
  els["online-submit"].disabled = true;
  const name = els["player-name"].value.trim();
  try {
    const result = mode === "create"
      ? await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ name, maxPlayers: Number(els["player-count"].value) }),
      })
      : await api(`/api/rooms/${els["room-code"].value.trim().toUpperCase()}/join`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    saveSession({ roomCode: result.roomCode, playerId: result.playerId, token: result.token });
    state = result.state;
    history.replaceState({}, "", `${location.pathname}?room=${result.roomCode}`);
    render();
    schedulePoll(250);
  } catch (error) {
    showEntryError(error.message);
  } finally {
    requestPending = false;
    els["online-submit"].disabled = false;
  }
}

async function pollState() {
  if (!session || requestPending) return schedulePoll(850);
  try {
    const previousState = state;
    const result = await api(`/api/rooms/${session.roomCode}`);
    const changed = !state || result.state.revision !== state.revision;
    const eventPresentation = changed
      ? captureMarketEventPresentation(previousState, result.state)
      : null;
    const purchasePresentation = changed
      ? capturePurchasePresentation(previousState, result.state)
      : null;
    const auctionPresentation = changed
      ? captureAuctionPresentation(previousState, result.state)
      : null;
    const pricePresentations = changed
      ? capturePricePresentations(previousState, result.state)
      : [];
    const supplyPresentation = changed
      ? captureSupplySettlement(previousState, result.state)
      : null;
    if (auctionPresentation?.type === "completed") pendingAuctionCompletion = auctionPresentation;
    if (purchasePresentation) expandedLedgers.add(purchasePresentation.buyerId);
    state = result.state;
    setConnection("online", "已同步");
    if (changed) {
      render();
      if (auctionPresentation) animateAuctionFeedback(auctionPresentation, purchasePresentation);
      else if (purchasePresentation) animateSuccessfulPurchase(purchasePresentation);
      if (eventPresentation) animateMarketEventReveal(eventPresentation, pricePresentations);
      else if (supplyPresentation) animateSupplySettlement(supplyPresentation, pricePresentations);
      else if (pricePresentations.length) animatePriceChanges(pricePresentations);
    }
  } catch (error) {
    setConnection("offline", "正在重连");
    if (/凭证无效|不存在|过期/.test(error.message)) {
      saveSession(null);
      state = null;
      showEntryError(error.message);
      renderEntry();
      return;
    }
  }
  schedulePoll(document.hidden ? 2500 : 850);
}

function schedulePoll(delay = 850) {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(pollState, delay);
}

async function sendAction(type, payload = {}) {
  if (!session || requestPending) return;
  const salePresentation = captureSalePresentation(type, payload);
  const previousState = state;
  requestPending = true;
  closeChoice();
  setConnection("syncing", "提交中");
  try {
    const result = await api(`/api/rooms/${session.roomCode}/actions`, {
      method: "POST",
      body: JSON.stringify({ type, payload }),
    });
    const eventPresentation = captureMarketEventPresentation(previousState, result.state);
    const purchasePresentation = capturePurchasePresentation(previousState, result.state);
    const auctionPresentation = captureAuctionPresentation(previousState, result.state);
    const pricePresentations = capturePricePresentations(previousState, result.state);
    const supplyPresentation = captureSupplySettlement(previousState, result.state);
    if (auctionPresentation?.type === "completed") pendingAuctionCompletion = auctionPresentation;
    if (purchasePresentation) expandedLedgers.add(purchasePresentation.buyerId);
    state = result.state;
    setConnection("online", "已同步");
    render();
    if (salePresentation) animateSuccessfulSale(salePresentation);
    if (auctionPresentation) animateAuctionFeedback(auctionPresentation, purchasePresentation);
    else if (purchasePresentation) animateSuccessfulPurchase(purchasePresentation);
    if (eventPresentation) animateMarketEventReveal(eventPresentation, pricePresentations);
    else if (supplyPresentation) animateSupplySettlement(supplyPresentation, pricePresentations);
    else if (pricePresentations.length) animatePriceChanges(pricePresentations);
  } catch (error) {
    showToast(error.message);
    render();
  } finally {
    requestPending = false;
    schedulePoll(500);
  }
}

function viewer() {
  return state?.players?.[state.viewerId] ?? null;
}

function playerName(playerId) {
  return state?.players?.[playerId]?.name ?? `玩家 ${playerId + 1}`;
}

function isMyTurn() {
  return state?.activePlayer === state?.viewerId;
}

function allMarketCards() {
  return [...(state.incoming ?? []), ...(state.stock ?? []), ...(state.sold ?? [])];
}

function placedMarkerCount(playerId) {
  return allMarketCards().reduce((total, card) => total + card.bids.filter((id) => id === playerId).length, 0);
}

function availableMarkerCount(playerId) {
  const player = state.players[playerId];
  return Math.max(0, 3 - player.financed.length - placedMarkerCount(playerId));
}

function renderEntry() {
  els["setup-screen"].classList.remove("hidden");
  els.tabletop.classList.add("hidden");
  els["entry-panel"].classList.remove("hidden");
  els["lobby-panel"].classList.add("hidden");
  els["room-ribbon"].classList.add("hidden");
  els["reset-game"].classList.add("hidden");
  setConnection("", "未连接");
}

function renderLobby() {
  els["setup-screen"].classList.remove("hidden");
  els.tabletop.classList.add("hidden");
  els["entry-panel"].classList.add("hidden");
  els["lobby-panel"].classList.remove("hidden");
  els["room-ribbon"].classList.add("hidden");
  els["reset-game"].classList.remove("hidden");
  els["lobby-room-code"].textContent = session.roomCode;
  els["lobby-count"].textContent = `${state.players.length} / ${state.maxPlayers} 位`;
  els["lobby-players"].innerHTML = Array.from({ length: state.maxPlayers }, (_, index) => {
    const player = state.players[index];
    if (!player) return `<div class="lobby-player"><i style="--player-color:#45564f">?</i><span>等待商人加入</span><small>空位</small></div>`;
    return `<div class="lobby-player"><i style="--player-color:${player.color}">${index + 1}</i><span>${escapeHtml(player.name)}</span><small>${index === 0 ? "房主" : index === state.viewerId ? "你" : "已入场"}</small></div>`;
  }).join("");
  const host = state.viewerId === 0;
  els["start-player-field"].classList.toggle("hidden", !host);
  els["start-game"].classList.toggle("hidden", !host);
  els["lobby-wait"].classList.toggle("hidden", host);
  const selectedStartPlayer = els["start-player"].value;
  els["start-player"].innerHTML = state.players.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("");
  if (state.players.some((player) => String(player.id) === selectedStartPlayer)) {
    els["start-player"].value = selectedStartPlayer;
  }
  els["start-game"].disabled = state.players.length < 3;
  els["start-game"].textContent = state.players.length < 3 ? "至少 3 人才能开市" : `以 ${state.players.length} 人阵容开市`;
}

function markerMarkupFor(playerId, extraClass = "") {
  const player = state.players[playerId];
  return `<span class="purchase-marker marker-${player.shape} ${extraClass}" style="--marker-color:${player.color}" title="${escapeHtml(player.name)}的购买标记"><i>${playerId + 1}</i></span>`;
}

function cardMarkup(card, lane) {
  const marketPrice = getMarketPrice(card, state.prices);
  const canMark = state.phase === "bid" && isMyTurn() && lane === "stock"
    && !card.bids.includes(state.viewerId) && availableMarkerCount(state.viewerId) > 0
    && state.placementsThisTurn < (state.bidPass === 1 ? 2 : 1);
  const isAuctionLot = lane === "stock" && String(state.auction?.cardId) === String(card.id);
  const isAuctionPurchase = lane === "stock" && state.currentPurchase?.participants?.length > 1
    && String(state.currentPurchase.cardId) === String(card.id);
  const art = ART_VARIANTS[card.variety];
  const markers = card.bids.map((playerId) => markerMarkupFor(playerId, "marker-on-card")).join("");
  const laneHint = lane === "incoming" ? "即将进货，本轮不可购买" : lane === "sold" ? "本轮售出，仅参与供需统计" : "市场现货，可放置购买标记";
  return `<article class="tulip-card ${card.color} lane-${lane} ${canMark ? "interactive" : ""} ${isAuctionLot ? "auction-lot" : ""} ${isAuctionPurchase ? "auction-lot-settling" : ""}" data-card-id="${card.id}" data-lane="${lane}" title="${COLORS[card.color].name} ${card.variety} · ${money(marketPrice)} · ${laneHint}" aria-label="${COLORS[card.color].name}${card.variety}，市价${marketPrice}，${isAuctionLot ? "正在公开竞拍" : laneHint}">
    <div class="tulip-art" style="--art-position:${art.position}"><span class="variety-ribbon">${card.variety}</span></div>
    <div class="tulip-meta"><div><strong>${COLORS[card.color].name}郁金香</strong><small>${VARIETY_NAMES[card.variety]} · 市价 ${money(marketPrice)}</small></div><span class="grade-badge">${card.rank}</span></div>
    <div class="bid-tokens">${markers}</div>
  </article>`;
}

function renderMarketRow(element, cards, lane) {
  element.innerHTML = cards.length ? cards.map((card) => cardMarkup(card, lane)).join("") : `<p class="empty-lane">此区域暂无郁金香</p>`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function gameEasing() {
  return getComputedStyle(document.documentElement).getPropertyValue("--ease-game").trim()
    || "cubic-bezier(0.22, 1, 0.36, 1)";
}

function cardHasLayout(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function finishMarketEventReveal() {
  if (!activeMarketEventReveal) return;
  marketEventRevealSerial += 1;
  activeMarketEventReveal.timers.forEach((entry) => {
    window.clearTimeout(entry.id);
    entry.resolve(false);
  });
  activeMarketEventReveal.layer?.remove();
  els.tabletop.classList.remove("event-reveal-active");
  els["price-tracks"].querySelectorAll(".event-price-pending").forEach((marker) => {
    marker.classList.remove("event-price-pending");
  });
  pendingMarketEventPresentation = null;
  activeMarketEventReveal = null;
}

function captureMarketEventPresentation(previousState, nextState) {
  finishMarketEventReveal();
  pendingMarketEventPresentation = null;
  if (!nextState?.started || !nextState.currentEvent || prefersReducedMotion()) return null;
  const previousEventId = previousState?.currentEvent?.id;
  const eventChanged = !previousState?.started
    || previousState.round !== nextState.round
    || previousEventId !== nextState.currentEvent.id;
  if (!eventChanged) return null;
  const presentation = {
    event: { ...nextState.currentEvent },
    description: getEventDescription(nextState.currentEvent),
    incomingTransfer: null,
    round: nextState.round,
  };
  pendingMarketEventPresentation = presentation;
  return presentation;
}

function waitForMarketEventReveal(duration, transition) {
  return new Promise((resolve) => {
    const entry = { id: null, resolve };
    entry.id = window.setTimeout(() => {
      transition.timers = transition.timers.filter((item) => item !== entry);
      resolve(activeMarketEventReveal === transition);
    }, duration);
    transition.timers.push(entry);
  });
}

function marketEventRevealMarkup(snapshot) {
  const eventClass = snapshot.event.type === "burst" ? "event-burst" : `event-${snapshot.event.type}`;
  return `<div class="market-event-reveal-layer" role="status" aria-live="polite" aria-label="第 ${snapshot.round} 轮市场事件">
    <div class="market-event-card-scene">
      <article class="market-event-reveal-card ${eventClass}">
        <section class="market-event-card-face market-event-card-back">
          <div class="market-event-back-crest" aria-hidden="true"><i></i><span>郁</span><i></i></div>
          <p>阿姆斯特丹 · 1636</p>
          <strong>市场事件</strong>
          <small>花市交易所密封公报</small>
        </section>
        <section class="market-event-card-face market-event-card-front" aria-hidden="true">
          <div class="market-event-front-ornament" aria-hidden="true"><i></i><span>第 ${snapshot.round} 轮</span><i></i></div>
          <p class="overline">市场事件</p>
          <div class="market-event-reveal-heading"><h2>${escapeHtml(snapshot.event.title)}</h2><span>${escapeHtml(snapshot.event.symbol)}</span></div>
          <p class="market-event-reveal-description">${escapeHtml(snapshot.description)}</p>
          <div class="market-event-reveal-seal" aria-hidden="true">市</div>
        </section>
      </article>
    </div>
  </div>`;
}

function deferEventPriceTargets(pricePresentations) {
  pricePresentations.forEach(({ change }) => {
    els["price-tracks"].querySelector(`.price-tulip.${change.color}`)?.classList.add("event-price-pending");
  });
}

async function animateMarketEventReveal(snapshot, pricePresentations) {
  if (!snapshot || prefersReducedMotion()) return;
  pendingMarketEventPresentation = null;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = marketEventRevealMarkup(snapshot);
  const layer = wrapper.firstElementChild;
  const card = layer.querySelector(".market-event-reveal-card");
  const front = layer.querySelector(".market-event-card-front");
  const back = layer.querySelector(".market-event-card-back");
  const title = layer.querySelector(".market-event-reveal-heading h2");
  const token = ++marketEventRevealSerial;
  const transition = { layer, timers: [] };
  activeMarketEventReveal = transition;
  deferEventPriceTargets(pricePresentations);
  els.tabletop.classList.add("event-reveal-active");
  document.body.append(layer);

  if (!await waitForMarketEventReveal(EVENT_REVEAL_ENTRANCE_DURATION, transition)) return;
  card.classList.add("event-card-flipped");
  if (!await waitForMarketEventReveal(EVENT_REVEAL_FLIP_DURATION, transition)) return;
  back.setAttribute("aria-hidden", "true");
  front.setAttribute("aria-hidden", "false");
  title.classList.add("event-title-emphasis");
  if (!await waitForMarketEventReveal(EVENT_REVEAL_HOLD_DURATION, transition)) return;
  if (activeMarketEventReveal !== transition || marketEventRevealSerial !== token) return;

  els["price-tracks"].querySelectorAll(".event-price-pending").forEach((marker) => {
    marker.classList.remove("event-price-pending");
  });
  if (pricePresentations.length) animatePriceChanges(pricePresentations);
  if (snapshot.incomingTransfer) animateIncomingTransfer(snapshot.incomingTransfer);
  layer.classList.add("market-event-reveal-leaving");
  if (!await waitForMarketEventReveal(EVENT_REVEAL_EXIT_DURATION, transition)) return;
  if (activeMarketEventReveal !== transition || marketEventRevealSerial !== token) return;
  layer.remove();
  els.tabletop.classList.remove("event-reveal-active");
  activeMarketEventReveal = null;
}

function captureSalePresentation(type, payload) {
  if (type !== "sell-card" || prefersReducedMotion()) return null;
  const seller = viewer();
  const card = seller?.hand.find((item) => item?.id === payload.cardId);
  const source = [...els.players.querySelectorAll("[data-hand-card]")]
    .find((element) => element.dataset.handCard === String(payload.cardId));
  if (!card || !source || !cardHasLayout(source)) return null;

  source.classList.add("sale-source-selected");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = cardMarkup({ ...card, bids: [] }, "sold");
  const clone = wrapper.firstElementChild;
  clone.setAttribute("aria-hidden", "true");
  return {
    cardId: String(card.id),
    clone,
    oldCash: Number(seller.cash),
    sellerId: seller.id,
    sourceRect: source.getBoundingClientRect(),
  };
}

function finishSaleTransition() {
  saleTransitionSerial += 1;
  if (!activeSaleTransition) return;
  activeSaleTransition.animations.forEach((animation) => animation.cancel());
  activeSaleTransition.timers.forEach((timer) => window.clearTimeout(timer));
  if (activeSaleTransition.cashFrame) window.cancelAnimationFrame(activeSaleTransition.cashFrame);
  activeSaleTransition.layer?.remove();
  activeSaleTransition.income?.remove();
  activeSaleTransition.cashElement?.classList.remove("cash-value-changing");
  els["market-lanes"].classList.remove("transaction-transition-active");
  els["sold-row"].querySelectorAll(".sale-transition-target").forEach((card) => card.classList.remove("sale-transition-target"));
  const seller = state?.players?.[activeSaleTransition.sellerId];
  if (seller && activeSaleTransition.cashElement) activeSaleTransition.cashElement.textContent = money(seller.cash);
  activeSaleTransition = null;
}

function transactionIsActive(transition) {
  return activeSaleTransition === transition || activePurchaseTransition === transition;
}

function animateCashValue(element, from, to, transition) {
  if (!element || !Number.isFinite(from) || !Number.isFinite(to)) return;
  if (prefersReducedMotion() || from === to) {
    element.textContent = money(to);
    return;
  }
  const startedAt = performance.now();
  element.textContent = money(from);
  element.classList.add("cash-value-changing");
  const update = (now) => {
    if (!transactionIsActive(transition)) return;
    const progress = Math.min(1, (now - startedAt) / CASH_COUNT_DURATION);
    const eased = 1 - ((1 - progress) ** 3);
    element.textContent = money(Math.round(from + (to - from) * eased));
    if (progress < 1) transition.cashFrame = window.requestAnimationFrame(update);
    else {
      element.textContent = money(to);
      element.classList.remove("cash-value-changing");
      transition.cashFrame = null;
    }
  };
  transition.cashFrame = window.requestAnimationFrame(update);
}

function completeSalePresentation(transition) {
  if (activeSaleTransition !== transition) return;
  transition.income?.remove();
  transition.cashElement?.classList.remove("cash-value-changing");
  const seller = state?.players?.[transition.sellerId];
  if (seller && transition.cashElement) transition.cashElement.textContent = money(seller.cash);
  els["market-lanes"].classList.remove("transaction-transition-active");
  activeSaleTransition = null;
}

function animateSaleIncome(targetRect, cashElement, amount, transition) {
  if (!cashElement || amount <= 0) {
    transition.timers.push(window.setTimeout(() => completeSalePresentation(transition), CASH_COUNT_DURATION));
    return;
  }
  const cashRect = cashElement.getBoundingClientRect();
  const startX = targetRect.left + (targetRect.width / 2);
  const startY = targetRect.top + Math.min(46, targetRect.height * 0.3);
  const deltaX = cashRect.left + (cashRect.width / 2) - startX;
  const deltaY = cashRect.top + (cashRect.height / 2) - startY;
  const income = document.createElement("span");
  income.className = "floating-number transaction-income";
  income.textContent = `+${money(amount)}`;
  income.setAttribute("aria-hidden", "true");
  income.style.left = `${startX}px`;
  income.style.top = `${startY}px`;
  document.body.append(income);
  transition.income = income;
  const incomeAnimation = income.animate([
    { transform: "translate(-50%, 6px) scale(0.96)", opacity: 0, offset: 0 },
    { transform: "translate(-50%, 0) scale(1)", opacity: 1, offset: 0.18 },
    { transform: `translate(calc(-50% + ${deltaX * 0.78}px), ${deltaY * 0.78}px) scale(0.98)`, opacity: 0.86, offset: 0.72 },
    { transform: `translate(calc(-50% + ${deltaX}px), ${deltaY}px) scale(0.94)`, opacity: 0, offset: 1 },
  ], { duration: SALE_TRANSFER_DURATION, easing: gameEasing(), fill: "forwards" });
  transition.animations.push(incomeAnimation);
  incomeAnimation.finished.then(() => completeSalePresentation(transition)).catch(() => {});
}

function animateSuccessfulSale(snapshot) {
  const target = [...els["sold-row"].querySelectorAll(".tulip-card[data-card-id]")]
    .find((card) => card.dataset.cardId === snapshot.cardId);
  const seller = state.players[snapshot.sellerId];
  const cashElement = els.players.querySelector(`[data-cash-player="${snapshot.sellerId}"]`);
  if (!target || !seller || !cardHasLayout(target)) return;

  const token = ++saleTransitionSerial;
  const targetRect = target.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "transaction-transfer-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const transition = {
    token,
    sellerId: snapshot.sellerId,
    layer,
    income: null,
    animations: [],
    timers: [],
    cashFrame: null,
    cashElement,
  };
  activeSaleTransition = transition;
  if (cashElement) cashElement.textContent = money(snapshot.oldCash);
  els["market-lanes"].classList.add("transaction-transition-active");
  target.classList.add("sale-transition-target");

  const clone = snapshot.clone;
  clone.classList.remove("interactive");
  clone.classList.add("sale-transfer-clone");
  Object.assign(clone.style, {
    left: `${targetRect.left}px`,
    top: `${targetRect.top}px`,
    width: `${targetRect.width}px`,
    height: `${targetRect.height}px`,
  });
  layer.append(clone);
  const deltaX = snapshot.sourceRect.left - targetRect.left;
  const deltaY = snapshot.sourceRect.top - targetRect.top;
  const scaleX = snapshot.sourceRect.width / targetRect.width;
  const scaleY = snapshot.sourceRect.height / targetRect.height;
  const flight = clone.animate([
    { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`, offset: 0 },
    { transform: `translate3d(${deltaX}px, ${deltaY - 7}px, 0) scale(${scaleX * 1.02}, ${scaleY * 1.02})`, offset: 0.18 },
    { transform: "translate3d(0, 0, 0) scale(1)", offset: 0.88 },
    { transform: "translate3d(0, 2px, 0) scale(1.005)", offset: 0.95 },
    { transform: "translate3d(0, 0, 0) scale(1)", offset: 1 },
  ], { duration: SALE_TRANSFER_DURATION, easing: gameEasing(), fill: "forwards" });
  transition.animations.push(flight);
  flight.finished.then(() => {
    if (activeSaleTransition !== transition || saleTransitionSerial !== token) return;
    target.classList.remove("sale-transition-target");
    target.classList.add("anim-gold-highlight");
    layer.remove();
    const newCash = Number(seller.cash);
    const income = newCash - snapshot.oldCash;
    animateCashValue(cashElement, snapshot.oldCash, newCash, transition);
    animateSaleIncome(targetRect, cashElement, income, transition);
  }).catch(() => {});
}

function purchasePriceFromState(previousState, nextState, buyer, card, method, loan) {
  if (method === "finance" && Number.isFinite(Number(loan?.debt))) return Number(loan.debt);
  if (previousState.currentPurchase?.cardId === card.id && Number.isFinite(Number(previousState.currentPurchase.price))) {
    return Number(previousState.currentPurchase.price);
  }
  const oldCash = previousState.players[buyer.id]?.cash;
  const newCash = nextState.players[buyer.id]?.cash;
  if (typeof oldCash === "number" && typeof newCash === "number" && oldCash > newCash) return oldCash - newCash;
  const escapedName = buyer.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const paymentPattern = method === "finance"
    ? new RegExp(`^${escapedName}以 ƒ(\\d+) 全额融资`)
    : new RegExp(`^${escapedName}支付 ƒ(\\d+)`);
  const entry = nextState.log.find((message) => paymentPattern.test(message));
  return entry ? Number(entry.match(paymentPattern)?.[1]) : null;
}

function capturePurchasePresentation(previousState, nextState) {
  if (!previousState?.started || !nextState?.started || prefersReducedMotion()) return null;
  const previousStock = new Map((previousState.stock ?? []).map((card) => [String(card.id), card]));
  if (!previousStock.size) return null;
  const candidates = [];

  nextState.players.forEach((buyer) => {
    const previousBuyer = previousState.players[buyer.id];
    if (!previousBuyer) return;
    const previousHandIds = new Set(previousBuyer.hand.filter(Boolean).map((card) => String(card.id)));
    const previousLoanIds = new Set(previousBuyer.financed.map((loan) => String(loan.card.id)));
    buyer.hand.filter(Boolean).forEach((card) => {
      if (!previousHandIds.has(String(card.id)) && previousStock.has(String(card.id))) {
        candidates.push({ buyer, card, method: "cash", loan: null });
      }
    });
    buyer.financed.forEach((loan) => {
      if (!previousLoanIds.has(String(loan.card.id)) && previousStock.has(String(loan.card.id))) {
        candidates.push({ buyer, card: loan.card, method: "finance", loan });
      }
    });
  });

  if (!candidates.length) return null;
  const pendingId = String(previousState.currentPurchase?.cardId ?? "");
  const candidate = candidates.find(({ card }) => String(card.id) === pendingId) ?? candidates[0];
  const cardId = String(candidate.card.id);
  const source = [...els["stock-row"].querySelectorAll(".tulip-card[data-card-id]")]
    .find((element) => element.dataset.cardId === cardId);
  if (!source || !cardHasLayout(source)) return null;
  source.classList.add("purchase-source-selected");
  const remainingRects = new Map(
    [...els["stock-row"].querySelectorAll(".tulip-card[data-card-id]")]
      .filter((element) => element.dataset.cardId !== cardId && cardHasLayout(element))
      .map((element) => [element.dataset.cardId, element.getBoundingClientRect()]),
  );
  const previousBuyer = previousState.players[candidate.buyer.id];
  return {
    buyerId: candidate.buyer.id,
    cardId,
    clone: source.cloneNode(true),
    method: candidate.method,
    oldCash: typeof previousBuyer.cash === "number" ? previousBuyer.cash : null,
    newCash: typeof candidate.buyer.cash === "number" ? candidate.buyer.cash : null,
    payment: purchasePriceFromState(previousState, nextState, candidate.buyer, candidate.card, candidate.method, candidate.loan),
    remainingRects,
    sourceRect: source.getBoundingClientRect(),
  };
}

function auctionCardRect(cardId) {
  const card = [...els["stock-row"].querySelectorAll(".tulip-card[data-card-id]")]
    .find((element) => element.dataset.cardId === String(cardId));
  return card && cardHasLayout(card) ? card.getBoundingClientRect() : null;
}

function captureAuctionPresentation(previousState, nextState) {
  if (!previousState?.started || !nextState?.started || prefersReducedMotion()) return null;
  const previousAuction = previousState.auction;
  if (!previousAuction) return null;

  const nextAuction = nextState.auction;
  if (nextAuction && String(nextAuction.cardId) === String(previousAuction.cardId)) {
    if (nextAuction.currentBid === previousAuction.currentBid && nextAuction.leader === previousAuction.leader) return null;
    return {
      type: "bid",
      revision: nextState.revision,
      cardId: String(nextAuction.cardId),
      oldBid: previousAuction.currentBid,
      newBid: nextAuction.currentBid,
      leaderId: nextAuction.leader,
    };
  }

  const purchase = nextState.currentPurchase;
  const purchasedOwner = nextState.players.find((player) => (
    player.hand.some((card) => String(card?.id) === String(previousAuction.cardId))
      || player.financed.some((loan) => String(loan.card.id) === String(previousAuction.cardId))
  ));
  if ((!purchase || String(purchase.cardId) !== String(previousAuction.cardId)) && !purchasedOwner) return null;
  return {
    type: "completed",
    revision: nextState.revision,
    cardId: String(previousAuction.cardId),
    winnerId: purchase?.winnerId ?? purchasedOwner.id,
    price: purchase?.price ?? previousAuction.currentBid,
    sourceRect: auctionCardRect(previousAuction.cardId),
  };
}

function finishAuctionFeedback({ preservePending = false } = {}) {
  auctionFeedbackSerial += 1;
  if (activeAuctionFeedback) {
    activeAuctionFeedback.timers.forEach((timer) => window.clearTimeout(timer));
    activeAuctionFeedback.cue?.remove();
    activeAuctionFeedback.bidElement?.classList.remove("auction-bid-changing");
    activeAuctionFeedback.leaderElement?.classList.remove("auction-leader-changed");
    activeAuctionFeedback.cardElement?.classList.remove("auction-complete-card");
    activeAuctionFeedback.dockElement?.classList.remove("auction-complete-active");
    activeAuctionFeedback.deferredTarget?.classList.remove("purchase-transition-target");
    activeAuctionFeedback = null;
  }
  if (!preservePending) pendingAuctionCompletion = null;
}

function completeAuctionFeedback(feedback, presentation, purchasePresentation) {
  if (activeAuctionFeedback !== feedback) return;
  feedback.cue?.classList.add("auction-complete-leaving");
  const cleanupTimer = window.setTimeout(() => {
    if (activeAuctionFeedback !== feedback) return;
    feedback.cue?.remove();
    feedback.cardElement?.classList.remove("auction-complete-card");
    feedback.dockElement?.classList.remove("auction-complete-active");
    activeAuctionFeedback = null;
    if (pendingAuctionCompletion?.revision === presentation.revision) pendingAuctionCompletion = null;
    if (purchasePresentation) animateSuccessfulPurchase(purchasePresentation);
    else renderRequiredChoice();
  }, 120);
  feedback.timers.push(cleanupTimer);
}

function animateAuctionFeedback(presentation, purchasePresentation = null) {
  const token = ++auctionFeedbackSerial;
  if (presentation.type === "bid") {
    const bidElement = els["action-title"].querySelector("[data-auction-bid]");
    const leaderElement = els.players.querySelector(`[data-player-id="${presentation.leaderId}"]`);
    const feedback = { token, timers: [], bidElement, leaderElement };
    activeAuctionFeedback = feedback;
    bidElement?.classList.add("auction-bid-changing");
    leaderElement?.classList.add("auction-leader-changed");
    const timer = window.setTimeout(() => {
      if (activeAuctionFeedback !== feedback || auctionFeedbackSerial !== token) return;
      bidElement?.classList.remove("auction-bid-changing");
      leaderElement?.classList.remove("auction-leader-changed");
      activeAuctionFeedback = null;
    }, AUCTION_BID_PULSE_DURATION);
    feedback.timers.push(timer);
    return;
  }

  const rect = presentation.sourceRect;
  const cardElement = [...els["stock-row"].querySelectorAll(".tulip-card[data-card-id]")]
    .find((element) => element.dataset.cardId === presentation.cardId);
  const dockElement = els["action-title"].closest(".action-dock");
  const cue = document.createElement("div");
  cue.className = "auction-complete-cue";
  cue.setAttribute("role", "status");
  cue.setAttribute("aria-live", "polite");
  cue.innerHTML = `<span class="auction-gavel" aria-hidden="true"><i></i><b></b></span><strong>成交</strong><small>${escapeHtml(playerName(presentation.winnerId))} · ${money(presentation.price)}</small>`;
  const centerX = rect ? rect.left + (rect.width / 2) : window.innerWidth / 2;
  const centerY = rect ? rect.top + (rect.height * 0.58) : window.innerHeight / 2;
  cue.style.left = `${Math.max(92, Math.min(window.innerWidth - 92, centerX))}px`;
  cue.style.top = `${Math.max(88, Math.min(window.innerHeight - 88, centerY))}px`;
  document.body.append(cue);
  cardElement?.classList.add("auction-complete-card");
  dockElement?.classList.add("auction-complete-active");

  let deferredTarget = null;
  if (purchasePresentation) {
    const targetSelector = purchasePresentation.method === "finance"
      ? `[data-loan-card="${purchasePresentation.cardId}"]`
      : `[data-ledger-card-id="${purchasePresentation.cardId}"]`;
    deferredTarget = els.players.querySelector(targetSelector);
    if (deferredTarget && cardHasLayout(deferredTarget)) deferredTarget.classList.add("purchase-transition-target");
    else deferredTarget = null;
  }
  const feedback = { token, timers: [], cue, cardElement, dockElement, deferredTarget };
  activeAuctionFeedback = feedback;
  const timer = window.setTimeout(() => {
    if (activeAuctionFeedback !== feedback || auctionFeedbackSerial !== token) return;
    completeAuctionFeedback(feedback, presentation, purchasePresentation);
  }, AUCTION_GAVEL_DURATION);
  feedback.timers.push(timer);
}

function finishPurchaseTransition() {
  purchaseTransitionSerial += 1;
  if (!activePurchaseTransition) return;
  activePurchaseTransition.animations.forEach((animation) => animation.cancel());
  activePurchaseTransition.timers.forEach((timer) => window.clearTimeout(timer));
  if (activePurchaseTransition.cashFrame) window.cancelAnimationFrame(activePurchaseTransition.cashFrame);
  activePurchaseTransition.layer?.remove();
  activePurchaseTransition.paymentElement?.remove();
  activePurchaseTransition.target?.classList.remove("purchase-transition-target", "purchase-ledger-land", "loan-document-arrive");
  activePurchaseTransition.target?.querySelector(".loan-stamp-arrive")?.classList.remove("loan-stamp-arrive");
  activePurchaseTransition.cashElement?.classList.remove("cash-value-changing");
  els["market-lanes"].classList.remove("transaction-transition-active");
  const buyer = state?.players?.[activePurchaseTransition.buyerId];
  if (buyer && activePurchaseTransition.cashElement && typeof buyer.cash === "number") {
    activePurchaseTransition.cashElement.textContent = money(buyer.cash);
  }
  activePurchaseTransition = null;
}

function completePurchasePresentation(transition) {
  if (activePurchaseTransition !== transition) return;
  transition.paymentElement?.remove();
  transition.target?.classList.remove("purchase-ledger-land", "loan-document-arrive");
  transition.target?.querySelector(".loan-stamp-arrive")?.classList.remove("loan-stamp-arrive");
  transition.cashElement?.classList.remove("cash-value-changing");
  const buyer = state?.players?.[transition.buyerId];
  if (buyer && transition.cashElement && typeof buyer.cash === "number") {
    transition.cashElement.textContent = money(buyer.cash);
  }
  els["market-lanes"].classList.remove("transaction-transition-active");
  activePurchaseTransition = null;
}

function animatePurchasePayment(snapshot, targetRect, cashElement, transition) {
  const amount = Number(snapshot.payment);
  if (!Number.isFinite(amount) || amount <= 0) {
    transition.timers.push(window.setTimeout(() => completePurchasePresentation(transition), CASH_COUNT_DURATION));
    return;
  }
  const cashRect = cashElement?.getBoundingClientRect();
  const startX = cashRect ? cashRect.left + (cashRect.width / 2) : targetRect.left + (targetRect.width / 2);
  const startY = cashRect ? cashRect.top + (cashRect.height / 2) : targetRect.top + 26;
  const endX = snapshot.sourceRect.left + (snapshot.sourceRect.width / 2);
  const endY = snapshot.sourceRect.top + (snapshot.sourceRect.height / 2);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const paymentElement = document.createElement("span");
  paymentElement.className = "floating-number transaction-payment";
  paymentElement.textContent = snapshot.method === "finance" ? `${money(amount)} · 贷款` : `-${money(amount)}`;
  paymentElement.setAttribute("aria-hidden", "true");
  paymentElement.style.left = `${startX}px`;
  paymentElement.style.top = `${startY}px`;
  document.body.append(paymentElement);
  transition.paymentElement = paymentElement;
  const paymentAnimation = paymentElement.animate([
    { transform: "translate(-50%, 5px) scale(0.96)", opacity: 0, offset: 0 },
    { transform: "translate(-50%, 0) scale(1)", opacity: 1, offset: 0.18 },
    { transform: `translate(calc(-50% + ${deltaX * 0.78}px), ${deltaY * 0.78}px) scale(0.98)`, opacity: 0.84, offset: 0.72 },
    { transform: `translate(calc(-50% + ${deltaX}px), ${deltaY}px) scale(0.94)`, opacity: 0, offset: 1 },
  ], { duration: PURCHASE_TRANSFER_DURATION, easing: gameEasing(), fill: "forwards" });
  transition.animations.push(paymentAnimation);
  paymentAnimation.finished.then(() => completePurchasePresentation(transition)).catch(() => {});
}

function animateMarketPurchaseReflow(snapshot, transition) {
  snapshot.remainingRects.forEach((oldRect, cardId) => {
    const card = [...els["stock-row"].querySelectorAll(".tulip-card[data-card-id]")]
      .find((element) => element.dataset.cardId === cardId);
    if (!card || !cardHasLayout(card)) return;
    const nextRect = card.getBoundingClientRect();
    const deltaX = oldRect.left - nextRect.left;
    const deltaY = oldRect.top - nextRect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
    card.classList.add("market-card-reflowing");
    const animation = card.animate([
      { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
      { transform: "translate3d(0, 0, 0)" },
    ], { duration: INCOMING_REVEAL_DURATION, easing: gameEasing() });
    transition.animations.push(animation);
    animation.finished.then(() => card.classList.remove("market-card-reflowing")).catch(() => {});
  });
}

function animateSuccessfulPurchase(snapshot) {
  const targetSelector = snapshot.method === "finance"
    ? `[data-loan-card="${snapshot.cardId}"]`
    : `[data-ledger-card-id="${snapshot.cardId}"]`;
  const target = els.players.querySelector(targetSelector);
  if (!target || !cardHasLayout(target)) return;
  const buyer = state.players[snapshot.buyerId];
  const cashElement = els.players.querySelector(`[data-cash-player="${snapshot.buyerId}"]`);
  const token = ++purchaseTransitionSerial;
  const targetRect = target.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "transaction-transfer-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const transition = {
    token,
    buyerId: snapshot.buyerId,
    target,
    layer,
    paymentElement: null,
    animations: [],
    timers: [],
    cashFrame: null,
    cashElement,
  };
  activePurchaseTransition = transition;
  if (cashElement && snapshot.method === "cash" && typeof snapshot.oldCash === "number") {
    cashElement.textContent = money(snapshot.oldCash);
  }
  els["market-lanes"].classList.add("transaction-transition-active");
  target.classList.add("purchase-transition-target");
  animateMarketPurchaseReflow(snapshot, transition);

  const clone = snapshot.clone;
  clone.classList.remove("interactive");
  clone.classList.add("purchase-transfer-clone");
  clone.setAttribute("aria-hidden", "true");
  Object.assign(clone.style, {
    left: `${targetRect.left}px`,
    top: `${targetRect.top}px`,
    width: `${targetRect.width}px`,
    height: `${targetRect.height}px`,
  });
  layer.append(clone);
  const deltaX = snapshot.sourceRect.left - targetRect.left;
  const deltaY = snapshot.sourceRect.top - targetRect.top;
  const scaleX = snapshot.sourceRect.width / targetRect.width;
  const scaleY = snapshot.sourceRect.height / targetRect.height;
  const flight = clone.animate([
    { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`, offset: 0 },
    { transform: `translate3d(${deltaX}px, ${deltaY - 7}px, 0) scale(${scaleX * 1.02}, ${scaleY * 1.02})`, offset: 0.16 },
    { transform: "translate3d(0, 0, 0) scale(0.92)", offset: 0.78 },
    { transform: "translate3d(0, 0, 0) scale(1.04)", offset: 0.92 },
    { transform: "translate3d(0, 0, 0) scale(1)", offset: 1 },
  ], { duration: PURCHASE_TRANSFER_DURATION, easing: gameEasing(), fill: "forwards" });
  transition.animations.push(flight);
  flight.finished.then(() => {
    if (activePurchaseTransition !== transition || purchaseTransitionSerial !== token) return;
    target.classList.remove("purchase-transition-target");
    target.classList.add("purchase-ledger-land", "anim-gold-highlight");
    layer.remove();
    if (snapshot.method === "finance") {
      target.classList.add("loan-document-arrive");
      target.querySelector(".loan-stamp")?.classList.add("loan-stamp-arrive");
    } else if (typeof snapshot.oldCash === "number" && typeof snapshot.newCash === "number") {
      animateCashValue(cashElement, snapshot.oldCash, snapshot.newCash, transition);
    }
    animatePurchasePayment(snapshot, targetRect, cashElement, transition);
  }).catch(() => {});
}

function finishMarketTransition() {
  marketTransitionSerial += 1;
  if (!activeMarketTransition) return;
  activeMarketTransition.animations.forEach((animation) => animation.cancel());
  window.clearTimeout(activeMarketTransition.cleanupTimer);
  activeMarketTransition.layer?.remove();
  els["market-lanes"].classList.remove("market-transition-active");
  els["market-lanes"].querySelectorAll(".stock-transition-target, .incoming-transition-pending").forEach((card) => {
    card.classList.remove("stock-transition-target", "incoming-transition-pending");
  });
  activeMarketTransition = null;
}

function captureIncomingTransfer(nextState) {
  if (prefersReducedMotion() || els.tabletop.classList.contains("hidden")) return null;
  const sourceById = new Map(
    [...els["incoming-row"].querySelectorAll(".tulip-card[data-card-id]")]
      .map((card) => [card.dataset.cardId, card]),
  );
  const movedCards = nextState.stock.filter((card) => sourceById.has(String(card.id)));
  if (!movedCards.length) return null;

  const entries = movedCards.map((card) => {
    const source = sourceById.get(String(card.id));
    if (!cardHasLayout(source)) return null;
    return {
      id: String(card.id),
      sourceRect: source.getBoundingClientRect(),
      clone: source.cloneNode(true),
    };
  }).filter(Boolean);

  if (!entries.length) return null;
  return {
    entries,
    newIncomingIds: new Set(nextState.incoming.map((card) => String(card.id))),
  };
}

function revealNewIncomingCards(newIncomingIds, transition) {
  const cards = [...els["incoming-row"].querySelectorAll(".tulip-card[data-card-id]")]
    .filter((card) => newIncomingIds.has(card.dataset.cardId));
  cards.forEach((card, index) => {
    card.classList.remove("incoming-transition-pending");
    card.style.setProperty("--arrival-index", String(index));
    card.classList.add("incoming-card-arrive");
  });
  const totalDuration = INCOMING_REVEAL_DURATION + Math.max(0, cards.length - 1) * INCOMING_REVEAL_STAGGER;
  transition.cleanupTimer = window.setTimeout(() => {
    if (activeMarketTransition !== transition) return;
    cards.forEach((card) => {
      card.classList.remove("incoming-card-arrive");
      card.style.removeProperty("--arrival-index");
    });
    els["market-lanes"].classList.remove("market-transition-active");
    activeMarketTransition = null;
  }, totalDuration + 40);
}

function animateIncomingTransfer(snapshot) {
  if (!snapshot) return;
  const token = ++marketTransitionSerial;
  const layer = document.createElement("div");
  layer.className = "market-transfer-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);

  const transition = { token, layer, animations: [], cleanupTimer: null };
  activeMarketTransition = transition;
  els["market-lanes"].classList.add("market-transition-active");
  els["incoming-row"].querySelectorAll(".tulip-card[data-card-id]").forEach((card) => {
    if (snapshot.newIncomingIds.has(card.dataset.cardId)) card.classList.add("incoming-transition-pending");
  });

  snapshot.entries.forEach((entry) => {
    const target = els["stock-row"].querySelector(`[data-card-id="${CSS.escape(entry.id)}"]`);
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    target.classList.add("stock-transition-target");
    entry.clone.classList.remove("interactive", "lane-incoming");
    entry.clone.classList.add("market-transfer-clone", "lane-stock");
    Object.assign(entry.clone.style, {
      left: `${entry.sourceRect.left}px`,
      top: `${entry.sourceRect.top}px`,
      width: `${entry.sourceRect.width}px`,
      height: `${entry.sourceRect.height}px`,
    });
    layer.append(entry.clone);
    const deltaX = targetRect.left - entry.sourceRect.left;
    const deltaY = targetRect.top - entry.sourceRect.top;
    const scaleX = targetRect.width / entry.sourceRect.width;
    const scaleY = targetRect.height / entry.sourceRect.height;
    const animation = entry.clone.animate([
      { transform: "translate3d(0, 0, 0) scale(1)", offset: 0 },
      { transform: "translate3d(0, -7px, 0) scale(1.015)", offset: 0.18 },
      { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`, offset: 1 },
    ], {
      duration: MARKET_TRANSFER_DURATION,
      easing: gameEasing(),
      fill: "forwards",
    });
    transition.animations.push(animation);
  });

  if (!transition.animations.length) {
    layer.remove();
    els["market-lanes"].classList.remove("market-transition-active");
    activeMarketTransition = null;
    return;
  }

  Promise.allSettled(transition.animations.map((animation) => animation.finished)).then(() => {
    if (activeMarketTransition !== transition || marketTransitionSerial !== token) return;
    els["stock-row"].querySelectorAll(".stock-transition-target").forEach((card) => {
      card.classList.remove("stock-transition-target");
      card.classList.add("anim-gold-highlight");
    });
    layer.remove();
    revealNewIncomingCards(snapshot.newIncomingIds, transition);
  });
}

function finishPriceTransition() {
  if (!activePriceTransition) return;
  priceTransitionSerial += 1;
  activePriceTransition.animations.forEach((animation) => animation.cancel());
  activePriceTransition.layer?.remove();
  activePriceTransition.indicators.forEach((indicator) => indicator.remove());
  els["price-tracks"].querySelectorAll(".price-transition-target").forEach((marker) => {
    marker.classList.remove("price-transition-target");
  });
  els["price-tracks"].querySelectorAll(".price-value-emphasis, .price-level-emphasis").forEach((element) => {
    element.classList.remove("price-value-emphasis", "price-level-emphasis");
  });
  activePriceTransition = null;
}

function priceChangeReason(nextState) {
  return nextState.phase === "supply" && nextState.supplyResult?.beforePrices
    ? "supply-demand"
    : "market-event";
}

function capturePricePresentations(previousState, nextState) {
  finishPriceTransition();
  if (!previousState?.started || !nextState?.started || prefersReducedMotion()) return [];
  const reason = priceChangeReason(nextState);

  return COLOR_IDS.map((color) => {
    const oldPrice = Number(previousState.prices?.[color]);
    const newPrice = Number(nextState.prices?.[color]);
    if (!Number.isInteger(oldPrice) || !Number.isInteger(newPrice) || oldPrice === newPrice) return null;
    const marker = els["price-tracks"].querySelector(`.price-tulip.${color}`);
    if (!marker || !cardHasLayout(marker)) return null;
    const clone = marker.cloneNode(true);
    clone.classList.remove("price-rise", "price-fall", "price-still");
    clone.classList.add("price-transition-clone");
    clone.dataset.reason = reason;
    clone.setAttribute("aria-hidden", "true");
    return {
      change: {
        color,
        oldPrice,
        newPrice,
        delta: newPrice - oldPrice,
        reason,
      },
      clone,
      sourceRect: marker.getBoundingClientRect(),
    };
  }).filter(Boolean);
}

function priceLevelRect(level, markerOffset) {
  const cell = els["price-tracks"].querySelector(`.price-level-cell[data-price-level="${level}"]`);
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  return {
    left: rect.left + markerOffset.x,
    top: rect.top + markerOffset.y,
  };
}

function emphasizePriceDestination(level, target) {
  target.classList.add("price-marker-arrived");
  const cell = target.closest(".price-level-cell");
  cell?.classList.add("price-level-emphasis");
  els["price-tracks"].querySelectorAll(`[data-price-value-level="${level}"]`).forEach((value) => {
    value.classList.add("price-value-emphasis");
  });
}

function createPriceDeltaIndicator(change, targetRect, transition) {
  const indicator = document.createElement("span");
  const rising = change.delta > 0;
  indicator.className = `floating-number price-delta-indicator ${rising ? "price-delta-up" : "price-delta-down"}`;
  indicator.dataset.reason = change.reason;
  indicator.textContent = `${rising ? "↑" : "↓"} ${rising ? "+" : "-"}${Math.abs(change.delta)}`;
  indicator.setAttribute("aria-hidden", "true");
  indicator.style.left = `${targetRect.left + (targetRect.width / 2)}px`;
  indicator.style.top = `${targetRect.top + (targetRect.height / 2)}px`;
  document.body.append(indicator);
  transition.indicators.push(indicator);
  const animation = indicator.animate(rising ? [
    { transform: "translate(-50%, 5px) scale(0.94)", opacity: 0 },
    { transform: "translate(-50%, -2px) scale(1)", opacity: 1, offset: 0.22 },
    { transform: "translate(-50%, -22px) scale(0.98)", opacity: 0 },
  ] : [
    { transform: "translate(-50%, -6px) scale(0.96)", opacity: 0 },
    { transform: "translate(-50%, 1px) scale(1)", opacity: 1, offset: 0.22 },
    { transform: "translate(-50%, 19px) scale(0.98)", opacity: 0 },
  ], { duration: 700, easing: gameEasing(), fill: "forwards" });
  transition.animations.push(animation);
  return animation.finished.catch(() => {});
}

async function animatePriceChange({ color, oldPrice, newPrice, delta, reason }, presentation, index, transition) {
  const target = els["price-tracks"].querySelector(`.price-tulip.${color}`);
  if (!target || !cardHasLayout(target) || !delta) return;
  const targetRect = target.getBoundingClientRect();
  const targetCellRect = target.closest(".price-level-cell")?.getBoundingClientRect();
  if (!targetCellRect) return;

  target.classList.add("price-transition-target");
  const markerOffset = {
    x: targetRect.left - targetCellRect.left,
    y: targetRect.top - targetCellRect.top,
  };
  const clone = presentation.clone;
  clone.style.left = `${presentation.sourceRect.left}px`;
  clone.style.top = `${presentation.sourceRect.top}px`;
  clone.style.width = `${presentation.sourceRect.width}px`;
  clone.style.height = `${presentation.sourceRect.height}px`;
  transition.layer.append(clone);

  let currentX = 0;
  let currentY = 0;
  const direction = delta > 0 ? 1 : -1;
  const levelCount = Math.abs(delta);
  for (let step = 1; step <= levelCount; step += 1) {
    if (activePriceTransition !== transition) return;
    const level = oldPrice + (direction * step);
    const nextPoint = priceLevelRect(level, markerOffset);
    if (!nextPoint) break;
    const nextX = nextPoint.left - presentation.sourceRect.left;
    const nextY = nextPoint.top - presentation.sourceRect.top;
    const animation = clone.animate([
      { transform: `translate3d(${currentX}px, ${currentY}px, 0) scale(1)` },
      { transform: `translate3d(${currentX}px, ${currentY - 4}px, 0) scale(1.035)`, offset: 0.2 },
      { transform: `translate3d(${nextX}px, ${nextY}px, 0) scale(1)` },
    ], {
      duration: PRICE_LEVEL_DURATION,
      delay: step === 1 ? index * PRICE_COLOR_STAGGER : 0,
      easing: gameEasing(),
      fill: "forwards",
    });
    transition.animations.push(animation);
    try {
      await animation.finished;
    } catch {
      return;
    }
    currentX = nextX;
    currentY = nextY;
  }

  if (activePriceTransition !== transition) return;
  target.classList.remove("price-transition-target");
  clone.remove();
  emphasizePriceDestination(newPrice, target);
  await createPriceDeltaIndicator({ color, oldPrice, newPrice, delta, reason }, targetRect, transition);
}

function animatePriceChanges(presentations) {
  if (!presentations.length || prefersReducedMotion()) return Promise.resolve(false);
  const token = ++priceTransitionSerial;
  const layer = document.createElement("div");
  layer.className = "price-marker-transfer-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const transition = { animations: [], indicators: [], layer };
  activePriceTransition = transition;

  return Promise.allSettled(presentations.map((presentation, index) => animatePriceChange(
    presentation.change,
    presentation,
    index,
    transition,
  ))).then(() => {
    if (activePriceTransition !== transition || priceTransitionSerial !== token) return false;
    layer.remove();
    transition.indicators.forEach((indicator) => indicator.remove());
    return new Promise((resolve) => window.setTimeout(() => {
      if (activePriceTransition !== transition) return resolve(false);
      els["price-tracks"].querySelectorAll(".price-marker-arrived, .price-value-emphasis, .price-level-emphasis").forEach((element) => {
        element.classList.remove("price-marker-arrived", "price-value-emphasis", "price-level-emphasis");
      });
      activePriceTransition = null;
      resolve(true);
    }, 260));
  });
}

function finishSupplySettlement() {
  if (!activeSupplySettlement) return;
  supplySettlementSerial += 1;
  if (activeSupplySettlement.countFrame) window.cancelAnimationFrame(activeSupplySettlement.countFrame);
  activeSupplySettlement.countResolve?.(false);
  activeSupplySettlement.timers.forEach((entry) => {
    window.clearTimeout(entry.id);
    entry.resolve(false);
  });
  const panel = els["supply-explainer"];
  panel.classList.remove("settlement-presenting", "settlement-results-visible", "settlement-leaving");
  panel.removeAttribute("aria-busy");
  panel.setAttribute("aria-live", "polite");
  panel.closest(".market-board")?.classList.remove("supply-settlement-active");
  els["market-lanes"].classList.remove("supply-settlement-dim");
  pendingSupplySettlementRevision = null;
  activeSupplySettlement = null;
}

function captureSupplySettlement(previousState, nextState) {
  finishSupplySettlement();
  pendingSupplySettlementRevision = null;
  if (nextState?.phase !== "supply" || !nextState.supplyResult || prefersReducedMotion()) return null;
  if (previousState?.phase === "supply") return null;
  pendingSupplySettlementRevision = nextState.revision;
  return {
    revision: nextState.revision,
    counts: { ...nextState.supplyResult.counts },
    rising: [...nextState.supplyResult.rising],
    falling: [...nextState.supplyResult.falling],
    balanced: nextState.supplyResult.rising.length === 0 && nextState.supplyResult.falling.length === 0,
  };
}

function waitForSupplySettlement(duration, transition) {
  return new Promise((resolve) => {
    const entry = { id: null, resolve };
    entry.id = window.setTimeout(() => {
      transition.timers = transition.timers.filter((item) => item !== entry);
      resolve(activeSupplySettlement === transition);
    }, duration);
    transition.timers.push(entry);
  });
}

function animateSupplyCounts(snapshot, transition) {
  const numberElements = new Map(COLOR_IDS.map((color) => [
    color,
    els["supply-explainer"].querySelector(`[data-supply-count="${color}"]`),
  ]));
  numberElements.forEach((element) => { if (element) element.textContent = "0"; });
  if (!numberElements.size) return Promise.resolve(false);
  const startedAt = performance.now();
  return new Promise((resolve) => {
    transition.countResolve = resolve;
    const update = (now) => {
      if (activeSupplySettlement !== transition) return resolve(false);
      const progress = Math.min(1, (now - startedAt) / SUPPLY_COUNT_DURATION);
      const eased = 1 - ((1 - progress) ** 3);
      COLOR_IDS.forEach((color) => {
        const element = numberElements.get(color);
        if (element) element.textContent = String(Math.round(snapshot.counts[color] * eased));
      });
      if (progress < 1) transition.countFrame = window.requestAnimationFrame(update);
      else {
        COLOR_IDS.forEach((color) => {
          const element = numberElements.get(color);
          if (element) element.textContent = String(snapshot.counts[color]);
        });
        transition.countFrame = null;
        transition.countResolve = null;
        resolve(true);
      }
    };
    transition.countFrame = window.requestAnimationFrame(update);
  });
}

async function animateSupplySettlement(snapshot, pricePresentations) {
  const panel = els["supply-explainer"];
  if (!panel || prefersReducedMotion()) return;
  pendingSupplySettlementRevision = null;
  const token = ++supplySettlementSerial;
  const transition = { countFrame: null, countResolve: null, timers: [] };
  activeSupplySettlement = transition;
  panel.classList.remove("hidden", "settlement-leaving");
  panel.classList.add("settlement-presenting");
  panel.setAttribute("aria-busy", "true");
  panel.setAttribute("aria-live", "off");
  panel.closest(".market-board")?.classList.add("supply-settlement-active");
  els["market-lanes"].classList.add("supply-settlement-dim");

  if (!await waitForSupplySettlement(100, transition)) return;
  if (!await animateSupplyCounts(snapshot, transition)) return;
  panel.classList.add("settlement-results-visible");
  panel.querySelector(".supply-status")?.replaceChildren(document.createTextNode("核算完成"));
  panel.removeAttribute("aria-busy");
  panel.setAttribute("aria-live", "polite");
  if (!await waitForSupplySettlement(120, transition)) return;

  if (pricePresentations.length) await animatePriceChanges(pricePresentations);
  else if (!await waitForSupplySettlement(SUPPLY_BALANCE_HOLD, transition)) return;
  if (activeSupplySettlement !== transition || supplySettlementSerial !== token) return;

  panel.classList.add("settlement-leaving");
  if (!await waitForSupplySettlement(SUPPLY_PANEL_FADE_DURATION, transition)) return;
  if (activeSupplySettlement !== transition || supplySettlementSerial !== token) return;
  settledSupplyRevision = snapshot.revision;
  panel.classList.add("hidden");
  panel.classList.remove("settlement-presenting", "settlement-results-visible", "settlement-leaving");
  panel.closest(".market-board")?.classList.remove("supply-settlement-active");
  els["market-lanes"].classList.remove("supply-settlement-dim");
  activeSupplySettlement = null;
}

function renderPrices() {
  const rising = new Set(state.supplyResult?.rising ?? []);
  const falling = new Set(state.supplyResult?.falling ?? []);
  const levelCells = PRICE_LEVEL_NAMES.map((level, index) => {
    const markers = COLOR_IDS.filter((color) => state.prices[color] === index);
    const markerMarkup = markers.map((color, markerIndex) => {
      const center = (markers.length - 1) / 2;
      const shift = Math.round((markerIndex - center) * 12);
      return `<span class="price-tulip ${color}" style="--price-marker-shift:${shift}px" aria-label="${COLORS[color].name}价格标记"></span>`;
    }).join("");
    return `<div class="price-level-cell ${markers.length ? "occupied" : ""} marker-count-${markers.length}" data-price-level="${index}">${markerMarkup}<strong>${level}</strong></div>`;
  }).join("");
  const rows = ["A", "B", "C"].map((rank) => `<div class="price-rank-label"><strong>${rank}</strong><small>${rank === "A" ? "珍稀" : rank === "B" ? "优良" : "常见"}</small></div>${PRICE_TABLE[rank].map((price, index) => `<div class="price-value ${COLOR_IDS.some((color) => state.prices[color] === index) ? "live" : ""}" data-price-value-level="${index}">${price}</div>`).join("")}`).join("");
  els["price-tracks"].innerHTML = `<div class="price-matrix"><div class="price-corner">等级</div>${levelCells}${rows}</div><div class="price-legend">${COLOR_IDS.map((color) => {
    const delta = rising.has(color) ? `<em class="up">供应少 +1</em>` : falling.has(color) ? `<em class="down">供应多 -1</em>` : "";
    return `<span><i class="legend-dot ${color}"></i>${COLORS[color].short}色在 ${PRICE_LEVEL_NAMES[state.prices[color]]}${delta}</span>`;
  }).join("")}</div>`;
}

function renderCollectors() {
  const me = viewer();
  els.collectors.innerHTML = [20, 15, 10].map((bonus) => {
    const collector = state.collectors[bonus];
    if (!collector) return `<article class="collector-card empty"><p>ƒ${bonus} 委托已售罄</p></article>`;
    const sets = me ? findCollectorSets(me.hand.filter(Boolean), collector.id) : [];
    const canSell = state.phase === "sell" && isMyTurn() && sets.length > 0 && !me.collectorSold;
    const portraitPosition = COLLECTOR_SPRITES[collector.id] ?? "0% 0%";
    return `<article class="collector-card collector-${bonus}"><div class="collector-portrait" style="--collector-position:${portraitPosition}" role="img" aria-label="${collector.name}的半侧影油画"></div><div class="collector-copy"><div class="collector-title"><h3>${collector.name}</h3><span>+${collector.bonus}</span></div><p>${collector.requirement}</p><small>余 ${state.collectorCounts[bonus]} 张</small><button type="button" data-collector="${bonus}" ${canSell ? "" : "disabled"}>${canSell ? `交付组合 · ${sets.length} 组可选` : "当前不可交付"}</button></div></article>`;
  }).join("");
}

function ledgerTulipMarkup(card, { interactive = false, extraClass = "" } = {}) {
  const tag = interactive ? "button" : "span";
  const attributes = `data-ledger-card-id="${card.id}" ${interactive ? `type="button" data-hand-card="${card.id}"` : ""}`;
  const art = ART_VARIANTS[card.variety];
  return `<${tag} class="ledger-tulip ${card.color} ${extraClass}" ${attributes} title="${COLORS[card.color].name} ${card.variety} · 当前 ${money(getMarketPrice(card, state.prices))}">
    <span class="ledger-tulip-art" style="--art-position:${art.position}"></span>
    <span class="ledger-tulip-meta"><b>${card.variety}</b><small>${money(getMarketPrice(card, state.prices))}</small></span>
  </${tag}>`;
}

function renderPlayers() {
  const orderedPlayers = [viewer(), ...state.players.filter((player) => player.id !== state.viewerId)];
  els.players.innerHTML = orderedPlayers.map((player) => {
    const isMe = player.id === state.viewerId;
    const isActive = player.id === state.activePlayer;
    const auctionParticipant = Boolean(state.auction?.participants.includes(player.id));
    const auctionPassed = Boolean(state.auction?.passed.includes(player.id));
    const auctionLeader = state.auction?.leader === player.id;
    const expanded = isMe || expandedLedgers.has(player.id);
    const placed = placedMarkerCount(player.id);
    const locked = player.financed.length;
    const available = Math.max(0, 3 - placed - locked);
    const rack = [...Array(locked).fill("locked"), ...Array(placed).fill("placed"), ...Array(available).fill("available")]
      .map((status) => markerMarkupFor(player.id, `marker-${status}`)).join("");
    const handMarkup = player.hand.filter(Boolean).map((card) => ledgerTulipMarkup(card, { interactive: isMe })).join("");
    const loans = player.financed.map((loan) => {
      const art = ART_VARIANTS[loan.card.variety];
      return `<button type="button" class="ledger-tulip loan-tulip ${loan.card.color}" data-loan-card="${loan.card.id}" data-loan-owner="${player.id}" ${player.id === state.viewerId && state.phase !== "finished" ? "" : "disabled"} title="${COLORS[loan.card.color].name} ${loan.card.variety} · 贷款 ${money(loan.debt)}"><span class="ledger-tulip-art" style="--art-position:${art.position}"></span><span class="loan-stamp">贷款</span><span class="ledger-tulip-meta"><b>${loan.card.variety}</b><small>欠 ${money(loan.debt)}</small></span>${markerMarkupFor(player.id, "marker-on-loan")}</button>`;
    }).join("");
    const debt = player.financed.reduce((total, loan) => total + loan.debt, 0);
    const auctionBadge = auctionLeader ? "最高出价" : auctionParticipant ? (auctionPassed ? "已退出" : "竞拍中") : "";
    return `<article class="player-sheet ${isMe ? "self" : "rival"} ${expanded ? "expanded" : "collapsed"} ${isActive ? "active" : ""} ${auctionParticipant ? "auction-participant" : ""} ${auctionPassed ? "auction-passed" : ""} ${auctionLeader ? "auction-leader" : ""}" data-player-id="${player.id}" style="--player-color:${player.color}">
      <div class="player-head"><h3>${markerMarkupFor(player.id, "marker-identity")}<span>${escapeHtml(player.name)}${player.id === state.startPlayer ? " · 起始" : ""}${isMe ? " · 你" : ""}</span></h3><div class="player-head-actions">${auctionBadge ? `<span class="auction-player-badge">${auctionBadge}</span>` : ""}<strong data-cash-player="${player.id}">${isMe || state.phase === "finished" ? money(player.cash) : "现金隐藏"}</strong>${isMe ? "" : `<button type="button" class="ledger-toggle" data-player-toggle="${player.id}" aria-expanded="${expanded}" title="${expanded ? "收起账簿" : "展开账簿"}">${expanded ? "−" : "+"}</button>`}</div></div>
      <div class="player-summary"><span>持有 ${player.hand.length}</span><span>贷款 ${locked}</span><span>可用标 ${available}</span></div>
      <div class="ledger-body ${expanded ? "" : "hidden"}"><div class="marker-ledger"><span>购买标记 · 已放 ${placed} · 锁定 ${locked}</span><div class="marker-rack">${rack}</div></div><div class="tulip-ledger"><span>持有郁金香</span><div class="ledger-card-stack">${handMarkup || `<small class="empty-hand">没有持有郁金香</small>`}</div></div>${loans ? `<div class="loan-zone"><span>债务区 · 合计 ${money(debt)}</span><div class="ledger-card-stack">${loans}</div></div>` : ""}</div>
    </article>`;
  }).join("");
}

function getEventDescription(event) {
  if (!event) return "尚未翻开市场事件。";
  if (event.type === "rise") return `${COLORS[event.color].name}郁金香的价格标记上升 1 级。`;
  if (event.type === "surge") return "当前价格等级最低的颜色上升 2 级，并越过已占用格。";
  if (event.type === "crash") return "当前价格等级最高的颜色下降 2 级；若无空格则停留原位。";
  return "泡沫立即破裂：停止一切交易，手中郁金香价值归零。";
}

function renderEvent() {
  els["event-title"].textContent = state.currentEvent?.title ?? "等待事件";
  els["event-symbol"].textContent = state.currentEvent?.symbol ?? "?";
  els["event-text"].textContent = getEventDescription(state.currentEvent);
  els["market-deck-count"].textContent = `牌堆 ${state.deckCount} · 弃牌 ${state.discardCount}`;
}

function closeChoice() {
  choiceKey = "";
  if (els["choice-dialog"].open) els["choice-dialog"].close();
}

function openChoice(key, { kicker, title, text, actions }) {
  if (choiceKey === key && els["choice-dialog"].open) return;
  choiceKey = key;
  els["choice-kicker"].textContent = kicker;
  els["choice-title"].textContent = title;
  els["choice-text"].textContent = text;
  els["choice-actions"].replaceChildren();
  actions.forEach((definition) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = definition.primary ? "primary-button" : "secondary-button";
    button.textContent = definition.label;
    button.disabled = Boolean(definition.disabled);
    button.addEventListener("click", definition.action, { once: true });
    els["choice-actions"].append(button);
  });
  if (!els["choice-dialog"].open) els["choice-dialog"].showModal();
}

function renderRequiredChoice() {
  if (!isMyTurn()) return closeChoice();
  if (pendingAuctionCompletion?.revision === state.revision) return closeChoice();
  if (state.phase === "queen-check" && state.queenCheck) {
    const me = viewer();
    return openChoice(`queen-${state.revision}`, {
      kicker: "秘密决定",
      title: `${me.name}是否购买“夜后”？`,
      text: `你有 ${money(me.cash)} 且没有贷款。宣布购买需支付 ${money(120)}；多人宣布时现金最多者获胜。`,
      actions: [
        { label: `宣布购买 · ${money(120)}`, primary: true, action: () => sendAction("queen-decision", { declare: true }) },
        { label: "暂不购买", action: () => sendAction("queen-decision", { declare: false }) },
      ],
    });
  }
  if (state.currentPurchase?.winnerId === state.viewerId) {
    const purchase = state.currentPurchase;
    const card = allMarketCards().find((item) => item.id === purchase.cardId);
    return openChoice(`purchase-${state.revision}`, {
      kicker: "成交结算",
      title: `${COLORS[card.color].name} ${card.variety} · ${money(purchase.price)}`,
      text: "现金购买会把牌收入挡板后；全额融资不会消耗现金，但会把一枚购买标记锁在公开贷款牌上。",
      actions: [
        { label: `现金支付 · ${money(purchase.price)}`, primary: true, disabled: viewer().cash < purchase.price, action: () => sendAction("complete-purchase", { method: "cash" }) },
        { label: `全额融资 · ${money(purchase.price)}`, disabled: viewer().financed.length >= 3, action: () => sendAction("complete-purchase", { method: "finance" }) },
      ],
    });
  }
  closeChoice();
}

function renderPhaseTimeline() {
  const stageOrder = ["event", "incoming", "sell", "auction", "supply", "cleanup"];
  const stageByPhase = {
    event: "event",
    sell: "sell",
    "queen-check": "auction",
    bid: "auction",
    resolve: "auction",
    supply: "supply",
    cleanup: "cleanup",
    finished: "cleanup",
  };
  const currentIndex = stageOrder.indexOf(stageByPhase[state.phase] ?? "event");
  els["phase-timeline"].querySelectorAll("li").forEach((item, index) => {
    item.classList.toggle("active", index === currentIndex);
    item.classList.toggle("complete", index < currentIndex);
  });
}

function renderSupplyExplainer() {
  const panel = els["supply-explainer"];
  if (state.phase !== "supply" || !state.supplyResult || settledSupplyRevision === state.revision) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }
  const { counts, rising, falling } = state.supplyResult;
  const balanced = rising.length === 0 && falling.length === 0;
  const presenting = pendingSupplySettlementRevision === state.revision;
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="supply-ledger-ornament" aria-hidden="true"><i></i><span>1636</span><i></i></div>
    <div class="supply-heading"><div><p class="overline">阿姆斯特丹花市结算</p><strong>供需账簿</strong></div><span class="supply-status">${presenting ? "核算中" : "核算完成"}</span></div>
    <p class="supply-basis">统计依据：即将进货 + 剩余现货 + 本轮售出</p>
    <div class="supply-counts">${COLOR_IDS.map((color) => {
      const isMinimum = rising.includes(color);
      const isMaximum = falling.includes(color);
      const direction = isMinimum ? "up" : isMaximum ? "down" : "still";
      const outcome = isMinimum
        ? `<span>供应最少</span><em>价格 +1</em>`
        : isMaximum
          ? `<span>供应最多</span><em>价格 -1</em>`
          : `<span>供应居中</span><em>价格不变</em>`;
      return `<article class="supply-count ${color} ${direction}"><div class="supply-color-name"><i class="legend-dot ${color}"></i><b>${COLORS[color].name}</b></div><strong data-supply-count="${color}">${presenting ? 0 : counts[color]}</strong><div class="supply-outcome">${outcome}</div></article>`;
    }).join("")}</div>
    ${balanced ? `<p class="supply-balance-message">市场供需平衡，本轮不调整价格</p>` : ""}
    <div class="supply-ledger-signature"><span>交易所抄录</span><i aria-hidden="true">结</i></div>`;
}

function renderActionDock() {
  const passButton = els["pass-button"];
  const nextButton = els["next-button"];
  const bidEntry = els["bid-entry"];
  passButton.classList.add("hidden");
  nextButton.classList.add("hidden");
  bidEntry.classList.add("hidden");
  const mine = isMyTurn();
  if (state.phase === "sell") {
    els["action-kicker"].textContent = "出售阶段";
    els["action-title"].textContent = mine ? "管理你的藏品" : `等待${playerName(state.activePlayer)}出售`;
    els["action-text"].innerHTML = mine ? "点击你的手牌可卖回市场，也可交付一份收藏家委托。" : `<span class="waiting-turn">对方正在挡板后决定</span>`;
    if (mine) { nextButton.textContent = "结束出售"; nextButton.classList.remove("hidden"); }
  } else if (state.phase === "queen-check") {
    els["action-kicker"].textContent = "夜后购买窗口";
    els["action-title"].textContent = mine ? "请秘密决定" : `等待${playerName(state.activePlayer)}决定`;
    els["action-text"].textContent = "符合条件的商人将依次私下决定是否宣布购买。";
  } else if (state.phase === "bid") {
    const max = state.bidPass === 1 ? 2 : 1;
    els["action-kicker"].textContent = `买入阶段 · 第 ${state.bidPass} 轮`;
    els["action-title"].textContent = mine ? "放置你的购买标记" : `等待${playerName(state.activePlayer)}落标`;
    els["action-text"].textContent = mine ? `本次已放 ${state.placementsThisTurn}/${max} 枚，手边还有 ${availableMarkerCount(state.viewerId)} 枚。点击郁金香直接落标。` : "所有设备都会实时看到落下的实体标记。";
    if (mine) { nextButton.textContent = "结束本轮摆标"; nextButton.classList.remove("hidden"); }
  } else if (state.phase === "resolve" && state.auction) {
    const card = allMarketCards().find((item) => item.id === state.auction.cardId);
    const minimum = state.auction.currentBid + 1;
    const activeBidders = state.auction.participants.filter((playerId) => !state.auction.passed.includes(playerId));
    const leaderText = state.auction.leader === null ? "尚无最高出价者" : `最高出价者：${escapeHtml(playerName(state.auction.leader))}`;
    els["action-kicker"].textContent = "公开竞拍";
    els["action-title"].innerHTML = `<span class="auction-lot-name">${COLORS[card.color].name} ${card.variety}</span><span class="auction-current-bid"><small>当前出价</small><b data-auction-bid aria-label="当前出价 ${money(state.auction.currentBid)}">${money(state.auction.currentBid)}</b></span>`;
    els["action-text"].innerHTML = `<span class="auction-status-row"><span class="auction-leader-status">${leaderText}</span><span class="auction-active-status">仍在竞拍：${activeBidders.map((playerId) => escapeHtml(playerName(playerId))).join("、")}</span></span><span class="auction-turn-guidance">${mine ? (state.auction.leader === null ? `首价至少 ${money(minimum)}；也可退出竞拍。` : "你可以加价或退出竞拍。") : `等待${escapeHtml(playerName(state.activePlayer))}出价。`}</span>`;
    if (mine) {
      els["bid-amount"].min = String(minimum);
      if (Number(els["bid-amount"].value) < minimum) els["bid-amount"].value = String(minimum);
      bidEntry.classList.remove("hidden");
      passButton.textContent = "退出竞拍";
      nextButton.textContent = "确认出价";
      passButton.classList.remove("hidden");
      nextButton.classList.remove("hidden");
    }
  } else if (state.phase === "resolve" && state.currentPurchase) {
    els["action-kicker"].textContent = "成交结算";
    els["action-title"].textContent = mine ? "选择付款方式" : `等待${playerName(state.activePlayer)}付款`;
    els["action-text"].textContent = "可现金支付，或把成交价全额融资并锁定一枚购买标记。";
  } else if (state.phase === "resolve") {
    els["action-kicker"].textContent = "按顺序结算";
    els["action-title"].textContent = "交易所正在处理标记";
    els["action-text"].textContent = "无标记的牌留在市场；单人标记按市价强制购买；多人标记进入竞拍。";
  } else if (state.phase === "supply") {
    const { counts, rising, falling } = state.supplyResult;
    els["action-kicker"].textContent = "供需调价";
    els["action-title"].textContent = `红 ${counts.red} · 黄 ${counts.yellow} · 白 ${counts.white}`;
    els["action-text"].textContent = rising.length === 0 ? "三色供应相同，价格不移动。确认后再清理本轮市场。" : `${falling.map((color) => COLORS[color].short).join("、")}色供应最多，价格 -1；${rising.map((color) => COLORS[color].short).join("、")}色供应最少，价格 +1。`;
    if (state.viewerId === 0) { nextButton.textContent = "确认调价并清理市场"; nextButton.classList.remove("hidden"); }
    else els["action-text"].textContent += " 等待房主确认调价。";
  } else if (state.phase === "cleanup") {
    const summary = state.cleanupSummary ?? { stock: 0, sold: 0 };
    els["action-kicker"].textContent = "清理阶段";
    els["action-title"].textContent = "本轮市场已归档";
    els["action-text"].textContent = `已移走 ${summary.stock} 株剩余现货与 ${summary.sold} 株本轮售出；即将进货保持公开，下一轮会转入现货。`;
    if (state.viewerId === 0) { nextButton.textContent = `翻开第 ${state.round + 1} 轮事件`; nextButton.classList.remove("hidden"); }
    else els["action-text"].textContent += " 等待房主翻开下一轮事件。";
  } else if (state.phase === "finished") {
    els["action-kicker"].textContent = state.endReason === "queen" ? "夜后售出" : "泡沫破裂";
    els["action-title"].textContent = `${state.winnerIds.map(playerName).join("、")}获胜`;
    els["action-text"].textContent = state.endReason === "queen" ? "胜者支付 ƒ120，买下终极藏品。" : state.finalScores.map((score) => `${playerName(score.playerId)} ${money(score.cash)} − 债务 ${money(score.debt)} = ${money(score.score)}`).join("；");
  }
}

function renderGame() {
  finishAuctionFeedback({ preservePending: pendingAuctionCompletion?.revision === state.revision });
  finishMarketEventReveal();
  finishSupplySettlement();
  finishPriceTransition();
  finishPurchaseTransition();
  finishSaleTransition();
  finishMarketTransition();
  const incomingTransfer = captureIncomingTransfer(state);
  els["setup-screen"].classList.add("hidden");
  els.tabletop.classList.remove("hidden");
  els["room-ribbon"].classList.remove("hidden");
  els["reset-game"].classList.remove("hidden");
  els["table-room-code"].textContent = session.roomCode;
  els["round-label"].textContent = `第 ${state.round} 轮 · 起始：${playerName(state.startPlayer)}`;
  els["phase-label"].textContent = PHASE_LABELS[state.phase];
  els["active-player"].textContent = state.activePlayer === null ? "银行与交易所" : `${playerName(state.activePlayer)}${isMyTurn() ? " · 你的行动" : ""}`;
  renderPhaseTimeline();
  renderEvent();
  renderPrices();
  renderMarketRow(els["incoming-row"], state.incoming, "incoming");
  renderMarketRow(els["stock-row"], state.stock, "stock");
  renderMarketRow(els["sold-row"], state.sold, "sold");
  if (pendingMarketEventPresentation) pendingMarketEventPresentation.incomingTransfer = incomingTransfer;
  else animateIncomingTransfer(incomingTransfer);
  renderSupplyExplainer();
  renderCollectors();
  renderPlayers();
  renderActionDock();
  els["game-log"].innerHTML = state.log.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("");
  els["buy-queen"].disabled = true;
  els["buy-queen"].textContent = state.phase === "queen-check" ? "正在秘密核对资格" : "购买窗口：买入阶段开始时";
  renderRequiredChoice();
}

function render() {
  if (!session || !state) return renderEntry();
  setConnection("online", "已同步");
  if (!state.started) renderLobby();
  else renderGame();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function chooseCollectorSet(bonus) {
  if (!isMyTurn() || state.phase !== "sell") return;
  const collector = state.collectors[bonus];
  const sets = findCollectorSets(viewer().hand.filter(Boolean), collector.id);
  if (!sets.length) return;
  openChoice(`collector-${bonus}`, {
    kicker: "选择交付组合",
    title: `${collector.name}可接受 ${sets.length} 组藏品`,
    text: "选择要交出的三株郁金香。未选中的牌会继续留在挡板后。",
    actions: [
      ...sets.map((set) => ({
        label: `${set.map((card) => `${COLORS[card.color].short}${card.variety}`).join(" · ")} · 确认交付`,
        action: () => sendAction("collector-sale", { bonus, cardIds: set.map((card) => card.id) }),
      })),
      { label: "取消", action: closeChoice },
    ],
  });
}

function confirmSellCard(cardId) {
  if (!isMyTurn() || state.phase !== "sell") return;
  const card = viewer().hand.find((item) => item?.id === cardId);
  if (!card) return;
  const price = getMarketPrice(card, state.prices);
  openChoice(`sell-${cardId}`, {
    kicker: "出售至市场",
    title: `${COLORS[card.color].name} ${card.variety} · ${money(price)}`,
    text: "确认后，这株郁金香会公开放入“本轮售出”，保留到回合末并参与供需统计；它不会在本轮再次出售或购买。",
    actions: [
      { label: `确认出售 · 收取 ${money(price)}`, primary: true, action: () => sendAction("sell-card", { cardId }) },
      { label: "取消", action: closeChoice },
    ],
  });
}

function loanOptions(cardId, ownerId) {
  if (ownerId !== state.viewerId || state.phase === "finished") return;
  const loan = viewer().financed.find((item) => item.card.id === cardId);
  if (!loan) return;
  const marketPrice = getMarketPrice(loan.card, state.prices);
  const actions = [{ label: `偿还贷款 · ${money(loan.debt)}`, primary: true, disabled: viewer().cash < loan.debt, action: () => sendAction("repay-loan", { ownerId, cardId }) }];
  if (state.phase === "sell" && isMyTurn()) {
    const net = marketPrice - loan.debt;
    actions.push({ label: net >= 0 ? `卖回市场 · 净收 ${money(net)}` : `卖回市场 · 补付 ${money(-net)}`, disabled: viewer().cash + marketPrice < loan.debt, action: () => sendAction("sell-loan", { cardId }) });
  }
  actions.push({ label: "取消", action: closeChoice });
  openChoice(`loan-${cardId}`, { kicker: "公开贷款牌", title: `${COLORS[loan.card.color].name} ${loan.card.variety} · 欠款 ${money(loan.debt)}`, text: `当前市价 ${money(marketPrice)}。偿还后牌进入挡板，并立即取回被锁定的购买标记。`, actions });
}

els["create-mode"].addEventListener("click", () => setMode("create"));
els["join-mode"].addEventListener("click", () => setMode("join"));
els["online-form"].addEventListener("submit", createOrJoin);
els["start-game"].addEventListener("click", () => sendAction("start", { startPlayer: Number(els["start-player"].value) }));
els["copy-room-link"].addEventListener("click", copyInvitation);
els["copy-table-link"].addEventListener("click", copyInvitation);
els["market-lanes"].addEventListener("click", (event) => {
  const card = event.target.closest("[data-card-id]");
  if (card?.dataset.lane === "stock") sendAction("place-bid", { cardId: card.dataset.cardId });
});
els.players.addEventListener("click", (event) => {
  const ledgerToggle = event.target.closest("[data-player-toggle]");
  if (ledgerToggle) {
    const playerId = Number(ledgerToggle.dataset.playerToggle);
    if (expandedLedgers.has(playerId)) expandedLedgers.delete(playerId);
    else expandedLedgers.add(playerId);
    renderPlayers();
    return;
  }
  const handCard = event.target.closest("[data-hand-card]");
  if (handCard) confirmSellCard(handCard.dataset.handCard);
  const loanCard = event.target.closest("[data-loan-card]");
  if (loanCard) loanOptions(loanCard.dataset.loanCard, Number(loanCard.dataset.loanOwner));
});
els.collectors.addEventListener("click", (event) => {
  const button = event.target.closest("[data-collector]");
  if (button) chooseCollectorSet(Number(button.dataset.collector));
});
els["next-button"].addEventListener("click", () => {
  if (state.phase === "resolve" && state.auction) sendAction("auction-bid", { amount: Number(els["bid-amount"].value) });
  else sendAction("end-turn");
});
els["pass-button"].addEventListener("click", () => sendAction("auction-pass"));
els["rules-button"].addEventListener("click", () => els["rules-dialog"].showModal());
els["close-rules"].addEventListener("click", () => els["rules-dialog"].close());
els["rules-dialog"].addEventListener("click", (event) => { if (event.target === els["rules-dialog"]) els["rules-dialog"].close(); });
els["choice-dialog"].addEventListener("cancel", (event) => event.preventDefault());
els["reset-game"].addEventListener("click", () => {
  if (!window.confirm("离开当前联机房间？游戏开市后将无法重新加入这个座位。")) return;
  saveSession(null);
  state = null;
  history.replaceState({}, "", location.pathname);
  renderEntry();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && session) schedulePoll(0); });

const requestedRoom = new URLSearchParams(location.search).get("room")?.trim().toUpperCase();
session = loadSession();
if (session && requestedRoom && session.roomCode !== requestedRoom) saveSession(null);
if (!session && requestedRoom) {
  setMode("join");
  els["room-code"].value = requestedRoom;
}
renderEntry();
if (session) {
  setConnection("syncing", "正在连接");
  pollState();
}
