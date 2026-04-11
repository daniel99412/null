import React, { useState, useRef } from "react";
import { render, Box, useInput, useApp } from "ink";
import { streamChat } from "../core/ollama.js";
import { tools } from "../core/tools.js";
import { formatMessage } from "./utils/text.js";
import { useScroll } from "./hooks/useScroll.js";
import { useLoading } from "./hooks/useLoading.js";
import { useCursor } from "./hooks/useCursor.js";
import { MessageList } from "./components/MessageList.js";
import { Input } from "./components/Input.js";
import { Footer } from "./components/Footer.js";

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

  const { isLoading, loadingPos, startLoading, stopLoading } = useLoading();
  const { isVisible: cursorVisible } = useCursor(isLoading);

  const buffer = useRef("");

  const allLines = messages.flatMap((m) =>
    formatMessage(m.content, m.role, terminalWidth),
  );

  const { scrollOffset, visibleStart, visibleLines, isAtBottom, handleUp, handleDown, resetScroll } =
    useScroll(allLines, { maxLines: contentHeight });

  const hasMoreLines = allLines.length > contentHeight;

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
      resetScroll();
      startLoading();
      buffer.current = "";

      let prompt = txt;

      const asksTime = /\bhora\b|\bque\s*hora\b|\bdime\s*la\s*hora\b/i.test(txt);
      const asksDate =
        /\bfecha\b|\bdia\b|\bque\s*dia\b|\bdime\s*la\s*fecha\b|\ba\s*que\s*dia\b/i.test(txt);

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
      }).then(() => {
        stopLoading();
        buffer.current = "";
      });

      return;
    }

    if (key.upArrow) {
      handleUp();
      return;
    }

    if (key.downArrow) {
      handleDown();
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
      <MessageList lines={allLines} visibleStart={visibleStart} />

      <Input
        value={input}
        cursorVisible={cursorVisible}
        isLoading={isLoading}
      />

      <Footer
        isLoading={isLoading}
        loadingPos={loadingPos}
        isAtBottom={isAtBottom}
        hasMoreLines={hasMoreLines}
        scrollOffset={scrollOffset}
      />
    </Box>
  );
}

export function runTUI() {
  render(<App />);
}
