import { useState, useEffect, useRef } from 'react';

/**
 * Hook ตรวจสอบ media query — SSR-safe (default false จนกว่า client จะ mount)
 *
 * Print-stable: while the print dialog is open the browser emulates a paper-sized
 * viewport, which would flip breakpoint queries (e.g. min-width: 1024px → false),
 * swap the Desktop/Mobile layout, and UNMOUNT the whole page — wiping its state
 * (owner report 2026-07-15: printing a payslip reset the payroll page). Changes
 * arriving between beforeprint/afterprint are therefore ignored; the real value
 * is re-read after the dialog closes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  const printing = useRef(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    function onChange(e: MediaQueryListEvent) {
      if (printing.current) return; // print emulation, not a real viewport change
      setMatches(e.matches);
    }
    function onBeforePrint() {
      printing.current = true;
    }
    function onAfterPrint() {
      printing.current = false;
      setMatches(window.matchMedia(query).matches); // re-sync with the real viewport
    }

    mql.addEventListener('change', onChange);
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      mql.removeEventListener('change', onChange);
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [query]);

  return matches;
}
