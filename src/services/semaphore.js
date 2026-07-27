'use strict';

/**
 * Basic counting semaphore so we never have more than N audits in flight
 * against upstream sites at once, regardless of how many requests hit us
 * concurrently. Protects our own event loop and outbound bandwidth from
 * a burst of audit requests.
 */
class Semaphore {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.queue = [];
  }

  acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(() => this._release());
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve(() => this._release());
      });
    });
  }

  _release() {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }

  get pending() {
    return this.queue.length;
  }
}

module.exports = { Semaphore };
