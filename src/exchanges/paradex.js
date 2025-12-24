import WebSocket from 'ws';
import { BaseExchange } from './base.js';

const WS_URI = 'wss://ws.api.prod.paradex.trade/v1';

const MARKET_SYMBOLS = {
  BTC: 'BTC-USD-PERP',
  ETH: 'ETH-USD-PERP',
  SOL: 'SOL-USD-PERP',
};

export class ParadexExchange extends BaseExchange {
  constructor(coins) {
    super('Paradex', coins);
    this.ws = null;
    this.orderBookSnapshots = new Map();
    this.requestId = 1;
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
    
    const market = MARKET_SYMBOLS[coin];
    if (!market) return;

    const sub = {
      jsonrpc: '2.0',
      method: 'subscribe',
      params: {
        channel: `order_book.${market}.snapshot@15@100ms`,
      },
      id: this.requestId++,
    };
    this.ws.send(JSON.stringify(sub));
  }

  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData.toString());

      if (msg.method === 'subscription' && msg.params?.channel?.startsWith('order_book.')) {
        this.handleOrderBookUpdate(msg);
      }
    } catch (err) {}
  }

  handleOrderBookUpdate(msg) {
    const params = msg.params;
    const channel = params.channel;
    const data = params.data;

    if (!data) return;

    const marketMatch = channel.match(/order_book\.([^.]+)\./);
    if (!marketMatch) return;
    const market = marketMatch[1];

    let coin = null;
    for (const [c, m] of Object.entries(MARKET_SYMBOLS)) {
      if (m === market) { coin = c; break; }
    }
    if (!coin) return;

    const updateType = data.update_type;

    if (updateType === 's') {
      const bids = [];
      const asks = [];

      for (const item of data.inserts || []) {
        const level = { price: parseFloat(item.price), size: parseFloat(item.size) };
        if (item.side === 'BUY') bids.push(level);
        else if (item.side === 'SELL') asks.push(level);
      }

      bids.sort((a, b) => b.price - a.price);
      asks.sort((a, b) => a.price - b.price);

      const orderBook = { bids, asks };
      this.orderBookSnapshots.set(coin, orderBook);
      this.updateOrderBook(coin, { ...orderBook, timestamp: Date.now() });
    } else {
      const current = this.orderBookSnapshots.get(coin);
      if (!current) return;

      for (const item of data.deletes || []) {
        const price = parseFloat(item.price);
        const levels = item.side === 'BUY' ? current.bids : current.asks;
        const idx = levels.findIndex((l) => l.price === price);
        if (idx !== -1) levels.splice(idx, 1);
      }

      for (const item of data.updates || []) {
        const price = parseFloat(item.price);
        const size = parseFloat(item.size);
        const levels = item.side === 'BUY' ? current.bids : current.asks;
        const idx = levels.findIndex((l) => l.price === price);
        if (idx !== -1) levels[idx].size = size;
      }

      for (const item of data.inserts || []) {
        const price = parseFloat(item.price);
        const size = parseFloat(item.size);
        const levels = item.side === 'BUY' ? current.bids : current.asks;
        levels.push({ price, size });
      }

      current.bids.sort((a, b) => b.price - a.price);
      current.asks.sort((a, b) => a.price - b.price);

      this.updateOrderBook(coin, {
        bids: [...current.bids],
        asks: [...current.asks],
        timestamp: Date.now(),
      });
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
      this.isConnected = false;
    }
  }
}

export default ParadexExchange;
