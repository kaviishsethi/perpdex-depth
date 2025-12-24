import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  HyperliquidExchange,
  LighterExchange,
  EdgeXExchange,
  ParadexExchange,
  AsterExchange,
} from './exchanges/index.js';
import { computeDepth } from './compute.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COINS = ['BTC', 'ETH', 'SOL'];
const BP_LEVELS = [1, 2, 3];
const TRADE_SIZES = [100, 10000, 1000000];
const PORT = process.env.PORT || 3000;
const HISTORY_LENGTH = 30;

const ENABLED_EXCHANGES = {
  Hyperliquid: true,
  Lighter: true,
  EdgeX: true,
  Paradex: true,
  Aster: true,
};

const FEE_RATES = {
  Hyperliquid: 0.00045,
  Lighter: 0,
  EdgeX: 0.00038,
  Paradex: 0,
  Aster: 0.0004,
};

const exchanges = new Map();
const depthData = new Map();
const orderBooks = new Map();
const clients = new Set();

const history = {};
const slippageHistory = {};

function initHistory() {
  for (const bp of BP_LEVELS) {
    history[bp] = {
      timestamps: [],
      depth: {},
      spread: {},
    };
    for (const exchange of Object.keys(ENABLED_EXCHANGES)) {
      history[bp].depth[exchange] = {};
      history[bp].spread[exchange] = {};
      for (const coin of COINS) {
        history[bp].depth[exchange][coin] = [];
        history[bp].spread[exchange][coin] = [];
      }
    }
  }

  for (const exchange of Object.keys(ENABLED_EXCHANGES)) {
    slippageHistory[exchange] = {};
    for (const coin of COINS) {
      slippageHistory[exchange][coin] = {};
      for (const size of TRADE_SIZES) {
        slippageHistory[exchange][coin][size] = {
          slippageBps: [],
          effectiveSpreadBps: [],
          levelsUsed: [],
          depthUsedUsd: [],
          fillPct: [],
        };
      }
    }
  }
}

initHistory();

function recordHistory() {
  const now = Date.now();

  for (const bp of BP_LEVELS) {
    history[bp].timestamps.push(now);
    if (history[bp].timestamps.length > HISTORY_LENGTH) {
      history[bp].timestamps.shift();
    }

    for (const [exchangeName] of exchanges) {
      const exchangeData = depthData.get(exchangeName);
      
      for (const coin of COINS) {
        const coinData = exchangeData?.get(coin);
        const depth = coinData?.depths?.[bp]?.totalSize || 0;
        const spread = coinData?.tob?.spreadBps || 0;

        history[bp].depth[exchangeName][coin].push(depth);
        history[bp].spread[exchangeName][coin].push(spread);

        if (history[bp].depth[exchangeName][coin].length > HISTORY_LENGTH) {
          history[bp].depth[exchangeName][coin].shift();
        }
        if (history[bp].spread[exchangeName][coin].length > HISTORY_LENGTH) {
          history[bp].spread[exchangeName][coin].shift();
        }
      }
    }
  }

  for (const [exchangeName] of exchanges) {
    for (const coin of COINS) {
      const ob = orderBooks.get(exchangeName)?.get(coin);
      
      for (const size of TRADE_SIZES) {
        const buyResult = calculateSlippageDetailed(ob, size, 'buy');
        const sellResult = calculateSlippageDetailed(ob, size, 'sell');
        
        let avgSlippageBps = null;
        let avgEffectiveSpreadBps = null;
        let avgLevelsUsed = null;
        let avgDepthUsedUsd = null;
        let avgFillPct = null;

        if (buyResult && sellResult) {
          avgSlippageBps = (buyResult.slippageBps + sellResult.slippageBps) / 2;
          avgEffectiveSpreadBps = (buyResult.effectiveSpreadBps + sellResult.effectiveSpreadBps) / 2;
          avgLevelsUsed = Math.round((buyResult.levelsUsed + sellResult.levelsUsed) / 2);
          avgDepthUsedUsd = (buyResult.depthUsedUsd + sellResult.depthUsedUsd) / 2;
          avgFillPct = (buyResult.fillPct + sellResult.fillPct) / 2;
        } else if (buyResult) {
          avgSlippageBps = buyResult.slippageBps;
          avgEffectiveSpreadBps = buyResult.effectiveSpreadBps;
          avgLevelsUsed = buyResult.levelsUsed;
          avgDepthUsedUsd = buyResult.depthUsedUsd;
          avgFillPct = buyResult.fillPct;
        } else if (sellResult) {
          avgSlippageBps = sellResult.slippageBps;
          avgEffectiveSpreadBps = sellResult.effectiveSpreadBps;
          avgLevelsUsed = sellResult.levelsUsed;
          avgDepthUsedUsd = sellResult.depthUsedUsd;
          avgFillPct = sellResult.fillPct;
        }

        const hist = slippageHistory[exchangeName][coin][size];
        
        hist.slippageBps.push(avgSlippageBps);
        hist.effectiveSpreadBps.push(avgEffectiveSpreadBps);
        hist.levelsUsed.push(avgLevelsUsed);
        hist.depthUsedUsd.push(avgDepthUsedUsd);
        hist.fillPct.push(avgFillPct);

        if (hist.slippageBps.length > HISTORY_LENGTH) {
          hist.slippageBps.shift();
          hist.effectiveSpreadBps.shift();
          hist.levelsUsed.shift();
          hist.depthUsedUsd.shift();
          hist.fillPct.shift();
        }
      }
    }
  }
}

