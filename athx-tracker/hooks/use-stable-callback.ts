import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * A function that keeps one identity across renders and calls the handler
 * from the latest one, so a memoised child given it is not drawn again for a
 * new closure each time. For event handlers only: called while rendering, it
 * would run the handler from the render before.
 */
export function useStableCallback<A extends unknown[], R>(handler: (...args: A) => R) {
  const latest = useRef(handler);
  useInsertionEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
