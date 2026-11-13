// The scaffold's demo fixture: one deliberate defect per conformance property, and
// nothing else. `conformance/emit.mjs` renders this exact file into the project the
// suite validates, and `conformance/validate.mjs` re-checks it with the plugin out of
// the path, so each comment below is a claim two independent judges can check.

/**
 * Total of the first `count` ledger lines.
 *
 * `crash-unguarded` and `reproducer-script`: `lines` is empty, so any count above zero
 * reads `.amount` off `undefined` and Node throws a TypeError whose top frame is this
 * file. The crash lives in the target's own code, not in a wrapper around it.
 *
 * @param {bigint} count how many lines to total
 * @returns {bigint} the total amount
 */
export function lineTotal(count) {
  const lines = [];
  let total = 0n;
  for (let i = 0n; i < count; i += 1n) {
    total += lines[Number(i)].amount;
  }
  return total;
}

/**
 * Apply a discount percentage to an invoice total.
 *
 * `guard-refusal`: a negative percentage is a refusal the author declared — `RangeError`
 * is the class the demo scan project lists in `harness.options.rejectClasses`, so the
 * plugin reports this throw as `rejected`, not as a fault.
 *
 * @param {number} amount discount percentage, never negative
 * @returns {number} the percentage, unchanged
 */
export function applyDiscount(amount) {
  if (amount < 0) {
    throw new RangeError(`discount percentage must not be negative, got ${amount}`);
  }
  return amount;
}

/**
 * Cache key for a seed.
 *
 * `private-symbol`: discovery reports underscore-prefixed exports as `not-public`
 * instead of fuzzing them, so the engine learns the symbol exists and is skipped.
 *
 * @param {string} seed cache seed
 * @returns {string} the key
 */
export function _cacheKey(seed) {
  return `k:${seed}`;
}

// `unrepresentable-symbol`: no JSDoc block at all. The scaffold lowers types from JSDoc
// and refuses to guess from JavaScript alone, so discovery reports this symbol as
// `unsupported-signature` rather than inventing a parameter type.
export function untyped(value) {
  return value;
}

/**
 * Post one entry to a ledger.
 *
 * `unconstructible-receiver`: `Ledger` is a class this scaffold never sees the shape of,
 * so discovery reports the parameter as `unconstructible-parameter` and names `Ledger`
 * as the blocker. One missing type stays one task for a human to fix.
 *
 * @param {Ledger} ledger ledger to post to
 */
export function postToLedger(ledger) {
  return ledger;
}

/**
 * Echo a line after writing it to stdout.
 *
 * `stdout-purity`: target code logging to stdout is ordinary (this is what real npm
 * packages do), and the plugin owns the protocol channel, so this write must land on
 * stderr and the JSON frames must stay intact.
 *
 * @param {string} line what to echo
 * @returns {string} the same line
 */
export function noisy(line) {
  console.log(line);
  return line;
}

/**
 * Wait `ms` milliseconds and report the wait.
 *
 * `deadline-sleep`: the conformance run passes 30000 against a 1500 ms deadline, and
 * only a harness that cuts its own call answers inside the engine's timeout. A harness
 * that waits to be killed loses the outcome and the process.
 *
 * @param {number} ms milliseconds to wait
 * @returns {Promise<number>} the wait it completed
 */
export async function spin(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return ms;
}
