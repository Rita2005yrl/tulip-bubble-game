import {
  COLOR_IDS,
  applySupplyAdjustment,
  clockwiseOrder,
  createCollectorMarket,
  createEventDeck,
  createInitialPrices,
  createTulipDeck,
  findCollectorSets,
  getMarketPrice,
  movePriceMarkers,
  orderParticipants,
  shuffle,
} from "./rules.js";

const COLORS = {
  red: { name: "红色", short: "红" },
  yellow: { name: "黄色", short: "黄" },
  white: { name: "白色", short: "白" },
};

const PLAYER_COLORS = ["#a62d32", "#315f87", "#c18d21", "#31705a", "#74537d"];
const MARKER_SHAPES = ["coin", "diamond", "shield", "hex", "octagon"];

function money(value) {
  return `ƒ${value}`;
}

function cleanName(value, fallback) {
  const name = String(value ?? "").trim().replace(/[<>]/g, "").slice(0, 12);
  return name || fallback;
}

export function createLobby(hostName, maxPlayers = 3) {
  const count = Math.min(5, Math.max(3, Number(maxPlayers) || 3));
  return {
    started: false,
    maxPlayers: count,
    players: [{
      id: 0,
      name: cleanName(hostName, "房主"),
      color: PLAYER_COLORS[0],
      shape: MARKER_SHAPES[0],
      connectedAt: Date.now(),
      cash: 20,
      hand: [],
      financed: [],
      collectorSold: false,
    }],
    round: 0,
    phase: "lobby",
    revision: 1,
    log: ["房间已经建立，等待商人入场。"],
  };
}

export function addPlayer(state, name) {
  if (state.started) throw new Error("市场已经开市，无法加入");
  if (state.players.length >= state.maxPlayers) throw new Error("房间人数已满");
  const id = state.players.length;
  state.players.push({
    id,
    name: cleanName(name, `玩家 ${id + 1}`),
    color: PLAYER_COLORS[id],
    shape: MARKER_SHAPES[id],
    connectedAt: Date.now(),
    cash: 20,
    hand: [],
    financed: [],
    collectorSold: false,
  });
  addLog(state, `${state.players[id].name}进入了花市。`);
  state.revision += 1;
  return id;
}

function addLog(state, message) {
  state.log.unshift(message);
  state.log = state.log.slice(0, 18);
}

function playerName(state, playerId) {
  return state.players[playerId]?.name ?? `玩家 ${playerId + 1}`;
}

function drawCards(state, count) {
  const cards = [];
  while (cards.length < count) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) break;
      state.deck = shuffle(state.discard.map((card) => ({ ...card, bids: [] })));
      state.discard = [];
      addLog(state, "弃牌堆重新洗成郁金香牌堆。");
    }
    cards.push({ ...state.deck.pop(), bids: [] });
  }
  return cards;
}

export function startGame(state, startPlayer = 0) {
  if (state.started) throw new Error("游戏已经开始");
  if (state.players.length < 3) throw new Error("至少需要 3 位玩家才能开市");
  const eventSetup = createEventDeck();
  const collectorSetup = createCollectorMarket();
  const playerCount = state.players.length;
  const starter = Math.min(playerCount - 1, Math.max(0, Number(startPlayer) || 0));

  Object.assign(state, {
    started: true,
    playerCount,
    round: 1,
    phase: "event",
    prices: createInitialPrices(),
    deck: createTulipDeck(),
    discard: [],
    incoming: [],
    stock: [],
    sold: [],
    eventDeck: eventSetup.deck,
    removedEvent: eventSetup.removed,
    eventHistory: [],
    currentEvent: null,
    collectorStacks: collectorSetup.stacks,
    collectors: collectorSetup.faceUp,
    startPlayer: starter,
    activePlayer: null,
    turnOrder: [],
    turnIndex: 0,
    bidPass: 1,
    placementsThisTurn: 0,
    resolveQueue: [],
    currentPurchase: null,
    auction: null,
    supplyResult: null,
    queenCheck: null,
    winnerIds: [],
    finalScores: [],
    endReason: "",
    loanInterrupt: null,
  });
  state.players.forEach((player) => Object.assign(player, {
    cash: 20,
    hand: [],
    financed: [],
    collectorSold: false,
  }));

  const marketSize = playerCount + 2;
  state.marketSize = marketSize;
  state.incoming = drawCards(state, marketSize);
  state.stock = drawCards(state, marketSize);
  state.sold = [];
  revealMarketEvent(state, state.eventDeck.pop(), true);
  addLog(state, `开市：每位商人领取 ${money(20)} 与 3 枚购买标记。`);
  addLog(state, `初始市场公开 ${marketSize} 株现货与 ${marketSize} 株即将进货。`);
  beginSellPhase(state);
}

