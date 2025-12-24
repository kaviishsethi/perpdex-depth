import WebSocket from 'ws';
import { BaseExchange } from './base.js';

const WS_URI = 'wss://fstream.asterdex.com/ws';

const SYMBOLS = {
  BTC: 'btcusdt',
  ETH: 'ethusdt',
  SOL: 'solusdt',
};

export class AsterExchange extends BaseExchange {
  constructor(coins) {
    super('Aster', coins);
    this.ws = null;
    this.subscriptionId = 1;
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
    const streams = [];
    for (const coin of this.coins) {
      const symbol = SYMBOLS[coin];
      if (symbol) {
        streams.push(`${symbol}@depth20@100ms`);
      }
    }

    if (streams.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: streams,
        id: this.subscriptionId++,
      }));
    }
  }

  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData.toString());

      if (msg.e === 'depthUpdate') {
        this.handleDepthUpdate(msg);
      }
    } catch (err) {}
  }

  handleDepthUpdate(msg) {
    const symbol = msg.s?.toUpperCase();
    if (!symbol) return;

    let coin = null;
    for (const [c, s] of Object.entries(SYMBOLS)) {
      if (s.toUpperCase() === symbol) { coin = c; break; }
    }
    if (!coin) return;

    const bids = (msg.b || [])
      .map((lvl) => ({ price: parseFloat(lvl[0]), size: parseFloat(lvl[1]) }))
      .filter((l) => l.size > 0 && !isNaN(l.price))
      .sort((a, b) => b.price - a.price);

    const asks = (msg.a || [])
      .map((lvl) => ({ price: parseFloat(lvl[0]), size: parseFloat(lvl[1]) }))
      .filter((l) => l.size > 0 && !isNaN(l.price))
      .sort((a, b) => a.price - b.price);

    this.updateOrderBook(coin, { bids, asks, timestamp: msg.E || Date.now() });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
      this.isConnected = false;
    }
  }
}

export default AsterExchange;

