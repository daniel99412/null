import React, { useEffect, useState, useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/ThemeContext.js";

const SIDEBAR_WIDTH = 30;

function shortenPath(fullPath: string, maxLen: number): string {
  if (fullPath.length <= maxLen) return fullPath;
  const tail = fullPath.slice(-(maxLen - 1));
  const slashIdx = tail.indexOf("/");
  if (slashIdx === -1) return "…" + tail.slice(-(maxLen - 1));
  const result = "…" + tail.slice(slashIdx);
  if (result.length > maxLen) return "…" + tail.slice(-(maxLen - 1));
  return result;
}

const VOCHO_NORMAL: [string, string] = [" .(___).", "(o\\_|_/o)"];
const VOCHO_BLINK: [string, string] = [" .(___).", "(-\\_|_-)"];
const VOCHO_THINK_L: [string, string] = [" .(___).", "(o\\_|_/O)"];
const VOCHO_THINK_R: [string, string] = [" .(___).", "(O\\_|_/o)"];

interface SidebarProps {
  isLoading: boolean;
  terminalHeight: number;
  sessionName: string;
}

export function Sidebar({ isLoading, terminalHeight, sessionName }: SidebarProps) {
  const { accent } = useTheme();
  const [blink, setBlink] = useState(false);
  const [thinkPhase, setThinkPhase] = useState(false);
  const [breath, setBreath] = useState(false);
  const cwd = useMemo(() => shortenPath(process.cwd(), 24), []);

  // Random blink every 3-6s
  useEffect(() => {
    if (isLoading) return;
    const nextBlink = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 150);
    };
    const timer = setTimeout(nextBlink, 3000 + Math.random() * 3000);
    return () => clearTimeout(timer);
  }, [blink, isLoading]);

  // Thinking headlights flash
  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setThinkPhase((p) => !p);
    }, 400);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Breath pulse every 2.5s
  useEffect(() => {
    const interval = setInterval(() => {
      setBreath((b) => !b);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const vocho: [string, string] = isLoading
    ? thinkPhase
      ? VOCHO_THINK_L
      : VOCHO_THINK_R
    : blink
      ? VOCHO_BLINK
      : VOCHO_NORMAL;

  return (
    <Box
      width={SIDEBAR_WIDTH}
      flexDirection="column"
      height={terminalHeight}
      backgroundColor="#16161e"
    >
      {/* HR at top */}
      <Box height={1} paddingX={1}>
        <Text color="gray">{"─".repeat(SIDEBAR_WIDTH - 2)}</Text>
      </Box>

      {/* Session name */}
      <Box justifyContent="center" height={1} paddingX={1}>
        <Text color="white" wrap="truncate-end">{sessionName}</Text>
      </Box>

      {/* Vochito centered */}
      <Box
        flexGrow={1}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
      >
        <Box flexDirection="column" alignItems="center">
          <Text color={accent} dimColor={!breath}>
            {vocho[0]}
          </Text>
          <Text color={accent} dimColor={!breath}>
            {vocho[1]}
          </Text>
        </Box>
      </Box>

      {/* Working directory */}
      <Box justifyContent="center" height={1}>
        <Text color="white" dimColor>
          {cwd}
        </Text>
      </Box>

      {/* null · v0.1.0 */}
      <Box justifyContent="center" height={1}>
        <Text color="gray">· null · v0.1.0</Text>
      </Box>
    </Box>
  );
}

export { SIDEBAR_WIDTH };