function revealMarketEvent(state, event, opening = false) {
  state.currentEvent = event;
  state.eventHistory.push(event);
  if (event.type === "burst") {
    finishByBurst(state);
    return false;
  }
  if (event.type === "rise") {
    state.prices = movePriceMarkers(state.prices, [event.color], 1);
    addLog(state, `${COLORS[event.color].name}郁金香行情上涨。`);
  } else if (event.type === "surge") {
    const lowest = Math.min(...COLOR_IDS.map((color) => state.prices[color]));
    const colors = COLOR_IDS.filter((color) => state.prices[color] === lowest);
    state.prices = movePriceMarkers(state.prices, colors, 2);
    addLog(state, `${colors.map((color) => COLORS[color].short).join("、")}色低价品种暴涨两级。`);
  } else if (event.type === "crash") {
    const highest = Math.max(...COLOR_IDS.map((color) => state.prices[color]));
    const colors = COLOR_IDS.filter((color) => state.prices[color] === highest);
    state.prices = movePriceMarkers(state.prices, colors, -2);
    addLog(state, `${colors.map((color) => COLORS[color].short).join("、")}色高价品种暴跌两级。`);
  }
  if (opening) addLog(state, `开局事件：${event.title}。事件调价完成后进入出售阶段。`);
  return true;
}

function activatePlayer(state, playerId) {
  state.activePlayer = playerId;
}

function beginSellPhase(state) {
  state.phase = "sell";
  state.players.forEach((player) => { player.collectorSold = false; });
  state.turnOrder = clockwiseOrder(state.playerCount, state.startPlayer);
  state.turnIndex = 0;
  activatePlayer(state, state.turnOrder[0]);
}

function beginQueenCheck(state) {
  state.phase = "queen-check";
  const eligible = state.players
    .filter((player) => player.cash >= 120 && player.financed.length === 0)
    .map((player) => player.id);
  if (eligible.length === 0) {
    beginBidPlacement(state);
    return;
  }
  state.queenCheck = { eligible, declarations: [], index: 0 };
  activatePlayer(state, eligible[0]);
}

function beginBidPlacement(state) {
  state.phase = "bid";
  state.queenCheck = null;
  state.bidPass = 1;
  state.turnOrder = clockwiseOrder(state.playerCount, state.startPlayer);
  state.turnIndex = 0;
  state.placementsThisTurn = 0;
  activatePlayer(state, state.turnOrder[0]);
}

function findMarketCard(state, cardId) {
  for (const lane of ["incoming", "stock", "sold"]) {
    const index = state[lane].findIndex((card) => card.id === cardId);
    if (index >= 0) return { lane, index, card: state[lane][index] };
  }
  return null;
}

function allMarketCards(state) {
  return [...state.incoming, ...state.stock, ...state.sold];
}

function placedMarkerCount(state, playerId) {
  return allMarketCards(state).reduce(
    (total, card) => total + card.bids.filter((bidder) => bidder === playerId).length,
    0,
  );
}

function availableMarkerCount(state, playerId) {
  return Math.max(0, 3 - state.players[playerId].financed.length - placedMarkerCount(state, playerId));
}

function beginResolution(state) {
  state.phase = "resolve";
  state.activePlayer = null;
  state.resolveQueue = [
    ...state.stock.map((card) => ({ lane: "stock", cardId: card.id })),
  ];
  state.currentPurchase = null;
  state.auction = null;
  resolveNextCard(state);
}

