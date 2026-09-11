import { useCallback, useRef, useState } from "react";

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/** Serialises saves and exposes a small status for the «Saved» indicator. */
export function useAutosave() {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(<T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setState({ kind: "saving" });
    const next = queue.current.then(fn).then(
      (r) => {
        setState({ kind: "saved" });
        return r;
      },
      (e: unknown) => {
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        return undefined;
      },
    );
    queue.current = next;
    return next;
  }, []);
  return { state, run };
}
