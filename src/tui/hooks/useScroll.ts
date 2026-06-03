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
  const [, forceUpdate] = useState(0);

  const maxScroll = Math.max(0, lines.length - maxLines);
  const offset = Math.min(scrollOffsetRef.current, maxScroll);
  const visibleLines = lines.slice(offset, offset + maxLines);
  const isAtBottom = offset >= maxScroll;

  const handleUp = useCallback(() => {
    if (offset > 0) {
      scrollOffsetRef.current = Math.max(scrollOffsetRef.current - 3, 0);
      forceUpdate((n) => n + 1);
    }
  }, [offset]);

  const handleDown = useCallback(() => {
    if (offset < maxScroll) {
      scrollOffsetRef.current = Math.min(scrollOffsetRef.current + 3, maxScroll);
      forceUpdate((n) => n + 1);
    }
  }, [offset, maxScroll]);

  const resetScroll = useCallback(() => {
    scrollOffsetRef.current = 0;
    forceUpdate((n) => n + 1);
  }, []);

  return {
    scrollOffset: offset,
    visibleStart: offset,
    visibleLines,
    isAtBottom,
    handleUp,
    handleDown,
    resetScroll,
  };
}