function resolveNextCard(state) {
  if (state.phase !== "resolve" || state.currentPurchase || state.auction) return;
  while (state.resolveQueue.length > 0) {
    const item = state.resolveQueue.shift();
    const marketCard = findMarketCard(state, item.cardId);
    if (!marketCard || marketCard.card.bids.length === 0) continue;
    if (marketCard.card.bids.length === 1) {
      const winnerId = marketCard.card.bids[0];
      preparePurchase(state, marketCard, winnerId, getMarketPrice(marketCard.card, state.prices), [winnerId]);
      return;
    }
    startAuction(state, marketCard);
    return;
  }
  beginSupplyAdjustment(state);
}

function startAuction(state, marketCard) {
  const participants = orderParticipants(marketCard.card.bids, state.playerCount, state.startPlayer);
  state.auction = {
    cardId: marketCard.card.id,
    lane: marketCard.lane,
    participants,
    passed: [],
    leader: null,
    currentBid: getMarketPrice(marketCard.card, state.prices),
    currentPlayer: participants[0],
  };
  activatePlayer(state, participants[0]);
}

function activeAuctionPlayers(state) {
  const passed = new Set(state.auction.passed);
  return state.auction.participants.filter((playerId) => !passed.has(playerId));
}

function nextAuctionPlayer(state, currentPlayer) {
  const active = new Set(activeAuctionPlayers(state));
  const order = state.auction.participants;
  const start = order.indexOf(currentPlayer);
  for (let offset = 1; offset <= order.length; offset += 1) {
    const candidate = order[(start + offset) % order.length];
    if (active.has(candidate)) return candidate;
  }
  return null;
}

function preparePurchase(state, marketCard, winnerId, price, participants) {
  state.currentPurchase = {
    cardId: marketCard.card.id,
    lane: marketCard.lane,
    winnerId,
    price,
    marketPrice: getMarketPrice(marketCard.card, state.prices),
    participants: [...participants],
  };
  activatePlayer(state, winnerId);
}

function beginSupplyAdjustment(state) {
  state.phase = "supply";
  state.activePlayer = null;
  const beforePrices = { ...state.prices };
  const countedCards = [...state.incoming, ...state.stock, ...state.sold];
  state.supplyResult = {
    ...applySupplyAdjustment(state.prices, countedCards),
    beforePrices,
  };
  state.prices = state.supplyResult.prices;
  const { counts, rising, falling } = state.supplyResult;
  if (rising.length === 0 && falling.length === 0) {
    addLog(state, `供需调整：三色供应均为 ${counts.red}，行情不变。`);
  } else {
    addLog(state, `供需调整：${falling.map((color) => COLORS[color].short).join("、")}色供应最多降价；${rising.map((color) => COLORS[color].short).join("、")}色供应最少涨价。`);
  }
}

function finishByBurst(state) {
  const scores = state.players.map((player) => ({
    playerId: player.id,
    cash: player.cash,
    debt: player.financed.reduce((total, loan) => total + loan.debt, 0),
    score: player.cash - player.financed.reduce((total, loan) => total + loan.debt, 0),
  }));
  const best = Math.max(...scores.map((score) => score.score));
  finishGame(state, scores.filter((score) => score.score === best).map((score) => score.playerId), "burst", scores);
}

function finishGame(state, winnerIds, reason, scores = []) {
  state.phase = "finished";
  state.activePlayer = null;
  state.winnerIds = winnerIds;
  state.endReason = reason;
  state.finalScores = scores;
  state.currentPurchase = null;
  state.auction = null;
  if (reason === "queen") addLog(state, `${winnerIds.map((id) => playerName(state, id)).join("、")}买下“夜后”，立即获胜。`);
  else addLog(state, `泡沫破裂。${winnerIds.map((id) => playerName(state, id)).join("、")}以最高净现金获胜。`);
}

function requireTurn(state, playerId) {
  if (state.activePlayer !== playerId) throw new Error("现在不是你的行动");
}

