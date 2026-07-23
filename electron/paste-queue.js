/**
 * Single-flight paste queue — prevents overlapping CDP/UIA pastes.
 */
class PasteQueue {
  constructor() {
    this._chain = Promise.resolve();
    this._busy = false;
    this._pickBusy = false;
  }

  get busy() {
    return this._busy;
  }

  get pickBusy() {
    return this._pickBusy;
  }

  beginPick() {
    if (this._pickBusy) return false;
    this._pickBusy = true;
    return true;
  }

  endPick() {
    this._pickBusy = false;
  }

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T | { ok: false, error: string, busy: true }>}
   */
  enqueue(fn) {
    if (this._busy) {
      return Promise.resolve({
        ok: false,
        error: "отправка уже идёт — подождите",
        busy: true,
      });
    }
    this._busy = true;
    const run = this._chain.then(async () => {
      try {
        return await fn();
      } finally {
        this._busy = false;
      }
    });
    this._chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

module.exports = { PasteQueue };
