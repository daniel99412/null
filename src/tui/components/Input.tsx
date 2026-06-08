import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/ThemeContext.js";

interface InputProps {
  value: string;
  cursorPos: number;
  cursorVisible: boolean;
  isLoading: boolean;
  width: number;
  dimmed?: boolean;
}

function calcHeight(text: string, maxCols: number): number {
  if (text.length === 0) return 1;
  // Account for outer paddingX (2), accent bar (1), spacer (1), inner paddingX (2)
  const usable = Math.max(1, maxCols - 6);
  return Math.max(1, Math.ceil(text.length / usable));
}

export function Input({
  value,
  cursorPos,
  cursorVisible,
  isLoading,
  width: cols,
  dimmed = false,
}: InputProps) {
  const { accent } = useTheme();
  const effectiveDim = dimmed || isLoading;

  const contentRows = calcHeight(value, cols);
  const boxHeight = contentRows + 2;

  const before = value.slice(0, cursorPos)
  const at = value[cursorPos] || ''
  const after = value.slice(cursorPos + 1)

  return (
    <Box flexDirection="row" width={cols} paddingX={1}>
      <Box width={1} backgroundColor={effectiveDim ? 'gray' : accent} />
      <Box width={1} />
      <Box
        flexDirection="row"
        paddingX={1}
        paddingY={1}
        backgroundColor="#16161e"
        height={boxHeight}
        flexGrow={1}
      >
        <Text color="white" dimColor={effectiveDim}>
          {before}
          {cursorVisible && !isLoading ? (
            at ? (
              <Text backgroundColor={accent} color="white">{at}</Text>
            ) : (
              <Text backgroundColor={accent}>{' '}</Text>
            )
          ) : (
            at
          )}
          {after}
        </Text>
      </Box>
    </Box>
  );
}