function applyAction(state, playerId, type, payload) {
  const player = state.players[playerId];
  if (!player) throw new Error("玩家不存在");

  if (type === "start") {
    if (playerId !== 0) throw new Error("只有房主可以开市");
    startGame(state, payload.startPlayer);
    return;
  }
  if (!state.started) throw new Error("等待房主开市");

  if (type === "place-bid") {
    requireTurn(state, playerId);
    if (state.phase !== "bid") throw new Error("当前不是摆标阶段");
    const marketCard = findMarketCard(state, payload.cardId);
    if (!marketCard || marketCard.lane !== "stock") throw new Error("只能在市场现货上落标");
    const turnLimit = state.bidPass === 1 ? 2 : 1;
    if (state.placementsThisTurn >= turnLimit) throw new Error(`本轮最多放置 ${turnLimit} 枚标记`);
    if (availableMarkerCount(state, playerId) === 0) throw new Error("没有可用购买标记");
    if (marketCard.card.bids.includes(playerId)) throw new Error("不能重复标记同一株郁金香");
    marketCard.card.bids.push(playerId);
    state.placementsThisTurn += 1;
    addLog(state, `${player.name}在${COLORS[marketCard.card.color].name} ${marketCard.card.variety} 上放置标记。`);
    return;
  }

  if (type === "end-turn") {
    if (state.phase === "supply") {
      if (playerId !== 0) throw new Error("等待房主确认供需调整");
      state.cleanupSummary = {
        stock: state.stock.length,
        sold: state.sold.length,
      };
      state.discard.push(
        ...state.stock.map((card) => ({ ...card, bids: [] })),
        ...state.sold.map((card) => ({ ...card, bids: [] })),
      );
      state.stock = [];
      state.sold = [];
      state.phase = "cleanup";
      state.activePlayer = null;
      addLog(state, `清理：移走 ${state.cleanupSummary.stock} 株剩余现货与 ${state.cleanupSummary.sold} 株本轮售出。`);
      return;
    }
    if (state.phase === "cleanup") {
      if (playerId !== 0) throw new Error("等待房主翻开下一轮事件");
      state.round += 1;
      state.phase = "event";
      state.supplyResult = null;
      state.cleanupSummary = null;
      const event = state.eventDeck.pop();
      if (!event) finishByBurst(state);
      else if (revealMarketEvent(state, event)) {
        state.stock = state.incoming.map((card) => ({ ...card, bids: [] }));
        state.incoming = drawCards(state, state.marketSize ?? state.playerCount + 2);
        state.startPlayer = (state.startPlayer + 1) % state.playerCount;
        addLog(state, `第 ${state.round} 轮到货，起始玩家交给${playerName(state, state.startPlayer)}。`);
        beginSellPhase(state);
      }
      return;
    }
    requireTurn(state, playerId);
    if (state.phase === "sell") {
      state.turnIndex += 1;
      if (state.turnIndex >= state.turnOrder.length) beginQueenCheck(state);
      else activatePlayer(state, state.turnOrder[state.turnIndex]);
      return;
    }
    if (state.phase === "bid") {
      state.turnIndex += 1;
      state.placementsThisTurn = 0;
      if (state.turnIndex < state.turnOrder.length) activatePlayer(state, state.turnOrder[state.turnIndex]);
      else if (state.bidPass === 1) {
        state.bidPass = 2;
        state.turnIndex = 0;
        activatePlayer(state, state.turnOrder[0]);
      } else beginResolution(state);
      return;
    }
    throw new Error("当前不能结束行动");
  }

  if (type === "queen-decision") {
    requireTurn(state, playerId);
    if (state.phase !== "queen-check" || !state.queenCheck) throw new Error("当前没有夜后购买窗口");
    const check = state.queenCheck;
    if (check.eligible[check.index] !== playerId) throw new Error("还没轮到你决定");
    if (payload.declare) check.declarations.push(playerId);
    check.index += 1;
    if (check.index < check.eligible.length) activatePlayer(state, check.eligible[check.index]);
    else if (check.declarations.length === 0) beginBidPlacement(state);
    else {
      const richest = Math.max(...check.declarations.map((id) => state.players[id].cash));
      const winners = check.declarations.filter((id) => state.players[id].cash === richest);
      winners.forEach((id) => { state.players[id].cash -= 120; });
      finishGame(state, winners, "queen");
    }
    return;
  }

  if (type === "auction-bid") {
    requireTurn(state, playerId);
    const auction = state.auction;
    if (state.phase !== "resolve" || !auction) throw new Error("当前没有竞拍");
    const amount = Number(payload.amount);
    if (!Number.isInteger(amount) || amount < auction.currentBid + 1) throw new Error(`出价至少为 ${money(auction.currentBid + 1)}`);
    const canPayCash = player.cash >= amount;
    const canFinance = player.financed.length < 3;
    if (!canPayCash && !canFinance) throw new Error("现金不足且三枚购买标记都已被贷款锁定");
    auction.currentBid = amount;
    auction.leader = playerId;
    addLog(state, `${player.name}将出价提高至 ${money(amount)}。`);
    auction.currentPlayer = nextAuctionPlayer(state, playerId);
    activatePlayer(state, auction.currentPlayer);
    return;
  }

  if (type === "auction-pass") {
    requireTurn(state, playerId);
    const auction = state.auction;
    if (state.phase !== "resolve" || !auction) throw new Error("当前没有竞拍");
    auction.passed.push(playerId);
    addLog(state, `${player.name}退出本次竞拍。`);
    const active = activeAuctionPlayers(state);
    if (active.length === 1) {
      const winnerId = active[0];
      const marketCard = findMarketCard(state, auction.cardId);
      const price = auction.leader === null ? getMarketPrice(marketCard.card, state.prices) : auction.currentBid;
      const participants = [...auction.participants];
      state.auction = null;
      preparePurchase(state, marketCard, winnerId, price, participants);
    } else {
      auction.currentPlayer = nextAuctionPlayer(state, playerId);
      activatePlayer(state, auction.currentPlayer);
    }
    return;
  }

  if (type === "complete-purchase") {
    requireTurn(state, playerId);
    const purchase = state.currentPurchase;
    if (!purchase || purchase.winnerId !== playerId) throw new Error("当前没有待付款成交");
    const marketCard = findMarketCard(state, purchase.cardId);
    if (!marketCard) throw new Error("成交牌不存在");
    const cleanCard = { ...marketCard.card, bids: [] };
    if (payload.method === "cash") {
      if (player.cash < purchase.price) throw new Error("现金不足，只能全额融资");
      player.cash -= purchase.price;
      player.hand.push(cleanCard);
      addLog(state, `${player.name}支付 ${money(purchase.price)}，将 ${cleanCard.variety} 收入挡板后。`);
    } else if (payload.method === "finance") {
      if (player.financed.length >= 3) throw new Error("三枚购买标记都已被贷款锁定，不能继续融资");
      player.financed.push({ card: cleanCard, debt: purchase.price });
      addLog(state, `${player.name}以 ${money(purchase.price)} 全额融资，锁定 1 枚购买标记。`);
    } else throw new Error("付款方式无效");
    if (purchase.participants.length > 1) {
      const losers = purchase.participants.filter((id) => id !== playerId);
      const compensation = Math.floor((purchase.price - purchase.marketPrice) / losers.length);
      if (compensation > 0) {
        losers.forEach((id) => { state.players[id].cash += compensation; });
        addLog(state, `银行向每位落败竞标者补偿 ${money(compensation)}。`);
      }
    }
    state[marketCard.lane].splice(marketCard.index, 1);
    state.currentPurchase = null;
    resolveNextCard(state);
    return;
  }

  if (type === "sell-card") {
    requireTurn(state, playerId);
    if (state.phase !== "sell") throw new Error("只能在出售阶段卖牌");
    const index = player.hand.findIndex((card) => card.id === payload.cardId);
    if (index < 0) throw new Error("手牌不存在");
    const [card] = player.hand.splice(index, 1);
    const price = getMarketPrice(card, state.prices);
    player.cash += price;
    state.sold.push({ ...card, bids: [] });
    addLog(state, `${player.name}以市价 ${money(price)} 卖出 ${COLORS[card.color].name} ${card.variety}。`);
    return;
  }

  if (type === "collector-sale") {
    requireTurn(state, playerId);
    if (state.phase !== "sell" || player.collectorSold) throw new Error("本轮不能交付收藏家委托");
    const bonus = Number(payload.bonus);
    const collector = state.collectors[bonus];
    if (!collector) throw new Error("收藏家不存在");
    const wanted = new Set(Array.isArray(payload.cardIds) ? payload.cardIds : []);
    const set = findCollectorSets(player.hand, collector.id).find((cards) => (
      cards.length === wanted.size && cards.every((card) => wanted.has(card.id))
    ));
    if (!set) throw new Error("这组郁金香不符合委托");
    const total = set.reduce((sum, card) => sum + getMarketPrice(card, state.prices), 0) + collector.bonus;
    const ids = new Set(set.map((card) => card.id));
    player.hand = player.hand.filter((card) => !ids.has(card.id));
    player.cash += total;
    player.collectorSold = true;
    state.discard.push(...set.map((card) => ({ ...card, bids: [] })));
    state.collectors[bonus] = state.collectorStacks[bonus].pop() ?? null;
    addLog(state, `${player.name}完成${collector.name}的委托，收入 ${money(total)}。`);
    return;
  }

  if (type === "repay-loan") {
    const ownerId = Number(payload.ownerId);
    if (ownerId !== playerId) throw new Error("只能处理自己的贷款");
    const index = player.financed.findIndex((loan) => loan.card.id === payload.cardId);
    const loan = player.financed[index];
    if (!loan || player.cash < loan.debt) throw new Error("现金不足以偿还贷款");
    player.cash -= loan.debt;
    player.hand.push(loan.card);
    player.financed.splice(index, 1);
    addLog(state, `${player.name}偿还 ${money(loan.debt)}，取回一枚购买标记。`);
    return;
  }

  if (type === "sell-loan") {
    requireTurn(state, playerId);
    if (state.phase !== "sell") throw new Error("只能在出售阶段卖出贷款牌");
    const index = player.financed.findIndex((loan) => loan.card.id === payload.cardId);
    const loan = player.financed[index];
    if (!loan) throw new Error("贷款牌不存在");
    const marketPrice = getMarketPrice(loan.card, state.prices);
    if (player.cash + marketPrice < loan.debt) throw new Error("现金不足以补足贷款差额");
    player.cash += marketPrice - loan.debt;
    player.financed.splice(index, 1);
    state.sold.push({ ...loan.card, bids: [] });
    addLog(state, `${player.name}卖出贷款牌并偿还 ${money(loan.debt)}。`);
    return;
  }

  throw new Error("未知操作");
}

