import assert from "node:assert/strict";
import {
  COLLECTOR_DEFINITIONS,
  PRICE_TABLE,
  applySupplyAdjustment,
  createEventDeck,
  createInitialPrices,
  createTulipDeck,
  findCollectorSet,
  findCollectorSets,
  matchesCollector,
  movePriceMarkers,
  orderParticipants,
} from "./rules.js";

const deck = createTulipDeck(() => 0.37);
assert.equal(deck.length, 51, "传统牌组应有 51 张郁金香牌");
for (const color of ["red", "yellow", "white"]) {
  const colorCards = deck.filter((card) => card.color === color);
  assert.equal(colorCards.length, 17);
  assert.equal(colorCards.filter((card) => card.variety === "A").length, 2);
  for (const variety of ["B1", "B2", "C1", "C2", "C3"]) {
    assert.equal(colorCards.filter((card) => card.variety === variety).length, 3);
  }
}

assert.deepEqual(PRICE_TABLE.A, [15, 15, 15, 20, 26, 33, 40]);
assert.deepEqual(PRICE_TABLE.B, [3, 5, 7, 10, 13, 16, 20]);
assert.deepEqual(PRICE_TABLE.C, [1, 3, 5, 7, 9, 11, 13]);

assert.deepEqual(
  Object.values(createInitialPrices(() => 0.27)).sort((left, right) => left - right),
  [1, 2, 3],
  "三色价格标记应随机占据 II、III、IV",
);
assert.deepEqual(
  [10, 15, 20].map((bonus) => COLLECTOR_DEFINITIONS[bonus].length),
  [4, 3, 1],
  "收藏家牌堆应分别有 4、3、1 张",
);

assert.deepEqual(
  movePriceMarkers({ red: 1, white: 2, yellow: 3 }, ["yellow"], -1),
  { red: 1, white: 2, yellow: 0 },
  "降价应越过已占用格",
);

const supplyCards = [
  ...Array.from({ length: 2 }, (_, index) => ({ id: `r${index}`, color: "red" })),
  ...Array.from({ length: 2 }, (_, index) => ({ id: `w${index}`, color: "white" })),
  ...Array.from({ length: 4 }, (_, index) => ({ id: `y${index}`, color: "yellow" })),
];
const tiedMinimumAdjustment = applySupplyAdjustment({ red: 1, white: 2, yellow: 3 }, supplyCards);
assert.deepEqual(
  tiedMinimumAdjustment.prices,
  { red: 2, white: 3, yellow: 0 },
  "并列供需调整应符合规则书的同步移动示例",
);
assert.deepEqual(tiedMinimumAdjustment.rising, ["red", "white"], "并列最低供应的颜色应全部涨价");
assert.deepEqual(tiedMinimumAdjustment.falling, ["yellow"], "最高供应颜色应完整保留");

const tiedMaximumCards = [
  ...Array.from({ length: 4 }, (_, index) => ({ id: `max-r${index}`, color: "red" })),
  ...Array.from({ length: 4 }, (_, index) => ({ id: `max-y${index}`, color: "yellow" })),
  ...Array.from({ length: 2 }, (_, index) => ({ id: `min-w${index}`, color: "white" })),
];
const tiedMaximumAdjustment = applySupplyAdjustment({ red: 1, yellow: 2, white: 3 }, tiedMaximumCards);
assert.deepEqual(tiedMaximumAdjustment.falling, ["red", "yellow"], "并列最高供应的颜色应全部降价");
assert.deepEqual(tiedMaximumAdjustment.rising, ["white"], "最低供应颜色应完整保留");

const equalSupplyCards = ["red", "yellow", "white"].flatMap((color) => (
  Array.from({ length: 3 }, (_, index) => ({ id: `${color}-${index}`, color }))
));
const balancedAdjustment = applySupplyAdjustment({ red: 1, yellow: 2, white: 3 }, equalSupplyCards);
assert.deepEqual(balancedAdjustment.rising, [], "三色供应相等时不应产生涨价颜色");
assert.deepEqual(balancedAdjustment.falling, [], "三色供应相等时不应产生降价颜色");
assert.deepEqual(balancedAdjustment.prices, { red: 1, yellow: 2, white: 3 }, "供需平衡时价格应保持不变");

const card = (color, variety) => ({ color, variety, rank: variety[0] });
assert(matchesCollector([card("red", "A"), card("red", "B1"), card("red", "B2")], "noble"));
assert(matchesCollector([card("yellow", "C1"), card("yellow", "C2"), card("yellow", "C3")], "housekeeper"));
assert(matchesCollector([card("white", "B1"), card("white", "B1"), card("white", "B2")], "clergyman"));
assert(matchesCollector([card("red", "C2"), card("yellow", "C2"), card("white", "C2")], "scholar"));
assert(matchesCollector([card("red", "B1"), card("yellow", "B2"), card("white", "B1")], "madame"));
assert(matchesCollector([card("red", "C1"), card("red", "C1"), card("red", "C3")], "young-man"));
assert(matchesCollector([card("white", "B1"), card("white", "B2"), card("white", "C3")], "fair-lady"));
assert(matchesCollector([card("red", "C1"), card("yellow", "C3"), card("white", "C1")], "tavern-owner"));
assert.equal(findCollectorSet([card("red", "A"), card("red", "B1"), card("red", "B2")], "noble")?.length, 3);
assert.equal(findCollectorSets([
  card("red", "C1"), card("red", "C1"), card("red", "C2"), card("red", "C3"),
], "housekeeper").length, 2, "多组合法委托应全部交给玩家选择");

const events = createEventDeck(() => 0.41);
assert.equal(events.deck.length, 10, "移除一张后事件牌组应剩 10 张");
assert.equal(events.deck.slice(0, 3).filter((event) => event.type === "burst").length, 1);
assert.notEqual(events.deck.at(-1).type, "burst", "开局翻开的事件不能是泡沫破裂");
const completeEventSet = [...events.deck, events.removed];
assert.deepEqual(
  Object.fromEntries(["rise", "surge", "crash", "burst"].map((type) => [
    type,
    completeEventSet.filter((event) => event.type === type).length,
  ])),
  { rise: 6, surge: 1, crash: 3, burst: 1 },
  "事件牌应为每色上涨各 2、暴涨 1、暴跌 3、泡沫破裂 1",
);
for (const color of ["red", "yellow", "white"]) {
  assert.equal(completeEventSet.filter((event) => event.type === "rise" && event.color === color).length, 2);
}

assert.deepEqual(orderParticipants([0, 3, 1], 5, 3), [3, 0, 1]);

console.log("Traditional rules: all assertions passed.");
