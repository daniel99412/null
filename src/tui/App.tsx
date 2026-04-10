import React, { useState } from "react";
import { render, Box, Text, useInput, useApp } from "ink";

export function App() {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState<string[]>([]);

  const { exit } = useApp();

  useInput((inputChar, key) => {
    // ENTER
    if (key.return) {
      if (input.trim().length > 0) {
        setSubmitted((prev) => [...prev, input]);
        setInput("");
        if (input.trim().toLowerCase() === "/exit") exit();
      }
      return;
    }

    // BACKSPACE
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    // CTRL+C
    if (key.ctrl && inputChar === "c") {
      exit();
    }

    // IGNORAR teclas especiales
    if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
      return;
    }

    // TEXTO normal
    if (inputChar) {
      setInput((prev) => prev + inputChar);
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="green">🤖 null</Text>

      {/* Historial */}
      {submitted.map((msg, i) => (
        <Text key={i} color="cyan">
          {"> " + msg}
        </Text>
      ))}

      {/* Input */}
      <Text>
        <Text color="yellow">{"> "}</Text>
        {input}
      </Text>
    </Box>
  );
}

export function runTUI() {
  render(<App />);
}
