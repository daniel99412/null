import { useState, useEffect } from "react";

interface UseCursorReturn {
  isVisible: boolean;
}

export function useCursor(isLoading: boolean): UseCursorReturn {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (isLoading) {
      setIsVisible(false);
      return;
    }

    const interval = setInterval(() => {
      setIsVisible((v) => !v);
    }, 500);

    return () => {
      clearInterval(interval);
    };
  }, [isLoading]);

  return { isVisible };
}
