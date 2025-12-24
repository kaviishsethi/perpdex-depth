# Perpdex Depth

Live order book depth comparison across perpetual DEXs.

## Supported Exchanges

| Exchange | Status |
|----------|--------|
| Hyperliquid | ✅ Working |
| Lighter | 🔧 Placeholder |
| EdgeX | 🔧 Placeholder |
| Paradex | 🔧 Placeholder |

## Getting Started

```bash
npm install
npm start
```

## Output

Shows total notional depth (USD) within X basis points of mid price:

```
  📊 PERP DEPTH COMPARISON | 10:30:36 AM
  Exchanges: Hyperliquid
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  BTC
  ────────────────────────────────────────────────────────────────────────────────
    BP │     Hyperliquid
  ────────────────────────────────────────────────────────────────────────────────
     1 │       $2.65M
     2 │       $4.12M
     3 │       $5.89M
     5 │       $8.23M
    10 │      $12.45M
  ────────────────────────────────────────────────────────────────────────────────
  Spread │      0.11 bps
```

## Project Structure

```
src/
├── index.js              # Main entry point & comparison display
├── compute.js            # Depth calculation logic
└── exchanges/
    ├── base.js           # Base exchange class
    ├── hyperliquid.js    # Hyperliquid implementation
    ├── lighter.js        # Lighter (placeholder)
    ├── edgex.js          # EdgeX (placeholder)
    ├── paradex.js        # Paradex (placeholder)
    └── index.js          # Exchange exports
```

## Configuration

Edit `src/index.js`:

```js
const COINS = ['BTC', 'ETH', 'SOL'];      // Coins to track
const BP_LEVELS = [1, 2, 3, 5, 10];       // Depth levels (basis points)
const UPDATE_INTERVAL = 1000;              // Display refresh (ms)

// Enable exchanges
const ENABLED_EXCHANGES = {
  Hyperliquid: true,
  Lighter: false,    // Enable when implemented
  EdgeX: false,
  Paradex: false,
};
```

## Adding a New Exchange

1. Create `src/exchanges/yourexchange.js` extending `BaseExchange`
2. Implement `connect()`, `subscribe()`, `handleMessage()`, `disconnect()`
3. Export from `src/exchanges/index.js`
4. Add to `ENABLED_EXCHANGES` in `src/index.js`

Key methods to implement:
- **connect()**: Establish WebSocket connection
- **subscribe(coin)**: Send subscription message for order book
- **handleMessage(data)**: Parse incoming data and call `this.updateOrderBook(coin, { bids, asks })`
- **disconnect()**: Clean up WebSocket

Order book format:
```js
{
  bids: [{ price: 87934.0, size: 1.5 }, ...],  // Sorted high to low
  asks: [{ price: 87935.0, size: 2.0 }, ...],  // Sorted low to high
}
```
