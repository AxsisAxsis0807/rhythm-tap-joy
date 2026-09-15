import type { ChartNote } from "./types";

/**
 * Normalised result of parsing an uploaded chart file.
 * FNF-style charts store absolute milliseconds, so they are converted to
 * seconds and paired with bpm = 60 (1 beat = 1 second) instead of modelling
 * every BPM change. Native charts keep their authored beats.
 */
export interface ParsedChart {
  bpm: number;
  offset: number;
  laneCount: number;
  notes: ChartNote[];
  /** Best-effort metadata pulled out of the file. */
  title?: string;
  artist?: string;
  difficultyName?: string;
  /** "fnf-legacy" | "fnf-vslice" | "native" */
  format: string;
}

type Json = Record<string, unknown>;

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Legacy FNF: { song: { song, bpm, notes: [{ mustHitSection, sectionNotes }] } } */
function parseFnfLegacy(song: Json): ParsedChart {
  const sections = Array.isArray(song['notes']) ? (song['notes'] as Json[]) : [];
  const notes: ChartNote[] = [];
  for (const section of sections) {
    const mustHit = section['mustHitSection'] !== false;
    const raw = Array.isArray(section['sectionNotes'])
      ? (section['sectionNotes'] as unknown[])
      : [];
    for (const entry of raw) {
      if (!Array.isArray(entry)) continue;
      const time = num(entry[0]) / 1000;
      const data = num(entry[1], -1);
      if (data < 0) continue;
      // Lanes 0-3 belong to whoever "must hit" the section.
      const isPlayer = mustHit ? data < 4 : data >= 4;
      if (!isPlayer) continue;
      const lengthMs = num(entry[2]);
      notes.push({
        beat: time,
        lane: data % 4,
        kind: "tap",
        ...(lengthMs > 0 ? { lengthBeats: lengthMs / 1000 } : {}),
      });
    }
  }
  notes.sort((a, b) => a.beat - b.beat);
  return {
    bpm: 60,
    offset: 0,
    laneCount: 4,
    notes,
    format: "fnf-legacy",
    ...(typeof song['song'] === "string" ? { title: song['song'] } : {}),
  };
}

/** V-slice FNF chart: { notes: { hard: [{ t, d, l }] } } */
function parseFnfVslice(root: Json): ParsedChart | null {
  const byDifficulty = root['notes'];
  if (!byDifficulty || typeof byDifficulty !== "object") return null;
  const entries = Object.entries(byDifficulty as Json).filter(([, v]) =>
    Array.isArray(v),
  );
  if (entries.length === 0) return null;
  const [difficultyName, list] = entries[entries.length - 1]!;
  const notes: ChartNote[] = [];
  for (const item of list as Json[]) {
    if (!item || typeof item !== "object") continue;
    const data = num(item['d'], -1);
    if (data < 0 || data > 3) continue; // 0-3 = player side
    const length = num(item['l']);
    notes.push({
      beat: num(item['t']) / 1000,
      lane: data % 4,
      kind: "tap",
      ...(length > 0 ? { lengthBeats: length / 1000 } : {}),
    });
  }
  notes.sort((a, b) => a.beat - b.beat);
  return {
    bpm: 60,
    offset: 0,
    laneCount: 4,
    notes,
    difficultyName: difficultyName.toUpperCase(),
    format: "fnf-vslice",
  };
}

/** Our own format: { bpm, offset, laneCount, notes: [{ beat, lane }] } */
function parseNative(root: Json): ParsedChart | null {
  if (!Array.isArray(root['notes'])) return null;
  const list = root['notes'] as Json[];
  const notes: ChartNote[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (typeof item['beat'] !== "number" && typeof item['lane'] !== "number")
      return null;
    notes.push({
      beat: num(item['beat']),
      lane: Math.max(0, Math.trunc(num(item['lane']))),
      kind: item['kind'] === "hold" ? "hold" : "tap",
      ...(typeof item['lengthBeats'] === "number"
        ? { lengthBeats: item['lengthBeats'] }
        : {}),
    });
  }
  if (notes.length === 0) return null;
  notes.sort((a, b) => a.beat - b.beat);
  const lanes = Math.max(4, ...notes.map((n) => n.lane + 1));
  return {
    bpm: num(root['bpm'], 120),
    offset: num(root['offset']),
    laneCount: Math.trunc(num(root['laneCount'], lanes)) || lanes,
    notes,
    format: "native",
    ...(typeof root['title'] === "string" ? { title: root['title'] } : {}),
    ...(typeof root['artist'] === "string" ? { artist: root['artist'] } : {}),
    ...(typeof root['difficultyName'] === "string"
      ? { difficultyName: root['difficultyName'] }
      : {}),
  };
}

/** Parse a chart JSON string from any supported editor format. */
export function parseChartJson(text: string): ParsedChart {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error("譜面ファイルがJSONとして読み込めませんでした");
  }
  if (!root || typeof root !== "object") {
    throw new Error("譜面ファイルの形式が読み取れませんでした");
  }
  const obj = root as Json;
  if (obj['song'] && typeof obj['song'] === "object") {
    const parsed = parseFnfLegacy(obj['song'] as Json);
    if (parsed.notes.length > 0) return parsed;
  }
  const vslice = parseFnfVslice(obj);
  if (vslice && vslice.notes.length > 0) return vslice;
  const native = parseNative(obj);
  if (native) return native;
  const legacy = parseFnfLegacy(obj);
  if (legacy.notes.length > 0) return legacy;
  throw new Error("この譜面ファイルからノーツを見つけられませんでした");
}
