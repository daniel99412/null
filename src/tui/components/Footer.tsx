import React from "react";
import { Box, Text } from "ink";
import { renderLoadingBar } from "../utils/loading.js";

interface FooterProps {
  isLoading: boolean;
  loadingPos: number;
  isAtBottom: boolean;
  hasMoreLines: boolean;
  scrollOffset: number;
}

export function Footer({
  isLoading,
  loadingPos,
  isAtBottom,
  hasMoreLines,
  scrollOffset,
}: FooterProps) {
  return (
    <Box
      height={1}
      paddingX={1}
      justifyContent="space-between"
      alignItems="center"
    >
      <Text color="cyan">{isLoading && renderLoadingBar(loadingPos)}</Text>
      <Text color="gray">
        {!isAtBottom && hasMoreLines ? `▲ ${scrollOffset} lines | ` : ""}
        ↑↓ scroll | exit | ctrl+c
      </Text>
    </Box>
  );
}
