/**
 * Process-wide lazy memoisation.
 *
 * React's `cache()` is the idiomatic choice inside a render, but the verifier sandbox is a
 * route handler and the same evidence has to be reachable from both. `cache()` outside a
 * render scope is not a memo at all, and a route handler that silently regenerates 120,000
 * rows on every keystroke is a performance bug you only find in production.
 *
 * A module singleton is correct here for a reason that is specific to this data rather than
 * a general licence to cache: the dataset is generated from a fixed seed, is treated as
 * immutable by every consumer, and carries no request-scoped or user-scoped state. There is
 * nothing to leak between callers because there is nothing that differs between callers.
 */
export function once<T>(factory: () => T): () => T {
  let value: T;
  let resolved = false;
  return () => {
    if (!resolved) {
      value = factory();
      resolved = true;
    }
    return value;
  };
}
