import React, { useState, useRef, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { streamChat } from "../core/ollama.js";
import { tools } from "../core/tools.js";

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    const paraLines = paragraph.split("\n");
    for (const paraLine of paraLines) {
      const words = paraLine.split(" ");
      let line = "";

      for (const w of words) {
        if ((line + w).length > width) {
          lines.push(line);
          line = w + " ";
        } else {
          line += w + " ";
        }
      }

      if (line.trim()) lines.push(line);
    }
  }

  return lines;
}

const LOADING_BAR_WIDTH = 12;

export function App() {
  const { exit } = useApp();

  const terminalWidth = process.stdout?.columns || 80;
  const inputHeight = 4;
  const footerHeight = 1;
  const contentHeight =
    (process.stdout?.rows || 24) - inputHeight - footerHeight;

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPos, setLoadingPos] = useState(0);
  const [loadingDir, setLoadingDir] = useState(1);
  const [cursorVisible, setCursorVisible] = useState(true);

  const scrollOffsetRef = useRef(0);
  const isUserScrollingRef = useRef(false);
  const [, forceUpdate] = useState(0);

  const buffer = useRef("");

  useEffect(() => {
    if (!isLoading) return;

    const posInterval = setInterval(() => {
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
      clearInterval(posInterval);
    };
  }, [isLoading, loadingDir]);

  useEffect(() => {
    if (isLoading) {
      setCursorVisible(false);
      return;
    }

    const cursorInterval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);

    return () => {
      clearInterval(cursorInterval);
    };
  }, [isLoading]);

  const allLines = messages.flatMap((m) => {
    const prefix = m.role === "user" ? "❯ " : "  ";
    const wrapped = wrapText(m.content, terminalWidth - 4);
    return wrapped.map((l, i) => (i === 0 ? prefix + l : "  " + l));
  });

  const maxScroll = Math.max(0, allLines.length - contentHeight);
  const currentScroll = Math.min(scrollOffsetRef.current, maxScroll);

  const visibleStart = Math.max(
    0,
    allLines.length - contentHeight - currentScroll,
  );
  const visibleLines = allLines.slice(
    visibleStart,
    visibleStart + contentHeight,
  );

  const isAtBottom = currentScroll === 0;

  function renderLoadingBar() {
    const pos = loadingPos;
    const left = " ".repeat(Math.max(0, pos));
    const right = " ".repeat(Math.max(0, LOADING_BAR_WIDTH - pos - 1));
    return `[${left}█${right}]`;
  }

  useInput((char, key) => {
    if (key.ctrl && char === "c") exit();
    if (isLoading) return;

    if (key.return) {
      if (!input.trim()) return;

      if (input.trim().toLowerCase() === "exit") exit();

      const txt = input;

      setMessages((m) => [
        ...m,
        { role: "user", content: txt },
        { role: "assistant", content: "" },
      ]);

      setInput("");
      isUserScrollingRef.current = false;
      scrollOffsetRef.current = 0;
      forceUpdate((n) => n + 1);
      setIsLoading(true);
      setLoadingPos(0);
      setLoadingDir(1);
      buffer.current = "";

      let prompt = txt;

      const asksTime = /\bhora\b|\bque\s*hora\b|\bdime\s*la\s*hora\b/i.test(
        txt,
      );
      const asksDate =
        /\bfecha\b|\bdia\b|\bque\s*dia\b|\bdime\s*la\s*fecha\b|\ba\s*que\s*dia\b/i.test(
          txt,
        );

      if (asksTime && asksDate) {
        const t = tools.get_time();
        prompt = `Hora: ${t.time} Fecha: ${t.date}. Responde natural.`;
      } else if (asksDate) {
        const t = tools.get_time();
        prompt = `Fecha: ${t.date}. Responde natural.`;
      } else if (asksTime) {
        const t = tools.get_time();
        prompt = `Hora: ${t.time}. Responde natural.`;
      }

      streamChat(prompt, (tok) => {
        buffer.current += tok;

        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            last.content = buffer.current;
          }
          return copy;
        });

        if (!isUserScrollingRef.current) {
          forceUpdate((n) => n + 1);
        }
      }).then(() => {
        setIsLoading(false);
        buffer.current = "";
        forceUpdate((n) => n + 1);
      });

      return;
    }

    if (key.upArrow) {
      if (maxScroll > 0) {
        isUserScrollingRef.current = true;
        scrollOffsetRef.current = Math.min(
          scrollOffsetRef.current + 3,
          maxScroll,
        );
        forceUpdate((n) => n + 1);
      }
      return;
    }

    if (key.downArrow) {
      if (scrollOffsetRef.current > 0) {
        scrollOffsetRef.current = Math.max(scrollOffsetRef.current - 3, 0);
        if (scrollOffsetRef.current === 0) {
          isUserScrollingRef.current = false;
        }
        forceUpdate((n) => n + 1);
      }
      return;
    }

    if (key.backspace) {
      setInput((s) => s.slice(0, -1));
      return;
    }

    if (char) {
      setInput((s) => s + char);
    }
  });

  return (
    <Box flexDirection="column" height={process.stdout?.rows || 24}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleLines.map((line, i) => (
          <Text
            key={visibleStart + i}
            color={line.startsWith("❯") ? "cyan" : "white"}
          >
            {line}
          </Text>
        ))}
      </Box>

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        paddingY={1}
        height={inputHeight}
      >
        <Text color="yellow">
          ❯ {input}
          {cursorVisible && !isLoading && <Text color="yellow">▎</Text>}
        </Text>
      </Box>

      <Box
        height={1}
        paddingX={1}
        justifyContent="space-between"
        alignItems="center"
      >
        <Text color="cyan">{isLoading && renderLoadingBar()}</Text>
        <Text color="gray">
          {!isAtBottom && !isLoading && allLines.length > contentHeight
            ? `▲ ${currentScroll} lines | `
            : ""}
          ↑↓ scroll | /exit | ctrl+c
        </Text>
      </Box>
    </Box>
  );
}

export function runTUI() {
  render(<App />);
}
