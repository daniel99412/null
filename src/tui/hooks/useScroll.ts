import { useState, useRef, useCallback } from "react";

interface UseScrollOptions {
  maxLines: number;
}

interface UseScrollReturn {
  scrollOffset: number;
  visibleStart: number;
  visibleLines: string[];
  isAtBottom: boolean;
  handleUp: () => void;
  handleDown: () => void;
  resetScroll: () => void;
}

export function useScroll(
  lines: string[],
  options: UseScrollOptions,
): UseScrollReturn {
  const { maxLines } = options;
  const scrollOffsetRef = useRef(0);
  const isUserScrollingRef = useRef(false);
  const [, forceUpdate] = useState(0);

  const maxScroll = Math.max(0, lines.length - maxLines);
  const currentScroll = Math.min(scrollOffsetRef.current, maxScroll);
  const visibleStart = Math.max(0, lines.length - maxLines - currentScroll);
  const visibleLines = lines.slice(visibleStart, visibleStart + maxLines);
  const isAtBottom = currentScroll === 0;

  const handleUp = useCallback(() => {
    if (maxScroll > 0) {
      isUserScrollingRef.current = true;
      scrollOffsetRef.current = Math.min(scrollOffsetRef.current + 3, maxScroll);
      forceUpdate((n) => n + 1);
    }
  }, [maxScroll]);

  const handleDown = useCallback(() => {
    if (scrollOffsetRef.current > 0) {
      scrollOffsetRef.current = Math.max(scrollOffsetRef.current - 3, 0);
      if (scrollOffsetRef.current === 0) {
        isUserScrollingRef.current = false;
      }
      forceUpdate((n) => n + 1);
    }
  }, []);

  const resetScroll = useCallback(() => {
    isUserScrollingRef.current = false;
    scrollOffsetRef.current = 0;
    forceUpdate((n) => n + 1);
  }, []);

  return {
    scrollOffset: currentScroll,
    visibleStart,
    visibleLines,
    isAtBottom,
    handleUp,
    handleDown,
    resetScroll,
  };
}
