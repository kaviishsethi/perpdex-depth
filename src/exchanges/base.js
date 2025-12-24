import { EventEmitter } from 'events';

/**
 * Base class for exchange order book connections
 * Extend this class for each exchange implementation
 */
export class BaseExchange extends EventEmitter {
  constructor(name, coins = ['BTC', 'ETH', 'SOL']) {
    super();
    this.name = name;
    this.coins = coins;
    this.orderBooks = new Map();
    this.isConnected = false;
  }

  /**
   * Connect to the exchange WebSocket
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('connect() must be implemented');
  }

  /**
   * Disconnect from the exchange
   */
  disconnect() {
    throw new Error('disconnect() must be implemented');
  }

  /**
   * Get order book for a specific coin
   * @param {string} coin
   * @returns {Object|null}
   */
  getOrderBook(coin) {
    return this.orderBooks.get(coin) || null;
  }

  /**
   * Get all order books
   * @returns {Object}
   */
  getAllOrderBooks() {
    return Object.fromEntries(this.orderBooks);
  }

  /**
   * Normalize order book data to standard format
   * @param {Object} rawData - Raw data from exchange
   * @returns {Object} Normalized order book
   */
  normalizeOrderBook(rawData) {
    throw new Error('normalizeOrderBook() must be implemented');
  }

  /**
   * Update internal order book and emit event
   * @param {string} coin
   * @param {Object} orderBook
   */
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