function calculateSlippageDetailed(orderBook, tradeSizeUsd, side = 'buy') {
  if (!orderBook || !orderBook.bids?.length || !orderBook.asks?.length) {
    return null;
  }

  const levels = side === 'buy' 
    ? [...orderBook.asks].sort((a, b) => a.price - b.price)
    : [...orderBook.bids].sort((a, b) => b.price - a.price);
  
  const bestBid = Math.max(...orderBook.bids.map(b => b.price));
  const bestAsk = Math.min(...orderBook.asks.map(a => a.price));
  const mid = (bestBid + bestAsk) / 2;
  const bestPrice = side === 'buy' ? bestAsk : bestBid;

  if (!mid || mid <= 0 || levels.length === 0) return null;

  let remainingUsd = tradeSizeUsd;
  let totalQty = 0;
  let totalCost = 0;
  let levelsUsed = 0;
  let worstPrice = bestPrice;

  for (const level of levels) {
    if (remainingUsd <= 0) break;
    
    const levelNotional = level.size * level.price;
    const fillNotional = Math.min(remainingUsd, levelNotional);
    const fillQty = fillNotional / level.price;

    totalQty += fillQty;
    totalCost += fillNotional;
    remainingUsd -= fillNotional;
    levelsUsed++;
    worstPrice = level.price;
  }

  if (totalQty === 0) return null;

  const avgPrice = totalCost / totalQty;
  const slippagePct = side === 'buy'
    ? ((avgPrice - mid) / mid) * 100
    : ((mid - avgPrice) / mid) * 100;
  
  const slippageBps = Math.abs(slippagePct * 100);
  
  const effectiveSpreadPct = Math.abs((worstPrice - bestPrice) / bestPrice) * 100;
  const effectiveSpreadBps = effectiveSpreadPct * 100;

  const filledUsd = tradeSizeUsd - remainingUsd;
  const fillPct = (filledUsd / tradeSizeUsd) * 100;

  return {
    slippageBps,
    effectiveSpreadBps,
    levelsUsed,
    depthUsedUsd: filledUsd,
    bestPrice,
    worstPrice,
    avgPrice,
    fillPct,
    filled: fillPct >= 99.9,
  };
}

