// Basis point levels to calculate depth for
const DEFAULT_BP_LEVELS = [1, 2, 3, 5, 10, 25, 50, 100];

/**
 * Calculate best bid and best ask from order book
 */
export function getTopOfBook(orderBook) {
  const { bids, asks } = orderBook;

  const bestBid = bids.length > 0 ? bids[0].price : null;
  const bestAsk = asks.length > 0 ? asks[0].price : null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;
  const spreadBps = mid && spread ? (spread / mid) * 10000 : null;

  return { bestBid, bestAsk, mid, spread, spreadBps };
}

/**
 * Calculate depth within a certain basis point range from mid price
 */
export function calculateDepthAtBp(levels, mid, bp, side) {
  const bpDecimal = bp / 10000;
  const upperPrice = mid * (1 + bpDecimal);
  const lowerPrice = mid * (1 - bpDecimal);

  let totalSize = 0;
  let totalNotional = 0;

  for (const level of levels) {
    const inRange =
      side === 'ask'
        ? level.price >= mid && level.price <= upperPrice
        : level.price <= mid && level.price >= lowerPrice;

    if (inRange) {
      totalSize += level.size;
      totalNotional += level.size * level.price;
    }
  }

  return { size: totalSize, notional: totalNotional };
}

/**
 * Compute depth analysis for an order book at specified bp levels
 */
export function computeDepth(orderBook, bpLevels = DEFAULT_BP_LEVELS) {
  if (!orderBook) return null;

  const { bids, asks, exchange, coin } = orderBook;
  const tob = getTopOfBook(orderBook);

  if (!tob.mid) return null;

  const depths = {};
  for (const bp of bpLevels) {
    const askDepth = calculateDepthAtBp(asks, tob.mid, bp, 'ask');
    const bidDepth = calculateDepthAtBp(bids, tob.mid, bp, 'bid');

    depths[bp] = {
      bidSize: bidDepth.size,
      askSize: askDepth.size,
      totalSize: bidDepth.size + askDepth.size,
      bidNotional: bidDepth.notional,
      askNotional: askDepth.notional,
      totalNotional: bidDepth.notional + askDepth.notional,
    };
  }

  return {
    exchange,
    coin,
    tob,
    depths,
    totalBids: bids.length,
    totalAsks: asks.length,
  };
}

/**
 * Format number for display (compact notation for large numbers)
 */
export function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined) return '--';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(decimals) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(decimals) + 'K';
  return num.toFixed(decimals);
}

/**
 * Format USD value
 */
export function formatUSD(num) {
  if (num === null || num === undefined) return '--';
  if (num >= 1_000_000) return '$' + (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return '$' + (num / 1_000).toFixed(2) + 'K';
  return '$' + num.toFixed(2);
}

export default {
  computeDepth,
  getTopOfBook,
  calculateDepthAtBp,
  formatNumber,
  formatUSD,
};
