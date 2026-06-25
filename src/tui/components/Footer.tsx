import React from "react";
import { Box, Text } from "ink";
import { renderLoadingBar } from "../utils/loading.js";
import { useTheme } from "../context/ThemeContext.js";

interface FooterProps {
  isLoading: boolean;
  loadingPos: number;
  loadingDir: number;
  isAtBottom: boolean;
  hasMoreLines: boolean;
  scrollOffset: number;
  statusText?: string;
  digestCount?: number;
  matchCount?: number;
  overlayOpen?: boolean;
  dimmed?: boolean;
}

export function Footer({
  isLoading,
  loadingPos,
  loadingDir,
  isAtBottom,
  hasMoreLines,
  scrollOffset,
  statusText = "",
  digestCount = 0,
  matchCount = 0,
  overlayOpen = false,
  dimmed = false,
}: FooterProps) {
  const { accent } = useTheme();

  return (
    <Box height={1} paddingX={1} paddingY={1} justifyContent="space-between">
      <Box>
        {isLoading ? (
          <Text color={accent} dimColor={dimmed}>
            {renderLoadingBar(loadingPos, loadingDir)}
            {statusText ? <Text> {statusText}</Text> : null}
          </Text>
        ) : null}
      </Box>
      <Box>
        {!isAtBottom && hasMoreLines ? (
          <Text color="yellow" dimColor={dimmed}>
            {scrollOffset} lines above{" "}
          </Text>
        ) : null}
        {digestCount > 0 && !isLoading && overlayOpen ? (
          <>
            <Text color="gray" dimColor={dimmed}>
              enter
            </Text>
            <Text color="white" dimColor={dimmed}>
              {" "}
              abrir{" "}
            </Text>
            <Text color="gray" dimColor={dimmed}>
              esc
            </Text>
            <Text color="white" dimColor={dimmed}>
              {" "}
              cerrar{" "}
            </Text>
          </>
        ) : null}
        {matchCount > 0 && !isLoading && overlayOpen ? (
          <>
            <Text color="gray" dimColor={dimmed}>
              enter/letra
            </Text>
            <Text color="white" dimColor={dimmed}>
              {" "}
              abrir{" "}
            </Text>
            <Text color="gray" dimColor={dimmed}>
              esc
            </Text>
            <Text color="white" dimColor={dimmed}>
              {" "}
              cerrar{" "}
            </Text>
          </>
        ) : null}
        <Text color="gray" dimColor={dimmed}>
          ctrl+x
        </Text>
        {matchCount > 0 && digestCount === 0 ? (
          <Text color="white" dimColor={dimmed}>
            {" "}
            ↓ partidos{" "}
          </Text>
        ) : (
          <Text color="white" dimColor={dimmed}>
            {" "}
            ↓ noticias{" "}
          </Text>
        )}
        <Text color="gray" dimColor={dimmed}>
          ctrl+p
        </Text>
        <Text color="white" dimColor={dimmed}>
          {" "}
          commands{" "}
        </Text>
        <Text color="gray" dimColor={dimmed}>
          arrows
        </Text>
        <Text color="white" dimColor={dimmed}>
          {" "}
          scroll{" "}
        </Text>
        <Text color="gray" dimColor={dimmed}>
          ctrl+c
        </Text>
        <Text color="white" dimColor={dimmed}>
          {" "}
          quit
        </Text>
      </Box>
    </Box>
  );
}
