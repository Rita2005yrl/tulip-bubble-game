import assert from "node:assert/strict";
import { addPlayer, createLobby, createPlayerView, performAction } from "./game-engine.js";
import { getMarketPrice } from "./rules.js";

const lobby = createLobby("房主", 3);
assert.equal(lobby.players.length, 1);
assert.equal(addPlayer(lobby, "玩家乙"), 1);
assert.equal(addPlayer(lobby, "玩家丙"), 2);
assert.throws(() => addPlayer(lobby, "玩家丁"), /人数已满/);

performAction(lobby, 0, "start", { startPlayer: 1 });
assert.equal(lobby.started, true);
assert.equal(lobby.playerCount, 3);
assert.equal(lobby.marketSize, 5);
assert.equal(lobby.phase, "sell");
assert.equal(lobby.activePlayer, 1);
assert.equal(lobby.incoming.length, 5);
assert.equal(lobby.stock.length, 5);
assert.equal(lobby.sold.length, 0);

const privateCard = { id: "private", color: "red", rank: "C", variety: "C1", bids: [] };
lobby.players[1].hand.push(privateCard);
lobby.players[1].cash = 37;
const ownerView = createPlayerView(lobby, 1);
const rivalView = createPlayerView(lobby, 2);
assert.equal(ownerView.players[1].cash, 37);
assert.equal(ownerView.players[1].hand[0].id, "private");
assert.equal(rivalView.players[1].cash, null);
assert.equal(rivalView.players[1].hand[0].id, "private");
assert.equal("deck" in rivalView, false);
assert.equal("eventDeck" in rivalView, false);

lobby.currentPurchase = { cardId: lobby.stock[0].id, lane: "stock", winnerId: 0, price: 42, marketPrice: 3, participants: [0, 1] };
const loserPurchaseView = createPlayerView(lobby, 1);
assert.equal(loserPurchaseView.currentPurchase.price, undefined);
lobby.currentPurchase = null;

performAction(lobby, 1, "end-turn");
performAction(lobby, 2, "end-turn");
performAction(lobby, 0, "end-turn");
assert.equal(lobby.phase, "bid");
assert.equal(lobby.activePlayer, 1);

const firstCard = lobby.stock[0];
performAction(lobby, 1, "place-bid", { cardId: firstCard.id });
assert.deepEqual(firstCard.bids, [1]);
assert.throws(() => performAction(lobby, 2, "place-bid", { cardId: lobby.stock[1].id }), /不是你的行动/);
assert.throws(() => performAction(lobby, 1, "place-bid", { cardId: firstCard.id }), /重复标记/);
assert.throws(() => performAction(lobby, 1, "place-bid", { cardId: lobby.incoming[0].id }), /只能在市场现货/);

performAction(lobby, 1, "end-turn");
assert.equal(lobby.activePlayer, 2);

lobby.sold.push({ id: "sold-red", color: "red", rank: "C", variety: "C2", bids: [] });
lobby.phase = "supply";
lobby.activePlayer = null;
lobby.supplyResult = { counts: { red: 1, yellow: 1, white: 1 }, rising: [], falling: [], prices: lobby.prices };
const nextStockIds = lobby.incoming.map((card) => card.id);
performAction(lobby, 0, "end-turn");
assert.equal(lobby.phase, "cleanup");
assert.equal(lobby.stock.length, 0);
assert.equal(lobby.sold.length, 0);
const previousRound = lobby.round;
performAction(lobby, 0, "end-turn");
assert.equal(lobby.round, previousRound + 1);
assert.equal(lobby.phase, "sell");
assert.notEqual(lobby.activePlayer, null);
assert.deepEqual(lobby.stock.map((card) => card.id), nextStockIds);
assert.equal(lobby.incoming.length, 5);

const fivePlayerLobby = createLobby("五人房主", 5);
for (const name of ["乙", "丙", "丁", "戊"]) addPlayer(fivePlayerLobby, name);
performAction(fivePlayerLobby, 0, "start", { startPlayer: 0 });
assert.equal(fivePlayerLobby.marketSize, 7);
assert.equal(fivePlayerLobby.stock.length, 7);
assert.equal(fivePlayerLobby.incoming.length, 7);
assert.equal(fivePlayerLobby.sold.length, 0);

