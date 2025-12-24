import WebSocket from 'ws';
import { BaseExchange } from './base.js';

const WS_URI = 'wss://mainnet.zklighter.elliot.ai/stream';

const MARKET_INDICES = {
  BTC: 1,
  ETH: 0,
  SOL: 2,
};

export class LighterExchange extends BaseExchange {
  constructor(coins) {
    super('Lighter', coins);
    this.ws = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URI);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.subscribeAll();
        resolve();
      });

      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });
      this.ws.on('close', () => {
        this.isConnected = false;
        this.emit('disconnected');
      });
    });
  }

  subscribeAll() {
    for (const coin of this.coins) {
      this.subscribe(coin);
    }
  }

  subscribe(coin) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const marketIndex = MARKET_INDICES[coin];
    if (marketIndex === undefined) return;

    this.ws.send(JSON.stringify({
      type: 'subscribe',
      channel: `order_book/${marketIndex}`,
    }));
  }

  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData.toString());

      if (msg.type === 'update/order_book' && msg.order_book) {
        this.handleOrderBookUpdate(msg);
      }
    } catch (err) {}
  }

  handleOrderBookUpdate(msg) {
    const channel = msg.channel;
    const orderBook = msg.order_book;

    if (!orderBook || orderBook.code !== 0) return;

    const marketMatch = channel.match(/order_book:(\d+)/);
    if (!marketMatch) return;
    const marketIndex = parseInt(marketMatch[1]);

    let coin = null;
    for (const [c, idx] of Object.entries(MARKET_INDICES)) {
      if (idx === marketIndex) { coin = c; break; }
    }
    if (!coin) return;

    const bids = (orderBook.bids || [])
      .map((lvl) => ({ price: parseFloat(lvl.price), size: parseFloat(lvl.size) }))
      .filter((l) => l.size > 0 && !isNaN(l.price))
      .sort((a, b) => b.price - a.price);

    const asks = (orderBook.asks || [])
      .map((lvl) => ({ price: parseFloat(lvl.price), size: parseFloat(lvl.size) }))
      .filter((l) => l.size > 0 && !isNaN(l.price))
      .sort((a, b) => a.price - b.price);

    this.updateOrderBook(coin, { bids, asks, timestamp: msg.timestamp || Date.now() });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
      this.isConnected = false;
    }
  }
}

export default LighterExchange;
