import React from "react";
import { Box, Text } from "ink";

interface MessageListProps {
  lines: string[];
  visibleStart: number;
}

export function MessageList({ lines, visibleStart }: MessageListProps) {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {lines.map((line, i) => (
        <Text
          key={visibleStart + i}
          color={line.startsWith("❯") ? "cyan" : "white"}
        >
          {line}
        </Text>
      ))}
    </Box>
  );
}
