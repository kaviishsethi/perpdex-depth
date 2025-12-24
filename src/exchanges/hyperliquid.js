import WebSocket from 'ws';
import { BaseExchange } from './base.js';

const WS_URI = 'wss://api.hyperliquid.xyz/ws';
const NSIGFIGS = 5;

export class HyperliquidExchange extends BaseExchange {
  constructor(coins) {
    super('Hyperliquid', coins);
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
    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'l2Book', coin, nSigFigs: NSIGFIGS },
    }));
  }

  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData.toString());
      if (msg.channel !== 'l2Book') return;

      const data = msg.data || {};
      const coin = data.coin;
      const levels = data.levels || [[], []];

      if (!coin || levels.length < 2) return;

      const bids = levels[0]
        .filter((lvl) => lvl.px && lvl.sz)
        .map((lvl) => ({ price: parseFloat(lvl.px), size: parseFloat(lvl.sz) }))
        .sort((a, b) => b.price - a.price);

      const asks = levels[1]
        .filter((lvl) => lvl.px && lvl.sz)
        .map((lvl) => ({ price: parseFloat(lvl.px), size: parseFloat(lvl.sz) }))
        .sort((a, b) => a.price - b.price);

      this.updateOrderBook(coin, { bids, asks, timestamp: data.time || Date.now() });
    } catch (err) {}
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
      this.isConnected = false;
    }
  }
}

export default HyperliquidExchange;
