import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/ThemeContext.js";
import type { AccentColor } from "../../config/index.js";

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

function isFileReferenceChar(value: string, index: number): boolean {
  const before = value.slice(0, index + 1)
  const atIndex = before.lastIndexOf('@')
  if (atIndex < 0) return false
  const between = value.slice(atIndex, index + 1)
  if (/\s/.test(between)) return false
  const afterAt = value[atIndex + 1]
  if (afterAt === undefined || /\s/.test(afterAt)) return false

  const current = value[index]
  if (index > atIndex && /[),;:!?]/.test(current)) return false

  return true
}

function renderInputValue(
  value: string,
  cursorPos: number,
  cursorVisible: boolean,
  isLoading: boolean,
  accent: AccentColor,
  effectiveDim: boolean,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let buffer = ''
  let bufferAccent = false

  const flush = (key: string) => {
    if (!buffer) return
    nodes.push(
      <Text key={key} color={bufferAccent ? accent : 'white'} dimColor={effectiveDim}>
        {buffer}
      </Text>,
    )
    buffer = ''
  }

  for (let i = 0; i <= value.length; i++) {
    if (i === cursorPos && cursorVisible && !isLoading) {
      flush(`text-${i}`)
      const char = value[i] || ' '
      nodes.push(
        <Text key={`cursor-${i}`} backgroundColor={accent} color="white" dimColor={effectiveDim}>
          {char}
        </Text>,
      )
      if (value[i]) continue
    }

    if (i >= value.length) break

    const accentChar = isFileReferenceChar(value, i)
    if (buffer && accentChar !== bufferAccent) {
      flush(`text-${i}`)
    }
    bufferAccent = accentChar
    buffer += value[i]
  }

  flush('text-end')
  return nodes
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
        <Text>
          {renderInputValue(value, cursorPos, cursorVisible, isLoading, accent, effectiveDim)}
        </Text>
      </Box>
    </Box>
  );
}
