import WebSocket from 'ws';
import { BaseExchange } from './base.js';

const WS_URI = 'wss://quote.edgex.exchange/api/v1/public/ws';

const CONTRACT_IDS = {
  BTC: '10000001',
  ETH: '10000002',
  SOL: '10000003',
};

const DEPTH_LEVELS = 200;

export class EdgeXExchange extends BaseExchange {
  constructor(coins) {
    super('EdgeX', coins);
    this.ws = null;
    this.orderBookSnapshots = new Map();
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
    const contractId = CONTRACT_IDS[coin];
    if (!contractId) return;
    this.ws.send(JSON.stringify({
      type: 'subscribe',
      channel: `depth.${contractId}.${DEPTH_LEVELS}`,
    }));
  }

  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData.toString());

      if (msg.type === 'ping') {
        this.ws.send(JSON.stringify({ type: 'pong', time: msg.time }));
        return;
      }

      if (msg.type === 'quote-event' && msg.channel?.startsWith('depth.')) {
        this.handleDepthUpdate(msg);
      }
    } catch (err) {}
  }

  handleDepthUpdate(msg) {
    const content = msg.content;
    if (!content?.data?.[0]) return;

    const data = content.data[0];
    const contractId = data.contractId;
    const depthType = data.depthType;

    let coin = null;
    for (const [c, id] of Object.entries(CONTRACT_IDS)) {
      if (id === contractId) { coin = c; break; }
    }
    if (!coin) return;

    const parseBids = (levels) =>
      (levels || [])
        .map((lvl) => ({ price: parseFloat(lvl.price), size: parseFloat(lvl.size) }))
        .filter((l) => l.size > 0 && !isNaN(l.price))
        .sort((a, b) => b.price - a.price);

    const parseAsks = (levels) =>
      (levels || [])
        .map((lvl) => ({ price: parseFloat(lvl.price), size: parseFloat(lvl.size) }))
        .filter((l) => l.size > 0 && !isNaN(l.price))
        .sort((a, b) => a.price - b.price);

    if (depthType === 'SNAPSHOT') {
      const orderBook = { bids: parseBids(data.bids), asks: parseAsks(data.asks) };
      this.orderBookSnapshots.set(coin, orderBook);
      this.updateOrderBook(coin, { ...orderBook, timestamp: Date.now() });
    } else {
      const current = this.orderBookSnapshots.get(coin);
      if (!current) return;

      for (const update of data.bids || []) {
        const price = parseFloat(update.price);
        const size = parseFloat(update.size);
        const idx = current.bids.findIndex((b) => b.price === price);
        if (size <= 0) { if (idx !== -1) current.bids.splice(idx, 1); }
        else if (idx !== -1) { current.bids[idx].size = size; }
        else { current.bids.push({ price, size }); }
      }

      for (const update of data.asks || []) {
        const price = parseFloat(update.price);
        const size = parseFloat(update.size);
        const idx = current.asks.findIndex((a) => a.price === price);
        if (size <= 0) { if (idx !== -1) current.asks.splice(idx, 1); }
        else if (idx !== -1) { current.asks[idx].size = size; }
        else { current.asks.push({ price, size }); }
      }

      current.bids.sort((a, b) => b.price - a.price);
      current.asks.sort((a, b) => a.price - b.price);
      this.updateOrderBook(coin, { bids: [...current.bids], asks: [...current.asks], timestamp: Date.now() });
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

export default EdgeXExchange;
