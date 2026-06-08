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

const LOGO_LINES = LOGO.split("\n").filter(
  (l, i, a) => i < a.length - 1 || l.trim() !== "",
);

const VOCHO_SLEEP = [
  "                   Z ",
  "                  Z  ",
  "       .(___).   Z   ",
  "      (_\\_|_/_)     ",
];

const FAREWELLS = [
  "Descansa. Fue un gusto ayudarte hoy.",
  "Hasta luego, que tengas un excelente d\u00eda.",
  "Nos vemos pronto. Aqu\u00ed estar\u00e9 cuando me necesites.",
  "Ha sido un placer. \u00a1Hasta la pr\u00f3xima!",
  "Sesi\u00f3n cerrada. Buen trabajo.",
  "Cu\u00eddate mucho. Aqu\u00ed me tienes para lo que sea.",
  "Vocho apagado. Descansa bien.",
  "Modo avi\u00f3n activado. Nos leemos luego.",
  "Fue un gusto charlar contigo. \u00a1Hasta luego!",
  "Terminamos por hoy. Recuerda: null siempre estar\u00e1 ah\u00ed.",
];

const COLOR_MAP: Record<AccentColor, typeof chalk.cyan> = {
  cyan: chalk.cyan,
  green: chalk.green,
  blue: chalk.blue,
  magenta: chalk.magenta,
  yellow: chalk.yellow,
  red: chalk.red,
  white: chalk.white,
};

function shortenPath(fullPath: string, maxLen: number): string {
  if (fullPath.length <= maxLen) return fullPath;
  const tail = fullPath.slice(-(maxLen - 1));
  const slashIdx = tail.indexOf("/");
  if (slashIdx === -1) return "\u2026" + tail.slice(-(maxLen - 1));
  const result = "\u2026" + tail.slice(slashIdx);
  if (result.length > maxLen) return "\u2026" + tail.slice(-(maxLen - 1));
  return result;
}

const LEFT_WIDTH = 22;
const GAP = 4;

const combinedLines: string[] = [];
const nullLines = LOGO_LINES.length;
const combinedHeight = Math.max(VOCHO_SLEEP.length, nullLines);
for (let i = 0; i < combinedHeight; i++) {
  const nullLine = i < nullLines ? LOGO_LINES[i] : "";
  const vochoLine =
    i < VOCHO_SLEEP.length
      ? VOCHO_SLEEP[i].padEnd(LEFT_WIDTH)
      : " ".repeat(LEFT_WIDTH);
  combinedLines.push(nullLine + " ".repeat(GAP) + vochoLine);
}

interface GoodbyeOptions {
  sessionId: string;
  sessionDate: string;
  hasMessages: boolean;
  messageCount?: number;
  duration?: string;
  model?: string;
  cwd?: string;
}

export function printGoodbye({
  sessionId,
  sessionDate,
  hasMessages,
  messageCount = 0,
  duration = "",
  model = "",
  cwd = "",
}: GoodbyeOptions): void {
  const config = loadConfig();
  const accentColor = config.accentColor || "cyan";
  const colorFn = COLOR_MAP[accentColor] || chalk.cyan;
  const dim = chalk.dim;

  const rows = process.stdout?.rows || 24;

  const totalContent = combinedLines.length + (hasMessages ? 8 : 4);
  const topPad = Math.max(2, Math.floor((rows - totalContent) / 3));

  const farewellIdx =
    sessionId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) %
    FAREWELLS.length;
  const farewell = FAREWELLS[farewellIdx];

  const project = cwd ? shortenPath(cwd, 28) : "";

  process.stdout.write("\x1B[2J\x1B[3J\x1B[H");

  for (let i = 0; i < topPad; i++) console.log();

  for (const line of combinedLines) {
    console.log(dim(colorFn.bold(line)));
  }

  console.log();

  if (hasMessages) {
    console.log(chalk.white(farewell));
    console.log();
    console.log(chalk.gray("\u2500".repeat(42)));
    const val = (label: string, value: string, valColor = chalk.white) =>
      console.log(chalk.gray(label.padEnd(10)) + valColor(value));

    val("Session", sessionDate);
    val("Continue", `null -s ${sessionId}`, colorFn);
    if (model) val("Model", model);
    if (project) val("Project", project, chalk.white);
    if (messageCount > 0) val("Messages", String(messageCount));
    if (duration) val("Time", duration);

    console.log();
  } else {
    console.log(chalk.gray("No messages in this session."));
    console.log();
  }
}
