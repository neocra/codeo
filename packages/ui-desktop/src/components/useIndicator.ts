import { useLayoutEffect, useState, type RefObject } from 'react';

/** Measures the active item so the Tabs/SideNav indicator can slide to it. */
export function useIndicator(ref: RefObject<HTMLElement | null>, selector: string, deps: unknown[], axis: 'x' | 'y') {
  const [box, setBox] = useState<{ pos: number; size: number } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) {
        setBox(null);
        return;
      }
      setBox(axis === 'y' ? { pos: el.offsetTop, size: el.offsetHeight } : { pos: el.offsetLeft, size: el.offsetWidth });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    if (typeof document !== 'undefined' && document.fonts?.ready) void document.fonts.ready.then(measure);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return box;
}