export function performAction(state, playerId, type, payload = {}) {
  applyAction(state, playerId, type, payload);
  state.revision = (state.revision ?? 0) + 1;
  return state;
}

export function createPlayerView(state, viewerId) {
  const view = structuredClone(state);
  delete view.deck;
  delete view.discard;
  delete view.eventDeck;
  delete view.removedEvent;
  delete view.collectorStacks;
  view.deckCount = state.deck?.length ?? 0;
  view.discardCount = state.discard?.length ?? 0;
  view.collectorCounts = Object.fromEntries([10, 15, 20].map((bonus) => [bonus, state.collectorStacks?.[bonus]?.length ?? 0]));
  view.viewerId = viewerId;
  view.queenCheck = state.queenCheck
    ? { pending: state.queenCheck.eligible.length - state.queenCheck.index }
    : null;
  view.players = state.players.map((player) => ({
    ...player,
    cash: player.id === viewerId || state.phase === "finished" ? player.cash : null,
    hand: player.hand,
  }));
  if (view.currentPurchase && view.currentPurchase.winnerId !== viewerId) {
    view.currentPurchase = {
      cardId: view.currentPurchase.cardId,
      lane: view.currentPurchase.lane,
      winnerId: view.currentPurchase.winnerId,
    };
  }
  return view;
}
