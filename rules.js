export const COLOR_IDS = ["red", "yellow", "white"];

export const PRICE_TABLE = Object.freeze({
  A: Object.freeze([15, 15, 15, 20, 26, 33, 40]),
  B: Object.freeze([3, 5, 7, 10, 13, 16, 20]),
  C: Object.freeze([1, 3, 5, 7, 9, 11, 13]),
});

export const PRICE_LEVEL_NAMES = Object.freeze(["I", "II", "III", "IV", "V", "VI", "VII"]);

export const VARIETY_BLUEPRINT = Object.freeze([
  Object.freeze({ rank: "A", variety: "A", copies: 2 }),
  Object.freeze({ rank: "B", variety: "B1", copies: 3 }),
  Object.freeze({ rank: "B", variety: "B2", copies: 3 }),
  Object.freeze({ rank: "C", variety: "C1", copies: 3 }),
  Object.freeze({ rank: "C", variety: "C2", copies: 3 }),
  Object.freeze({ rank: "C", variety: "C3", copies: 3 }),
]);

export const COLLECTOR_DEFINITIONS = Object.freeze({
  10: Object.freeze([
    Object.freeze({ id: "housekeeper", name: "女管家", requirement: "同色 C1、C2、C3 各一株", bonus: 10 }),
    Object.freeze({ id: "scholar", name: "学者", requirement: "三色同一品种各一株", bonus: 10 }),
    Object.freeze({ id: "young-man", name: "青年绅士", requirement: "任意三株同色 C 级", bonus: 10 }),
    Object.freeze({ id: "tavern-owner", name: "酒馆老板", requirement: "三色 C 级各一株", bonus: 10 }),
  ]),
  15: Object.freeze([
    Object.freeze({ id: "clergyman", name: "牧师", requirement: "任意三株同色 B 级", bonus: 15 }),
    Object.freeze({ id: "madame", name: "贵妇", requirement: "三色 B 级各一株", bonus: 15 }),
    Object.freeze({ id: "fair-lady", name: "淑女", requirement: "同色 B1、B2 与任意 C 各一株", bonus: 15 }),
  ]),
  20: Object.freeze([
    Object.freeze({ id: "noble", name: "贵族", requirement: "同色 A、B1、B2 各一株", bonus: 20 }),
  ]),
});

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function createTulipDeck(random = Math.random) {
  let serial = 0;
  const cards = [];

  for (const color of COLOR_IDS) {
    for (const blueprint of VARIETY_BLUEPRINT) {
      for (let copy = 1; copy <= blueprint.copies; copy += 1) {
        serial += 1;
        cards.push({
          id: `tulip-${serial}`,
          color,
          rank: blueprint.rank,
          variety: blueprint.variety,
          copy,
          bids: [],
        });
      }
    }
  }

  return shuffle(cards, random);
}

export function createInitialPrices(random = Math.random) {
  const levels = shuffle([1, 2, 3], random);
  return Object.fromEntries(COLOR_IDS.map((color, index) => [color, levels[index]]));
}

export function getMarketPrice(card, prices) {
  return PRICE_TABLE[card.rank][prices[card.color]];
}

export function createEventDeck(random = Math.random) {
  const marketEvents = [
    ...COLOR_IDS.flatMap((color) => [1, 2].map((copy) => ({
      id: `rise-${color}-${copy}`,
      type: "rise",
      color,
      title: `${color === "red" ? "红色" : color === "yellow" ? "黄色" : "白色"}走俏`,
      symbol: "+1",
    }))),
    { id: "surge", type: "surge", title: "投机热潮", symbol: "低价 +2" },
    ...[1, 2, 3].map((copy) => ({ id: `crash-${copy}`, type: "crash", title: "信心动摇", symbol: "高价 -2" })),
  ];

  const shuffled = shuffle(marketEvents, random);
  const removed = shuffled.pop();
  const protectedBottom = shuffled.splice(0, 2);
  const bottomThree = shuffle([
    ...protectedBottom,
    { id: "bubble-burst", type: "burst", title: "泡沫破裂", symbol: "终局" },
  ], random);

  return {
    deck: [...bottomThree, ...shuffled],
    removed,
  };
}

export function createCollectorMarket(random = Math.random) {
  const stacks = {};
  const faceUp = {};

  for (const bonus of [10, 15, 20]) {
    stacks[bonus] = shuffle(COLLECTOR_DEFINITIONS[bonus], random);
    faceUp[bonus] = stacks[bonus].pop() ?? null;
  }

  return { stacks, faceUp };
}

