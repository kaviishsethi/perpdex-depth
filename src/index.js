import {
  HyperliquidExchange,
  LighterExchange,
  EdgeXExchange,
  ParadexExchange,
} from './exchanges/index.js';
import { computeDepth, formatNumber } from './compute.js';

// ============ CONFIGURATION ============
const COINS = ['BTC', 'ETH', 'SOL'];
const BP_LEVELS = [1, 2, 3, 5, 10];
const UPDATE_INTERVAL = 1000;

// Enable/disable exchanges (set to true when implemented)
const ENABLED_EXCHANGES = {
  Hyperliquid: true,
  Lighter: true,
  EdgeX: true,
  Paradex: true,
};
// =======================================

const exchanges = new Map();
const depthData = new Map(); // exchange -> coin -> depthData

async function initExchanges() {
  const exchangeClasses = {
    Hyperliquid: HyperliquidExchange,
    Lighter: LighterExchange,
    EdgeX: EdgeXExchange,
    Paradex: ParadexExchange,
  };

  for (const [name, enabled] of Object.entries(ENABLED_EXCHANGES)) {
    if (!enabled) continue;

    const ExchangeClass = exchangeClasses[name];
    const exchange = new ExchangeClass(COINS);

    exchange.on('update', (orderBook) => {
      const depth = computeDepth(orderBook, BP_LEVELS);
      if (depth) {
        if (!depthData.has(name)) depthData.set(name, new Map());
        depthData.get(name).set(orderBook.coin, depth);
      }
    });

    exchange.on('error', () => {});
    exchange.on('disconnected', () => {
      setTimeout(() => exchange.connect().catch(() => {}), 5000);
    });

    exchanges.set(name, exchange);
  }
}

async function connectAll() {
  const promises = [];
  for (const [name, exchange] of exchanges) {
    promises.push(
      exchange.connect().catch((err) => {
        console.error(`Failed to connect to ${name}:`, err.message);
      })
    );
  }
  await Promise.allSettled(promises);
}

function displayComparison() {
  console.clear();

  const now = new Date().toLocaleTimeString();
  const enabledExchanges = Object.entries(ENABLED_EXCHANGES)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  console.log(`\n  📊 PERP DEPTH COMPARISON | ${now}`);
  console.log(`  Exchanges: ${enabledExchanges.join(', ')}`);
  console.log('━'.repeat(80));

  for (const coin of COINS) {
    console.log(`\n  ${coin}`);
    console.log('  ' + '─'.repeat(76));

    // Header row
    const header = ['  BP'].concat(enabledExchanges.map((e) => e.padStart(14)));
    console.log(header.join(' │ '));
    console.log('  ' + '─'.repeat(76));

    // Data rows for each BP level
    for (const bp of BP_LEVELS) {
      const row = [`  ${String(bp).padStart(2)}`];

      for (const exchangeName of enabledExchanges) {
        const exchangeData = depthData.get(exchangeName);
        const coinData = exchangeData?.get(coin);
        const depth = coinData?.depths?.[bp];

        if (depth) {
          // Show raw token amount
          row.push(formatNumber(depth.totalSize, 4).padStart(14));
        } else {
          row.push('--'.padStart(14));
        }
      }

      console.log(row.join(' │ '));
    }

    // Show spread for context
    console.log('  ' + '─'.repeat(76));
    const spreadRow = ['  Spread'];
    for (const exchangeName of enabledExchanges) {
      const exchangeData = depthData.get(exchangeName);
      const coinData = exchangeData?.get(coin);
      const spread = coinData?.tob?.spreadBps;

      if (spread !== null && spread !== undefined) {
        spreadRow.push((spread.toFixed(2) + ' bps').padStart(14));
      } else {
        spreadRow.push('--'.padStart(14));
      }
    }
    console.log(spreadRow.join(' │ '));
  }

  console.log('\n━'.repeat(80));
  console.log('  💡 Press Ctrl+C to exit');
  console.log('  📈 Depth shown as token amount within X basis points of mid\n');
}

async function main() {
  console.clear();

  await initExchanges();
  await connectAll();

  setInterval(displayComparison, UPDATE_INTERVAL);

  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down...');
    for (const exchange of exchanges.values()) {
      exchange.disconnect();
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    for (const exchange of exchanges.values()) {
      exchange.disconnect();
    }
    process.exit(0);
  });
}

main().catch(console.error);
