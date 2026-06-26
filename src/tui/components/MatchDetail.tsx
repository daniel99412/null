import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { useTheme } from "../context/ThemeContext.js";
import { useScroll } from "../hooks/useScroll.js";
import { getUnifiedMatchDetail } from "../../tools/sports/unified-match.js";
import type { DigestMatch, MatchDetailData } from "../../core/agent.types.js";

interface MatchDetailProps {
  match: DigestMatch;
  onClose: () => void;
}

type LoadStatus = "loading" | "ready" | "error";
type DetailSection = "stats" | "events" | "lineups" | "h2h" | "injuries";

function isBlack(hex: string): boolean {
  return hex === "000000";
}

const ANSI_COLORS = [
  { name: "red", r: 205, g: 0, b: 0 },
  { name: "green", r: 0, g: 205, b: 0 },
  { name: "yellow", r: 205, g: 205, b: 0 },
  { name: "blue", r: 0, g: 0, b: 205 },
  { name: "magenta", r: 205, g: 0, b: 205 },
  { name: "cyan", r: 0, g: 205, b: 205 },
  { name: "white", r: 229, g: 229, b: 229 },
  { name: "gray", r: 128, g: 128, b: 128 },
  { name: "redBright", r: 255, g: 85, b: 85 },
  { name: "greenBright", r: 85, g: 255, b: 85 },
  { name: "yellowBright", r: 255, g: 255, b: 85 },
  { name: "blueBright", r: 85, g: 85, b: 255 },
  { name: "magentaBright", r: 255, g: 85, b: 255 },
  { name: "cyanBright", r: 85, g: 255, b: 255 },
  { name: "whiteBright", r: 255, g: 255, b: 255 },
];

function hexToAnsiName(hex: string): string {
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  let closest = ANSI_COLORS[0];
  let minDist = Infinity;
  for (const c of ANSI_COLORS) {
    const dr = r - c.r;
    const dg = g - c.g;
    const db = b - c.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < minDist) {
      minDist = dist;
      closest = c;
    }
  }
  return closest.name;
}

function pickColor(primary?: string, alternate?: string): string {
  if (primary) {
    if (isBlack(primary)) return "gray";
    return hexToAnsiName(primary);
  }
  if (alternate) {
    if (isBlack(alternate)) return "gray";
    return hexToAnsiName(alternate);
  }
  return "white";
}

function isMatchStart(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("kickoff") ||
    t.includes("inicio") ||
    t.includes("start") ||
    t === "1st half"
  );
}

function isHalftime(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("halftime") ||
    t.includes("half time") ||
    t.includes("medio tiempo") ||
    t === "ht"
  );
}

function isMatchEnd(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("full time") ||
    t.includes("final") ||
    t.includes("match ends") ||
    t.includes("end of match") ||
    t.includes("end match") ||
    t === "ft"
  );
}

function formatOtherLabel(text: string): string {
  const t = text.toLowerCase();
  if (isMatchStart(text)) return "INI";
  if (isHalftime(text)) return "HT";
  if (isMatchEnd(text)) return "FIN";
  return "EVT";
}

function formatOtherColor(text: string): string {
  const t = text.toLowerCase();
  if (isMatchStart(text)) return "green";
  if (isHalftime(text)) return "yellow";
  if (isMatchEnd(text)) return "red";
  return "gray";
}

function buildActionsMap(
  events: MatchDetailData["events"],
  teamName: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const ev of events) {
    if (ev.team !== teamName) continue;
    if (ev.type === "card" && ev.playerName) {
      const key = ev.playerName.toLowerCase().trim();
      if (ev.cardType === "red") {
        map.set(key, (map.get(key) ?? "") + "R");
      } else if (ev.cardType === "second_yellow") {
        map.set(key, (map.get(key) ?? "") + "!!");
      } else {
        map.set(key, (map.get(key) ?? "") + "!");
      }
    }
    if (ev.type === "substitution") {
      if (ev.subOut) {
        const key = ev.subOut.toLowerCase().trim();
        map.set(key, (map.get(key) ?? "") + "↓");
      }
      if (ev.subIn) {
        const key = ev.subIn.toLowerCase().trim();
        map.set(key, (map.get(key) ?? "") + "↑");
      }
    }
  }
  return map;
}

