import figlet from "figlet";
import chalk from "chalk";
import type { AccentColor } from "../../config/index.js";
import { loadConfig } from "../../config/index.js";

const LOGO = figlet.textSync("null", {
  font: "Small Slant",
  horizontalLayout: "default",
  verticalLayout: "default",
  width: 80,
});

const COLOR_MAP: Record<AccentColor, typeof chalk.cyan> = {
  cyan: chalk.cyan,
  green: chalk.green,
  blue: chalk.blue,
  magenta: chalk.magenta,
  yellow: chalk.yellow,
  red: chalk.red,
  white: chalk.white,
};

interface GoodbyeOptions {
  sessionId: string;
  sessionDate: string;
  hasMessages: boolean;
}

export function printGoodbye({
  sessionId,
  sessionDate,
  hasMessages,
}: GoodbyeOptions): void {
  const config = loadConfig();
  const colorFn = COLOR_MAP[config.accentColor] || chalk.cyan;
  const dim = chalk.dim;

  const rows = process.stdout?.rows || 24;
  const cols = process.stdout?.columns || 80;
  const logoLines = LOGO.split("\n");
  const topPad = Math.max(0, Math.floor((rows - logoLines.length - 8) / 2));

  // Clear screen
  process.stdout.write("\x1B[2J\x1B[3J\x1B[H");

  // Top padding
  for (let i = 0; i < topPad; i++) {
    console.log();
  }

  // Logo centered
  for (const line of logoLines) {
    const pad = Math.max(0, Math.floor((cols - line.length) / 2));
    console.log(" ".repeat(pad) + dim(colorFn.bold(line)));
  }

  console.log();

  if (hasMessages) {
    console.log();
    console.log(
      `  ${chalk.gray("Session")}   ${chalk.white(`New session - ${sessionDate}`)}`,
    );
    console.log(
      `  ${chalk.gray("Continue")}  ${colorFn(`null -s ${sessionId}`)}`,
    );
    console.log();
  } else {
    console.log(`  ${chalk.gray("No messages in this session.")}`);
    console.log();
  }
}
