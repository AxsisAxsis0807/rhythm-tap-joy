import type { Chart, ChartNote } from "./types";

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
  fnf?: Chart["fnf"];
}

type Json = Record<string, unknown>;

/** FNF: "right" = player (BF) side, "left" = opponent side. */
export type FnfSide = "left" | "right";
export type ChartType = "mania" | "fnf";

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Legacy FNF: { song: { song, bpm, notes: [{ mustHitSection, sectionNotes }] } } */
function parseFnfLegacy(song: Json, side: FnfSide = "right"): ParsedChart {
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
      if (isPlayer !== (side === "right")) continue;
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
function parseFnfVslice(root: Json, side: FnfSide = "right"): ParsedChart | null {
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
    if (data < 0 || data > 7) continue;
    if ((data < 4) !== (side === "right")) continue; // 0-3 = player (right)
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

/** Parse an FNF chart JSON for the chosen side. */
export function parseFnfJson(text: string, side: FnfSide): ParsedChart {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error("FNF譜面がJSONとして読み込めませんでした");
  }
  if (!root || typeof root !== "object") throw new Error("FNF譜面の形式が読み取れませんでした");
  const obj = root as Json;
  const parseSide = (s: FnfSide) => {
    if (obj["song"] && typeof obj["song"] === "object") {
      return parseFnfLegacy(obj["song"] as Json, s);
    }
    return parseFnfVslice(obj, s) ?? parseFnfLegacy(obj, s);
  };
  const left = parseSide("left");
  const right = parseSide("right");
  const selected = side === "left" ? left : right;
  if (selected.notes.length > 0) return {
    ...selected,
    fnf: { playerSide: side, left: left.notes, right: right.notes },
  };
  throw new Error(
    side === "right" ? "右サイド（プレイヤー側）の譜面がありません" : "左サイド（相手側）の譜面がありません",
  );
}

/** Which FNF sides contain notes. */
export function detectFnfSides(text: string): Record<FnfSide, number> {
  const count = (side: FnfSide) => {
    try {
      return parseFnfJson(text, side).notes.length;
    } catch {
      return 0;
    }
  };
  return { left: count("left"), right: count("right") };
}

/** Parse an osu!mania .osu beatmap (text format). */
export function parseOsuMania(text: string): ParsedChart {
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.includes("osu file format")) {
    if (text.trim().startsWith("{")) return parseChartJson(text);
    throw new Error("osu!maniaの .osu ファイルではありません");
  }
  let section = "";
  const kv: Record<string, string> = {};
  const hit: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) {
      section = m[1]!;
      continue;
    }
    if (section === "HitObjects") hit.push(line);
    else if (["General", "Metadata", "Difficulty"].includes(section)) {
      const i = line.indexOf(":");
      if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  if (kv["Mode"] && kv["Mode"] !== "3") throw new Error("osu!mania（Mode: 3）の譜面ではありません");
  const keys = Math.max(1, Math.round(Number(kv["CircleSize"]) || 4));
  const notes: ChartNote[] = [];
  for (const h of hit) {
    const p = h.split(",");
    const x = Number(p[0]);
    const time = Number(p[2]) / 1000;
    const type = Number(p[3]);
    if (!Number.isFinite(x) || !Number.isFinite(time)) continue;
    const lane = Math.min(keys - 1, Math.max(0, Math.floor((x * keys) / 512)));
    const isHold = (type & 128) !== 0;
    const end = isHold ? Number((p[5] ?? "").split(":")[0]) / 1000 : 0;
    notes.push({
      beat: time,
      lane,
      kind: "tap",
      ...(isHold && end > time ? { lengthBeats: end - time } : {}),
    });
  }
  if (notes.length === 0) throw new Error("この .osu ファイルにノーツがありません");
  notes.sort((a, b) => a.beat - b.beat);
  return {
    bpm: 60,
    offset: 0,
    laneCount: keys,
    notes,
    format: "osu-mania",
    ...(kv["Title"] ? { title: kv["TitleUnicode"] || kv["Title"] } : {}),
    ...(kv["Artist"] ? { artist: kv["ArtistUnicode"] || kv["Artist"] } : {}),
    ...(kv["Version"] ? { difficultyName: kv["Version"] } : {}),
  };
}

/** Parse an uploaded chart according to its declared type. */
export function parseChartByType(text: string, type: string, side: string = "right"): ParsedChart {
  if (type === "fnf") return parseFnfJson(text, side === "left" ? "left" : "right");
  if (type === "mania") return parseOsuMania(text);
  return parseChartJson(text);
}