function fmt(v: string | number): string {
  if (typeof v === "number") return String(v);
  const n = Number.parseFloat(v);
  if (
    ["0.3", "0.8", "0.9", "0.2", "0.5", "0.6"].includes(v) ||
    (n > 0 && n < 1)
  ) {
    return `${Math.round(n * 100)}%`;
  }
  return v;
}

function extractNum(v: string | number): number {
  if (typeof v === "number") return v;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function renderStatBar(home: number, away: number, width: number): string {
  const total = Math.abs(home) + Math.abs(away);
  if (total === 0) return "░".repeat(width);
  const ratio = Math.abs(home) / total;
  const fillLen = Math.round(ratio * width);
  return "█".repeat(fillLen) + "░".repeat(width - fillLen);
}

const LABELS: Record<string, string> = {
  POSSESSION: "Posesión",
  SHOTS: "Tiros",
  "ON GOAL": "A puerta",
  "Yellow Cards": "T. Amarillas",
  "Red Cards": "T. Rojas",
  Fouls: "Faltas",
  "Corner Kicks": "Córners",
  Offsides: "Fueras",
  Saves: "Atajadas",
  "Penalty Goals": "Penales",
  "Blocked Shots": "Tiros bloq.",
  "Accurate Passes": "Pases precisos",
  Passes: "Pases totales",
  "Pass Completion %": "% Pases",
  "Penalty Kicks Taken": "Penales tomados",
  "On Target %": "% Precisión",
  "Effective Tackles": "Entradas",
  Tackles: "Entradas totales",
  "Tackle %": "% Entradas",
  "Accurate Crosses": "Centros precisos",
  Crosses: "Centros",
  "Cross %": "% Centros",
  "Long Balls": "Balones largos",
  "Accurate Long Balls": "Bal. largos precisos",
  "Long Balls %": "% Bal. largos",
  Interceptions: "Intercepciones",
  "Effective Clearances": "Despejes",
  Clearances: "Despejes totales",
};

function labelOf(k: string): string {
  return LABELS[k] || k;
}

export function MatchDetail({ match, onClose }: MatchDetailProps) {
  const { accent } = useTheme();
  const { columns, rows } = useWindowSize();
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [detail, setDetail] = useState<MatchDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<DetailSection>("stats");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    getUnifiedMatchDetail(match)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError("No se pudieron obtener los detalles del partido.");
          setStatus("error");
          return;
        }
        setDetail(data);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [match.eventId, match.leaguePath]);

  const windowWidth = Math.max(60, columns - 3);
  const windowHeight = Math.max(14, rows - 3);
  const innerWidth = Math.max(20, windowWidth - 6);
  const footerHeight = 1;
  const headerHeight = 4;
  const borderHeight = 2;
  const visibleHeight = Math.max(
    3,
    windowHeight - headerHeight - footerHeight - borderHeight,
  );

  const sectionLines = useMemo(() => {
    if (status !== "ready" || !detail) return [];

    const lines: string[] = [];

    if (section === "stats") {
      const show = detail.homeStats.map((hs, i) => ({
        label: hs.label,
        home: fmt(hs.value),
        away: fmt(detail.awayStats[i]?.value ?? ""),
        homeRaw: extractNum(hs.value),
        awayRaw: extractNum(detail.awayStats[i]?.value ?? 0),
      }));

      const maxLabel = show.reduce(
        (m, s) => Math.max(m, labelOf(s.label).length),
        0,
      );
      const labelWidth = Math.max(6, maxLabel + 1);
      const dataColWidth = Math.max(
        6,
        Math.min(20, Math.floor((innerWidth - labelWidth - 6) / 3)),
      );
      const barWidth = Math.max(4, dataColWidth - 4);

      lines.push("");
      for (const s of show) {
        const lbl = labelOf(s.label).slice(0, labelWidth).padEnd(labelWidth);
        const homeS = String(s.home).padStart(dataColWidth);
        const bar = renderStatBar(s.homeRaw, s.awayRaw, barWidth)
          .padStart(Math.floor((dataColWidth + barWidth) / 2))
          .padEnd(dataColWidth);
        const awayS = String(s.away).padEnd(dataColWidth);
        lines.push(`  ${lbl} ${homeS} ${bar} ${awayS}`);
      }
    }

    if (section === "events") {
      // rendered via eventNodes
    }

    if (section === "lineups") {
      if (
        detail.homeCoach ||
        detail.awayCoach ||
        detail.homeFormation ||
        detail.awayFormation
      ) {
        lines.push("");
        const coachWidth = Math.max(20, Math.floor((innerWidth - 6) / 3));
        const hcName = detail.homeCoach?.name ?? "";
        const acName = detail.awayCoach?.name ?? "";
        const hForm = detail.homeFormation ? `[${detail.homeFormation}]` : "";
        const aForm = detail.awayFormation ? `[${detail.awayFormation}]` : "";
        lines.push(
          `  DT: ${hcName.padEnd(coachWidth - 4)} ${"".padEnd(coachWidth)}  ${`DT: ${acName}`.padStart(coachWidth)}`,
        );
        if (hForm || aForm) {
          lines.push(
            `  ${hForm.padEnd(coachWidth + 2)} ${"".padEnd(coachWidth)}  ${aForm.padStart(coachWidth)}`,
          );
        }
        lines.push("");
      }

      const sideWidth = Math.max(12, Math.floor((innerWidth - 6) * 0.28));
      const midWidth = innerWidth - 6 - 2 * sideWidth;
      const nameWidth = sideWidth - 12;
      const homeActions = buildActionsMap(detail.events, detail.homeTeam);
      const awayActions = buildActionsMap(detail.events, detail.awayTeam);

      const buildLine = (
        p: (typeof detail.homePlayers)[0],
        am: Map<string, string>,
        rev: boolean,
      ) => {
        if (!p) return "";
        const acts =
          (p.captain ? "C" : "") + (am.get(p.name.toLowerCase().trim()) ?? "");
        const posStr = p.position.padEnd(4);
        if (rev) {
          const actsStr = acts.padStart(3);
          const namePad = p.name.slice(0, nameWidth).padStart(nameWidth);
          const posPad = p.position.padStart(4);
          const content = `${actsStr} ${posPad} ${namePad} ${p.jersey.padStart(2)}`;
          return content.padStart(sideWidth);
        }
        const actsStr = acts.padEnd(3);
        return `${p.jersey.padStart(2)} ${p.name.slice(0, nameWidth).padEnd(nameWidth)} ${posStr} ${actsStr}`;
      };

      const max = Math.max(
        detail.homePlayers.length,
        detail.awayPlayers.length,
      );
      const firstHomeSub = detail.homePlayers.findIndex(p => p.sub)
      const firstAwaySub = detail.awayPlayers.findIndex(p => p.sub)
      const splitIdx = Math.min(
        firstHomeSub >= 0 ? firstHomeSub : Infinity,
        firstAwaySub >= 0 ? firstAwaySub : Infinity,
      )
      const sepLine = `  ${"─".repeat(sideWidth)}  ${"".padEnd(midWidth)}  ${"─".repeat(sideWidth)}`
      for (let i = 0; i < max; i++) {
        if (i === splitIdx) {
          lines.push(sepLine);
        }
        const hp = detail.homePlayers[i];
        const ap = detail.awayPlayers[i];

        lines.push(
          `  ${buildLine(hp, homeActions, false).padEnd(sideWidth)}  ${"".padEnd(midWidth)}  ${buildLine(ap, awayActions, true).padEnd(sideWidth)}`,
        );
      }
    }

    if (section === "h2h") {
      if (detail.h2hSummary) {
        const s = detail.h2hSummary;
        lines.push("");
        const isHome = detail.homeTeam;
        const isAway = detail.awayTeam;
        const homeLine = `  ${detail.homeTeam}: ${s.homeWins}G`;
        const drawLine = `  Empates: ${s.draws}`;
        const awayLine = `  ${detail.awayTeam}: ${s.awayWins}G`;
        lines.push(homeLine.padEnd(25) + drawLine.padEnd(18) + awayLine);
        lines.push("");
      }

      if (detail.h2h && detail.h2h.length > 0) {
        for (const h of detail.h2h) {
          const tourney = h.tournament ? ` (${h.tournament})` : "";
          lines.push(
            `  ${h.home.padEnd(20)} ${h.score.padStart(5)}  ${h.away.padEnd(20)}  ${h.date || ""}${tourney}`,
          );
        }
      } else if (!detail.h2hSummary) {
        lines.push("");
        lines.push("  No hay historial de enfrentamientos.");
      }
    }

    if (section === "injuries") {
      if (detail.injuredPlayers && detail.injuredPlayers.length > 0) {
        lines.push("");
        for (const inj of detail.injuredPlayers) {
          const reason = inj.reason ? ` (${inj.reason})` : "";
          const pos = inj.position ? inj.position.padEnd(6) : "";
          lines.push(`  ${inj.name.padEnd(22)} ${pos}${reason}`);
        }
      } else {
        lines.push("");
        lines.push("  No hay lesionados reportados.");
      }
    }

    return lines;
  }, [detail, status, section, innerWidth]);

  const eventNodes = useMemo(() => {
    if (status !== "ready" || !detail) return [];

    const sorted = [...detail.events].sort((a, b) => {
      const parseMin = (t: string) => {
        const n = Number.parseInt(t, 10);
        return Number.isFinite(n) ? n : 0;
      };
      return parseMin(a.time) - parseMin(b.time);
    });

    if (sorted.length === 0) {
      return [
        <Text key={0} color="white">
          {""}
        </Text>,
        <Text key={1} color="white">
          {" "}
          No hay eventos registrados.
        </Text>,
      ];
    }

    const nodes: React.ReactNode[] = [];
    let k = 0;
    const timeWidth = 6;
    const typeWidth = 3;
    const descWidth = innerWidth - timeWidth - typeWidth - 8;

    for (const ev of sorted) {
      const player = ev.playerName || ev.description;
      const score =
        ev.homeScore !== undefined ? ` (${ev.homeScore}-${ev.awayScore})` : "";
      const time = ev.time.replace(/'/g, "");

      if (ev.type === "goal") {
        nodes.push(
          <Text key={k++}>
            {`  ${time.padEnd(timeWidth)} `}
            <Text color="cyan">GOL</Text>
            {` `}
            <Text color="cyan">●</Text>
            {` ${player.slice(0, descWidth - 2)}${score}`}
          </Text>,
        );
      } else if (ev.type === "card") {
        if (ev.cardType === "second_yellow") {
          nodes.push(
            <Text key={k++}>
              {`  ${time.padEnd(timeWidth)} `}
              <Text color="yellow">2TA</Text>
              {` `}
              <Text color="yellow">!!</Text> <Text color="red">R</Text>
              {` ${player.slice(0, descWidth - 6)}`}
            </Text>,
          );
        } else if (ev.cardType === "red") {
          nodes.push(
            <Text key={k++}>
              {`  ${time.padEnd(timeWidth)} `}
              <Text color="red">TR </Text>
              {` `}
              <Text color="red">R</Text>
              {` ${player.slice(0, descWidth - 4)}`}
            </Text>,
          );
        } else {
          nodes.push(
            <Text key={k++}>
              {`  ${time.padEnd(timeWidth)} `}
              <Text color="yellow">TA </Text>
              {` `}
              <Text color="yellow">!</Text>
              {` ${player.slice(0, descWidth - 4)}`}
            </Text>,
          );
        }
      } else if (ev.type === "substitution") {
        if (ev.subOut && ev.subIn) {
          nodes.push(
            <Text key={k++}>
              {`  ${time.padEnd(timeWidth)} `}
              <Text color="green">CAM</Text>
              {` `}
              <Text color="red">↓</Text>
              {` ${ev.subOut}, `}
              <Text color="green">↑</Text>
              {` ${ev.subIn.slice(0, descWidth - 10)}`}
            </Text>,
          );
        } else {
          nodes.push(
            <Text key={k++}>
              {`  ${time.padEnd(timeWidth)} `}
              <Text color="green">CAM</Text>
              {` ${player.slice(0, descWidth)}`}
            </Text>,
          );
        }
      } else {
        const label = formatOtherLabel(ev.description);
        const color = formatOtherColor(ev.description);
        nodes.push(
          <Text key={k++}>
            <Text
              color={color}
            >{`  ${time.padEnd(timeWidth)} ${label.padEnd(typeWidth)} ${ev.description.slice(0, descWidth)}`}</Text>
          </Text>,
        );
      }
    }

    return nodes;
  }, [detail, status, innerWidth]);

  const lineupNodes = useMemo(() => {
    if (status !== "ready" || !detail) return [];

    const nodes: React.ReactNode[] = [];

    if (
      detail.homeCoach ||
      detail.awayCoach ||
      detail.homeFormation ||
      detail.awayFormation
    ) {
      const coachWidth = Math.max(20, Math.floor((innerWidth - 6) / 3));
      const hcName = detail.homeCoach?.name ?? "";
      const acName = detail.awayCoach?.name ?? "";
      const hForm = detail.homeFormation ? `[${detail.homeFormation}]` : "";
      const aForm = detail.awayFormation ? `[${detail.awayFormation}]` : "";
      nodes.push(
        <Text
          key={nodes.length}
        >{`  DT: ${hcName.padEnd(coachWidth - 4)} ${"".padEnd(coachWidth)}  ${`DT: ${acName}`.padStart(coachWidth)}`}</Text>,
      );
      if (hForm || aForm) {
        nodes.push(
          <Text
            key={nodes.length}
          >{`  ${hForm.padEnd(coachWidth + 2)} ${"".padEnd(coachWidth)}  ${aForm.padStart(coachWidth)}`}</Text>,
        );
      }
      nodes.push(<Text key={nodes.length}>{""}</Text>);
    }

    const sideWidth = Math.max(12, Math.floor((innerWidth - 6) * 0.28));
    const midWidth = innerWidth - 6 - 2 * sideWidth;
    const nameWidth = sideWidth - 13;
    const homeActions = buildActionsMap(detail.events, detail.homeTeam);
    const awayActions = buildActionsMap(detail.events, detail.awayTeam);

    const actionColor = (ch: string) =>
      ch === "C"
        ? "cyan"
        : ch === "↓"
          ? "red"
          : ch === "↑"
            ? "green"
            : ch === "!"
              ? "yellow"
              : ch === "R"
                ? "red"
                : ch === "Y"
                  ? "yellow"
                  : "white";

    const max = Math.max(detail.homePlayers.length, detail.awayPlayers.length);
    const firstHomeSub = detail.homePlayers.findIndex(p => p.sub)
    const firstAwaySub = detail.awayPlayers.findIndex(p => p.sub)
    const splitIdx = Math.min(
      firstHomeSub >= 0 ? firstHomeSub : Infinity,
      firstAwaySub >= 0 ? firstAwaySub : Infinity,
    )
    const sepLine = `  ${"─".repeat(sideWidth)}  ${"".padEnd(midWidth)}  ${"─".repeat(sideWidth)}`
    for (let i = 0; i < max; i++) {
      if (i === splitIdx) {
        nodes.push(<Text key={nodes.length}>{sepLine}</Text>)
      }
      const hp = detail.homePlayers[i];
      const ap = detail.awayPlayers[i];

      const buildLine = (
        p: typeof hp,
        am: Map<string, string>,
        w: number,
        rev: boolean,
      ) => {
        if (!p) return "".padEnd(w);
        const acts =
          (p.captain ? "C" : "") + (am.get(p.name.toLowerCase().trim()) ?? "");
        if (rev) {
          const coloredActs = (
            <Text>
              {" ".repeat(Math.max(0, 4 - acts.length))}
              {acts.split("").map((ch, j) => (
                <Text key={j} color={actionColor(ch)}>
                  {ch}
                </Text>
              ))}
            </Text>
          );
          const nameRaw = p.name.slice(0, nameWidth).padStart(nameWidth);
          const posPad = p.position.padStart(4);
          const tail = ` ${posPad} ${nameRaw} ${p.jersey.padStart(2)}`;
          const contentWidth = 4 + tail.length;
          const pad = Math.max(0, w - contentWidth);
          return (
            <Text>
              {" ".repeat(pad)}
              {coloredActs}
              {tail}
            </Text>
          );
        }
        const coloredActs = (
          <Text>
            {acts.split("").map((ch, j) => (
              <Text key={j} color={actionColor(ch)}>
                {ch}
              </Text>
            ))}
            {" ".repeat(Math.max(0, 4 - acts.length))}
          </Text>
        );
        const namePad = p.name.slice(0, nameWidth).padEnd(nameWidth);
        return (
          <Text>
            {`${p.jersey.padStart(2)} ${namePad} ${p.position.padEnd(4)} `}
            {coloredActs}
          </Text>
        );
      };

      nodes.push(
        <Text key={nodes.length}>
          {`  `}
          {buildLine(hp, homeActions, sideWidth, false)}
          {`  `}
          {" ".repeat(midWidth)}
          {`  `}
          {buildLine(ap, awayActions, sideWidth, true)}
        </Text>,
      );
    }

    return nodes;
  }, [detail, status, innerWidth]);

  const {
    scrollOffset,
    visibleLines,
    isAtBottom,
    handleUp,
    handleDown,
    resetScroll,
  } = useScroll(sectionLines, { maxLines: visibleHeight });

  useEffect(() => {
    resetScroll();
  }, [section, match.eventId, resetScroll]);

  useInput((char, key) => {
    if (key.escape || char === "q" || char === "Q") {
      onClose();
      return;
    }

    if (key.upArrow || char === "k") {
      handleUp();
      return;
    }
    if (key.downArrow || char === "j") {
      handleDown();
      return;
    }
    if (key.pageUp || char === "b") {
      for (let i = 0; i < Math.max(1, Math.floor(visibleHeight / 2)); i++)
        handleUp();
      return;
    }
    if (key.pageDown || char === " " || char === "f") {
      for (let i = 0; i < Math.max(1, Math.floor(visibleHeight / 2)); i++)
        handleDown();
      return;
    }
    if (char === "g" || key.home) {
      resetScroll();
      return;
    }
    if (char === "G" || key.end) {
      for (let i = 0; i < 9999; i++) handleDown();
      return;
    }
    if (char === "1") setSection("stats");
    if (char === "2") setSection("events");
    if (char === "3") setSection("lineups");
    if (char === "4") setSection("h2h");
    if (char === "5") setSection("injuries");
  });

  const sections: DetailSection[] = [
    "stats",
    "events",
    "lineups",
    "h2h",
    "injuries",
  ];
  const tabLabels: Record<DetailSection, string> = {
    stats: "[1] Est",
    events: "[2] Ev",
    lineups: "[3] Ali",
    h2h: "[4] H2H",
    injuries: "[5] Les",
  };

  const scrollInfo =
    status === "ready" && sectionLines.length > visibleHeight
      ? ` · ${isAtBottom ? "final" : "sigue ↓"}`
      : "";

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      <Box
        flexDirection="column"
        width={windowWidth}
        height={windowHeight}
        borderStyle="round"
        borderColor={accent}
        paddingX={1}
        backgroundColor="black"
      >
        {/* Compact header: score + status + date + venue */}
        <Box justifyContent="space-between" marginBottom={1}>
          <Box>
            {detail ? (
              <Box>
                <Text
                  color={pickColor(detail.homeColor, detail.homeAltColor)}
                  bold
                >
                  {detail.homeTeam}
                </Text>
                <Text color="white" bold>
                  {" "}
                  {detail.homeScore}-{detail.awayScore}{" "}
                </Text>
                <Text
                  color={pickColor(detail.awayColor, detail.awayAltColor)}
                  bold
                >
                  {detail.awayTeam}
                </Text>
              </Box>
            ) : (
              <Text color="white">Cargando...</Text>
            )}
            {detail ? (
              <Text color="gray">
                {" · "}
                {detail.status}
                {" · "}
                {detail.date}
                {detail.venue ? ` · ${detail.venue}` : ""}
              </Text>
            ) : null}
          </Box>
          <Text color="gray">esc/q cerrar</Text>
        </Box>

        {/* Section tabs: inline, compact */}
        <Box marginBottom={1}>
          {sections.map((s) => {
            const active = s === section;
            return (
              <Box key={s} marginRight={1}>
                <Text
                  color={active ? accent : "gray"}
                  bold={active}
                  inverse={active}
                >
                  {tabLabels[s]}
                </Text>
              </Box>
            );
          })}
          <Text color="gray"> [1-5] sección{scrollInfo}</Text>
        </Box>

        {/* Content */}
        <Box flexDirection="column" height={visibleHeight} overflow="hidden">
          {status === "loading" && (
            <Text color="gray">Cargando detalles...</Text>
          )}
          {status === "error" && <Text color="red">Error: {error}</Text>}
          {status === "ready" &&
            section === "events" &&
            eventNodes.slice(scrollOffset, scrollOffset + visibleHeight)}
          {status === "ready" &&
            section === "lineups" &&
            lineupNodes.slice(scrollOffset, scrollOffset + visibleHeight)}
          {status === "ready" &&
            section !== "events" &&
            section !== "lineups" && (
              <Text color="white" wrap="wrap">
                {visibleLines.join("\n")}
              </Text>
            )}
        </Box>
      </Box>
    </Box>
  );
}