export function movePriceMarkers(prices, colorIds, spaces) {
  if (!spaces || colorIds.length === 0) return { ...prices };

  const direction = Math.sign(spaces);
  const distance = Math.abs(spaces);
  const moving = [...new Set(colorIds)].sort((left, right) => (
    direction > 0 ? prices[right] - prices[left] : prices[left] - prices[right]
  ));
  const movingSet = new Set(moving);
  const occupied = new Set(
    COLOR_IDS.filter((color) => !movingSet.has(color)).map((color) => prices[color]),
  );
  const result = { ...prices };

  for (const color of moving) {
    const origin = prices[color];
    let target = origin;

    for (let step = 0; step < distance; step += 1) {
      const candidate = target + direction;
      if (candidate < 0 || candidate > 6) break;
      target = candidate;
    }

    while (target >= 0 && target <= 6 && occupied.has(target)) {
      target += direction;
    }

    if (target < 0 || target > 6) target = origin;
    result[color] = target;
    occupied.add(target);
  }

  return result;
}

export function getSupplyAdjustment(cards) {
  const counts = Object.fromEntries(COLOR_IDS.map((color) => [color, 0]));
  for (const card of cards) counts[card.color] += 1;

  const values = Object.values(counts);
  const highest = Math.max(...values);
  const lowest = Math.min(...values);

  if (highest === lowest) return { counts, rising: [], falling: [] };

  return {
    counts,
    rising: COLOR_IDS.filter((color) => counts[color] === lowest),
    falling: COLOR_IDS.filter((color) => counts[color] === highest),
  };
}

export function applySupplyAdjustment(prices, cards) {
  const adjustment = getSupplyAdjustment(cards);
  const afterFall = movePriceMarkers(prices, adjustment.falling, -1);
  return {
    prices: movePriceMarkers(afterFall, adjustment.rising, 1),
    ...adjustment,
  };
}

function combinationsOfThree(cards) {
  const combinations = [];
  for (let first = 0; first < cards.length - 2; first += 1) {
    for (let second = first + 1; second < cards.length - 1; second += 1) {
      for (let third = second + 1; third < cards.length; third += 1) {
        combinations.push([cards[first], cards[second], cards[third]]);
      }
    }
  }
  return combinations;
}

function allSame(cards, key) {
  return cards.every((card) => card[key] === cards[0][key]);
}

function allDifferent(cards, key) {
  return new Set(cards.map((card) => card[key])).size === cards.length;
}

export function matchesCollector(cards, collectorId) {
  if (cards.length !== 3) return false;
  const varieties = cards.map((card) => card.variety);

  switch (collectorId) {
    case "noble":
      return allSame(cards, "color") && ["A", "B1", "B2"].every((variety) => varieties.includes(variety));
    case "housekeeper":
      return allSame(cards, "color") && ["C1", "C2", "C3"].every((variety) => varieties.includes(variety));
    case "clergyman":
      return allSame(cards, "color") && cards.every((card) => card.rank === "B");
    case "scholar":
      return allSame(cards, "variety") && allDifferent(cards, "color");
    case "madame":
      return cards.every((card) => card.rank === "B") && allDifferent(cards, "color");
    case "young-man":
      return cards.every((card) => card.rank === "C") && allSame(cards, "color");
    case "fair-lady":
      return allSame(cards, "color")
        && varieties.includes("B1")
        && varieties.includes("B2")
        && cards.some((card) => card.rank === "C");
    case "tavern-owner":
      return cards.every((card) => card.rank === "C") && allDifferent(cards, "color");
    default:
      return false;
  }
}

export function findCollectorSet(cards, collectorId) {
  return combinationsOfThree(cards).find((set) => matchesCollector(set, collectorId)) ?? null;
}

export function findCollectorSets(cards, collectorId) {
  return combinationsOfThree(cards).filter((set) => matchesCollector(set, collectorId));
}

export function clockwiseOrder(playerCount, startPlayer) {
  return Array.from({ length: playerCount }, (_, offset) => (startPlayer + offset) % playerCount);
}

export function orderParticipants(participantIds, playerCount, startPlayer) {
  const participants = new Set(participantIds);
  return clockwiseOrder(playerCount, startPlayer).filter((playerId) => participants.has(playerId));
}
