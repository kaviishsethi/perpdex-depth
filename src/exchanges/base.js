import { EventEmitter } from 'events';

export class BaseExchange extends EventEmitter {
  constructor(name, coins = ['BTC', 'ETH', 'SOL']) {
    super();
    this.name = name;
    this.coins = coins;
    this.orderBooks = new Map();
    this.isConnected = false;
  }

  async connect() {
    throw new Error('connect() must be implemented');
  }

  disconnect() {
    throw new Error('disconnect() must be implemented');
  }

  getOrderBook(coin) {
    return this.orderBooks.get(coin) || null;
  }

  getAllOrderBooks() {
    return Object.fromEntries(this.orderBooks);
  }

  normalizeOrderBook(rawData) {
    throw new Error('normalizeOrderBook() must be implemented');
  }

  updateOrderBook(coin, orderBook) {
    this.orderBooks.set(coin, {
      ...orderBook,
      exchange: this.name,
      coin,
      receivedAt: Date.now(),
    });
    this.emit('update', this.orderBooks.get(coin));
    this.emit(`update:${coin}`, this.orderBooks.get(coin));
  }
}

export default BaseExchange;