function avg(arr) {
  const valid = arr.filter(v => v !== null && !isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function calculateExecutionCost(exchangeName, coin, tradeSizeUsd) {
  const hist = slippageHistory[exchangeName]?.[coin]?.[tradeSizeUsd];
  if (!hist) return null;

  const avgSlippageBps = avg(hist.slippageBps);
  const avgEffectiveSpreadBps = avg(hist.effectiveSpreadBps);
  const avgLevelsUsed = avg(hist.levelsUsed);
  const avgDepthUsedUsd = avg(hist.depthUsedUsd);
  const avgFillPct = avg(hist.fillPct);
  
  if (avgSlippageBps === null) return null;

  const feeRate = FEE_RATES[exchangeName] || 0;
  const feeBps = feeRate * 10000;
  const feeCost = tradeSizeUsd * feeRate;
  const slippageCost = tradeSizeUsd * (avgSlippageBps / 10000);
  const totalBps = avgSlippageBps + feeBps;
  const totalCost = slippageCost + feeCost;

  return {
    slippageBps: avgSlippageBps,
    slippageCost,
    feeBps,
    feeCost,
    totalBps,
    totalCost,
    effectiveSpreadBps: avgEffectiveSpreadBps,
    levelsUsed: avgLevelsUsed !== null ? Math.round(avgLevelsUsed) : null,
    depthUsedUsd: avgDepthUsedUsd,
    fillPct: avgFillPct,
  };
}

async function initExchanges() {
  const exchangeClasses = {
    Hyperliquid: HyperliquidExchange,
    Lighter: LighterExchange,
    EdgeX: EdgeXExchange,
    Paradex: ParadexExchange,
    Aster: AsterExchange,
  };

  for (const [name, enabled] of Object.entries(ENABLED_EXCHANGES)) {
    if (!enabled) continue;

    const ExchangeClass = exchangeClasses[name];
    const exchange = new ExchangeClass(COINS);

    exchange.on('update', (orderBook) => {
      if (!orderBooks.has(name)) orderBooks.set(name, new Map());
      
      const mid = orderBook.bids?.[0]?.price && orderBook.asks?.[0]?.price
        ? (orderBook.bids[0].price + orderBook.asks[0].price) / 2
        : null;
      
      orderBooks.get(name).set(orderBook.coin, {
        bids: orderBook.bids,
        asks: orderBook.asks,
        mid,
        timestamp: orderBook.timestamp,
      });

      const depth = computeDepth(orderBook, BP_LEVELS);
      if (depth) {
        if (!depthData.has(name)) depthData.set(name, new Map());
        depthData.get(name).set(orderBook.coin, depth);
      }
    });

    exchange.on('disconnected', () => {
      setTimeout(() => exchange.connect().catch(() => {}), 5000);
    });

    exchanges.set(name, exchange);
  }
}

async function connectAll() {
  for (const [name, exchange] of exchanges) {
    exchange.connect().catch((err) => {
      console.error(`Failed to connect to ${name}:`, err.message);
    });
  }
}

function getSnapshot() {
  const exchangeList = Object.keys(ENABLED_EXCHANGES).filter(e => ENABLED_EXCHANGES[e]);
  
  const snapshot = {
    timestamp: Date.now(),
    coins: COINS,
    bpLevels: BP_LEVELS,
    tradeSizes: TRADE_SIZES,
    exchanges: exchangeList,
    feeRates: FEE_RATES,
    current: {},
    executionCosts: {},
    history: {},
  };

  for (const coin of COINS) {
    snapshot.current[coin] = {};
    snapshot.executionCosts[coin] = {};
    
    for (const exchangeName of exchangeList) {
      const exchangeData = depthData.get(exchangeName);
      const coinData = exchangeData?.get(coin);
      
      snapshot.current[coin][exchangeName] = {
        depths: {},
        spread: coinData?.tob?.spreadBps || null,
        mid: coinData?.tob?.mid || null,
      };

      for (const bp of BP_LEVELS) {
        snapshot.current[coin][exchangeName].depths[bp] = coinData?.depths?.[bp]?.totalSize || 0;
      }

      snapshot.executionCosts[coin][exchangeName] = {};
      for (const size of TRADE_SIZES) {
        snapshot.executionCosts[coin][exchangeName][size] = calculateExecutionCost(exchangeName, coin, size);
      }
    }
  }

  for (const bp of BP_LEVELS) {
    snapshot.history[bp] = {
      timestamps: history[bp].timestamps.slice(-HISTORY_LENGTH),
      depth: {},
      spread: {},
    };

    for (const exchange of exchangeList) {
      snapshot.history[bp].depth[exchange] = {};
      snapshot.history[bp].spread[exchange] = {};
      for (const coin of COINS) {
        snapshot.history[bp].depth[exchange][coin] = history[bp].depth[exchange]?.[coin]?.slice(-HISTORY_LENGTH) || [];
        snapshot.history[bp].spread[exchange][coin] = history[bp].spread[exchange]?.[coin]?.slice(-HISTORY_LENGTH) || [];
      }
    }
  }

  return snapshot;
}

function broadcastData() {
  const data = JSON.stringify(getSnapshot());
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

const app = express();
const server = createServer(app);

app.use(express.static(join(__dirname, '../public')));

app.get('/api/depth', (req, res) => {
  res.json(getSnapshot());
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(getSnapshot()));
  ws.on('close', () => clients.delete(ws));
});

async function main() {
  console.log('🚀 Starting Perp Depth Server...');
  
  await initExchanges();
  await connectAll();
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Server running on port ${PORT}`);
  });

  setInterval(recordHistory, 1000);
  setInterval(broadcastData, 500);
}

main().catch(console.error);