const saleLobby = createLobby("卖方", 3);
addPlayer(saleLobby, "买方乙");
addPlayer(saleLobby, "买方丙");
performAction(saleLobby, 0, "start", { startPlayer: 0 });
const saleCard = { id: "repeat-sale-proof", color: "red", rank: "C", variety: "C1", bids: [] };
saleLobby.players[0].hand.push(saleCard);
const cashBeforeSale = saleLobby.players[0].cash;
const saleIncome = getMarketPrice(saleCard, saleLobby.prices);
performAction(saleLobby, 0, "sell-card", { cardId: saleCard.id });
assert.equal(saleLobby.players[0].cash, cashBeforeSale + saleIncome);
assert.deepEqual(saleLobby.sold.map((card) => card.id), [saleCard.id]);
assert.throws(() => performAction(saleLobby, 0, "sell-card", { cardId: saleCard.id }), /手牌不存在/);
assert.equal(saleLobby.players[0].cash, cashBeforeSale + saleIncome);
assert.deepEqual(saleLobby.sold.map((card) => card.id), [saleCard.id]);

const purchaseLobby = createLobby("买方", 3);
addPlayer(purchaseLobby, "贷款买方");
addPlayer(purchaseLobby, "旁观者");
performAction(purchaseLobby, 0, "start", { startPlayer: 0 });
const cashPurchaseCard = purchaseLobby.stock[0];
purchaseLobby.phase = "resolve";
purchaseLobby.activePlayer = 0;
purchaseLobby.currentPurchase = { cardId: cashPurchaseCard.id, lane: "stock", winnerId: 0, price: 5, marketPrice: 5, participants: [0] };
performAction(purchaseLobby, 0, "complete-purchase", { method: "cash" });
assert.equal(purchaseLobby.players[0].cash, 15);
assert.equal(purchaseLobby.players[0].hand.some((card) => card.id === cashPurchaseCard.id), true);
assert.equal(purchaseLobby.stock.some((card) => card.id === cashPurchaseCard.id), false);

const financedPurchaseCard = purchaseLobby.stock[0];
const financedBuyerCash = purchaseLobby.players[1].cash;
purchaseLobby.phase = "resolve";
purchaseLobby.activePlayer = 1;
purchaseLobby.currentPurchase = { cardId: financedPurchaseCard.id, lane: "stock", winnerId: 1, price: 28, marketPrice: 5, participants: [1] };
performAction(purchaseLobby, 1, "complete-purchase", { method: "finance" });
assert.equal(purchaseLobby.players[1].cash, financedBuyerCash);
assert.equal(purchaseLobby.players[1].financed[0].card.id, financedPurchaseCard.id);
assert.equal(purchaseLobby.players[1].financed[0].debt, 28);
assert.equal(purchaseLobby.stock.some((card) => card.id === financedPurchaseCard.id), false);
const purchaseObserverView = createPlayerView(purchaseLobby, 2);
assert.equal(purchaseObserverView.players[1].cash, null);
assert.equal(purchaseObserverView.players[1].financed[0].card.id, financedPurchaseCard.id);

const supplyLobby = createLobby("供需房主", 3);
addPlayer(supplyLobby, "供需乙");
addPlayer(supplyLobby, "供需丙");
performAction(supplyLobby, 0, "start", { startPlayer: 0 });
for (const playerId of [0, 1, 2]) performAction(supplyLobby, playerId, "end-turn");
const soldForSupply = { id: "supply-sale", color: "red", rank: "C", variety: "C3", bids: [] };
supplyLobby.sold.push(soldForSupply);
assert.throws(() => performAction(supplyLobby, 0, "place-bid", { cardId: soldForSupply.id }), /只能在市场现货/);
const countedBeforeSupply = [...supplyLobby.incoming, ...supplyLobby.stock, ...supplyLobby.sold]
  .reduce((counts, card) => ({ ...counts, [card.color]: counts[card.color] + 1 }), { red: 0, yellow: 0, white: 0 });
while (supplyLobby.phase === "bid") performAction(supplyLobby, supplyLobby.activePlayer, "end-turn");
assert.equal(supplyLobby.phase, "supply");
assert.deepEqual(supplyLobby.supplyResult.counts, countedBeforeSupply);

console.log("Online engine: V1.1 market flow, visibility, authorization and bid assertions passed.");
