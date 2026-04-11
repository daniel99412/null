import { useState, useEffect, useCallback } from "react";
import { LOADING_BAR_WIDTH } from "../utils/loading.js";

interface UseLoadingReturn {
  isLoading: boolean;
  loadingPos: number;
  startLoading: () => void;
  stopLoading: () => void;
  resetLoading: () => void;
}

export function useLoading(): UseLoadingReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPos, setLoadingPos] = useState(0);
  const [loadingDir, setLoadingDir] = useState(1);

  useEffect(() => {
    if (!isLoading) return;

    const interval = setInterval(() => {
      setLoadingPos((p) => {
        if (p >= LOADING_BAR_WIDTH - 1) {
          setLoadingDir(-1);
          return p - 1;
        }
        if (p <= 0) {
          setLoadingDir(1);
          return p + 1;
        }
        return p + loadingDir;
      });
    }, 60);

    return () => {
      clearInterval(interval);
    };
  }, [isLoading, loadingDir]);

  const startLoading = useCallback(() => {
    setIsLoading(true);
    setLoadingPos(0);
    setLoadingDir(1);
  }, []);

  const stopLoading = useCallback(() => {
    setIsLoading(false);
  }, []);

  const resetLoading = useCallback(() => {
    setLoadingPos(0);
    setLoadingDir(1);
  }, []);

  return {
    isLoading,
    loadingPos,
    startLoading,
    stopLoading,
    resetLoading,
  };
}
