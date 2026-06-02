import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/ThemeContext.js";

interface HeaderProps {
  model: string;
  sessionId: string;
  dimmed?: boolean;
}

export function Header({ model, sessionId, dimmed = false }: HeaderProps) {
  const { accent } = useTheme();
  const cols = process.stdout?.columns || 80;

  return (
    <Box height={1} width={cols} paddingX={1} justifyContent="space-between">
      <Box>
        <Text color={accent} bold dimColor={dimmed}>
          null
        </Text>
      </Box>
      <Box>
        <Text color="gray" dimColor={dimmed}>Date </Text>
        <Text color="white" dimColor>
          {new Date().toLocaleString()}
        </Text>
      </Box>
      <Box>
        <Text color="gray" dimColor={dimmed}>session </Text>
        <Text color="white" dimColor>
          {sessionId}
        </Text>
      </Box>
    </Box>
  );
}
