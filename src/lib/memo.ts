/** Memoize by reference equality of the arguments (last call only). Cheap and safe for selectors over React state. */
export function memoizeLast<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let lastResult: R;
  return (...args: A): R => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((a, i) => Object.is(a, args[i]))) return lastResult;
    lastResult = fn(...args);
    lastArgs = args;
    return lastResult;
  };
}
