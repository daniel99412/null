import React from "react";
import { Box, Text } from "ink";

interface InputProps {
  value: string;
  cursorVisible: boolean;
  isLoading: boolean;
}

export function Input({ value, cursorVisible, isLoading }: InputProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      paddingY={1}
      height={4}
    >
      <Text color="yellow">
        ❯ {value}
        {cursorVisible && !isLoading && <Text color="yellow">▎</Text>}
      </Text>
    </Box>
  );
}
