/**
 * WLN1 nearest-pack layout, little-endian.
 *
 * Header, 14 bytes, struct `<4sHIHH`:
 *   char[4] magic = "WLN1"
 *   uint16  version = 1, or 2 when a display-vocab flag byte follows the header
 *   uint32  count
 *   uint16  dims = 300
 *   uint16  quantizer
 *
 * Version 2 inserts uint8 display[count] immediately after the header.
 * A 1 means the row may be used as a "you are here" label.
 *
 * Quantizer 1 (symmetric per-vector int8):
 *   float16 scales[count]
 *   int8    matrix[count * dims], row-major
 *   then count words: uint8 byteLength, utf-8 bytes
 *
 * Quantizer 2 (IEEE binary16 rows, no scale table):
 *   float16 matrix[count * dims], row-major
 *   then the same word table
 *
 * Words are alphabetical. `nearestWord` breaks a top-two cosine gap
 * below 3e-5 by choosing the earliest word in that band, which is the
 * float32 argmax rule on exact ties.
 */
import { cosine, dequantize, float16BitsToFloat32 } from "@wordelate/game-math";
import { labelCount, labelRejected } from "./labels.js";

const HEADER_BYTES = 14;
const VERSION = 1;
const VERSION_DISPLAY = 2;
const QUANT_INT8 = 1;
const QUANT_F16 = 2;
const DIMS = 300;
/** Near-tie band. Float32 top-1 gaps below this are ulp noise. */
const TIE_EPS = 3e-5;

export type Pack = {
  words: string[];
  rows: Float32Array[];
  index: Map<string, number>;
  /** 1 when the row is in the display vocabulary. Version 1 packs are all 1s. */
  display: Uint8Array;
};

export type PackProgress = {
  ratio: number | null;
  label: string;
};

export function rowFor(pack: Pack, word: string): Float32Array | null {
  const index = pack.index.get(word.toLowerCase());
  if (index === undefined) return null;
  return pack.rows[index] ?? null;
}

/** Alphabetical prefix matches. The pack stores words in alphabetical order. */
export function suggestWords(pack: Pack, prefix: string, limit = 8): string[] {
  const needle = prefix.trim().toLowerCase();
  if (needle.length === 0) return [];
  const words = pack.words;
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const word = words[mid] ?? "";
    if (word < needle) lo = mid + 1;
    else hi = mid;
  }
  const out: string[] = [];
  for (let i = lo; i < words.length && out.length < limit; i++) {
    const word = words[i];
    if (word === undefined || !word.startsWith(needle)) break;
    out.push(word);
  }
  return out;
}

/**
 * Nearest vocab word by cosine to `position`.
 * Excludes the start word and operands still on the equation. The goal may win.
 */
function cosineAt(
  pack: Pack,
  position: Float32Array,
  index: number,
  exclude: ReadonlySet<string>,
): { word: string; score: number } | null {
  const word = pack.words[index];
  const row = pack.rows[index];
  if (word === undefined || row === undefined) return null;
  if (exclude.has(word)) return null;
  return { word, score: cosine(position, row) };
}

export type LabelAnchor = { word: string; vector: Float32Array };

/**
 * Up to three label words for the current position.
 *
 * Skips each anchor and its inflections, skips non-display rows other than
 * the goal, and skips a non-goal word that is too close to any single anchor.
 * Returns one word while the goal similarity is cold, and three once it is warm.
 */
export async function nearestLabels(
  pack: Pack,
  position: Float32Array,
  anchors: readonly LabelAnchor[],
  goalWord: string,
  cutoff: number,
  goalSimilarity: number,
  warmSimilarity: number,
): Promise<string[]> {
  const goal = goalWord.toLowerCase();
  const anchorWords = anchors.map((anchor) => anchor.word.toLowerCase());
  const limit = labelCount(goalSimilarity, warmSimilarity);
  const ranked: { word: string; score: number }[] = [];
  const chunk = 3000;
  for (let start = 0; start < pack.words.length; start += chunk) {
    const end = Math.min(pack.words.length, start + chunk);
    for (let i = start; i < end; i++) {
      const word = pack.words[i];
      const row = pack.rows[i];
      if (word === undefined || row === undefined) continue;
      let nearestAnchor = Number.NEGATIVE_INFINITY;
      for (const anchor of anchors) {
        const similarity = cosine(row, anchor.vector);
        if (similarity > nearestAnchor) nearestAnchor = similarity;
      }
      if (
        labelRejected({
          word,
          goalWord: goal,
          anchors: anchorWords,
          display: pack.display[i] === 1,
          nearestAnchorCosine: nearestAnchor,
          cutoff,
        })
      ) {
        continue;
      }
      const score = cosine(position, row);
      if (ranked.length < 3 || score > (ranked[ranked.length - 1]?.score ?? Number.NEGATIVE_INFINITY)) {
        ranked.push({ word, score });
        ranked.sort((a, b) => b.score - a.score);
        if (ranked.length > 3) ranked.pop();
      }
    }
    if (end < pack.words.length) await yieldToUi();
  }
  if (ranked.length >= 2) {
    const first = ranked[0];
    const second = ranked[1];
    if (first && second && first.score - second.score < TIE_EPS && second.word < first.word) {
      ranked[0] = second;
      ranked[1] = first;
    }
  }
  return ranked.slice(0, limit).map((hit) => hit.word);
}

export async function nearestWord(
  pack: Pack,
  position: Float32Array,
  exclude: ReadonlySet<string>,
): Promise<string | null> {
  let best = Number.NEGATIVE_INFINITY;
  let second = Number.NEGATIVE_INFINITY;
  let bestWord: string | null = null;
  const chunk = 3000;
  for (let start = 0; start < pack.words.length; start += chunk) {
    const end = Math.min(pack.words.length, start + chunk);
    for (let i = start; i < end; i++) {
      const hit = cosineAt(pack, position, i, exclude);
      if (hit === null) continue;
      if (hit.score > best) {
        second = best;
        best = hit.score;
        bestWord = hit.word;
      } else if (hit.score > second) {
        second = hit.score;
      }
    }
    if (end < pack.words.length) await yieldToUi();
  }
  if (bestWord === null || !(best - second < TIE_EPS)) return bestWord;
  const floor = best - TIE_EPS;
  for (let start = 0; start < pack.words.length; start += chunk) {
    const end = Math.min(pack.words.length, start + chunk);
    for (let i = start; i < end; i++) {
      const hit = cosineAt(pack, position, i, exclude);
      if (hit !== null && hit.score >= floor) return hit.word;
    }
    if (end < pack.words.length) await yieldToUi();
  }
  return bestWord;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function loadPack(
  url: string,
  onProgress: (progress: PackProgress) => void,
): Promise<Pack> {
  onProgress({ ratio: 0, label: "Fetching vocabulary" });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Vocabulary request failed (${response.status})`);
  }
  const buffer = await readBody(response, onProgress);
  return decodePack(buffer, onProgress);
}

async function readBody(
  response: Response,
  onProgress: (progress: PackProgress) => void,
): Promise<ArrayBuffer> {
  const total = Number(response.headers.get("content-length") ?? "0");
  if (!response.body || !Number.isFinite(total) || total <= 0) {
    const buffer = await response.arrayBuffer();
    onProgress({ ratio: 1, label: "Fetching vocabulary" });
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.byteLength;
    onProgress({
      ratio: Math.min(1, received / total),
      label: "Fetching vocabulary",
    });
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

export async function decodePack(
  buffer: ArrayBuffer,
  onProgress: (progress: PackProgress) => void,
): Promise<Pack> {
  onProgress({ ratio: 0, label: "Decoding vectors" });
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error("Vocabulary file is truncated");
  }
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== "WLN1") throw new Error("Vocabulary file is not a WLN1 pack");
  const version = view.getUint16(4, true);
  if (version !== VERSION && version !== VERSION_DISPLAY) {
    throw new Error(`Unsupported vocabulary version ${version}`);
  }
  const count = view.getUint32(6, true);
  const dims = view.getUint16(10, true);
  const quantizer = view.getUint16(12, true);
  if (quantizer !== QUANT_INT8 && quantizer !== QUANT_F16) {
    throw new Error(`Unsupported quantizer ${quantizer}`);
  }
  if (dims !== DIMS) throw new Error(`Expected ${DIMS} dimensions, found ${dims}`);
  if (count <= 0) throw new Error("Vocabulary file is empty");

  const rows: Float32Array[] = new Array(count);
  const display = new Uint8Array(count);
  const flagBytes = version === VERSION_DISPLAY ? count : 0;
  if (version === VERSION_DISPLAY) {
    display.set(new Uint8Array(buffer, HEADER_BYTES, count));
  } else {
    display.fill(1);
  }
  let wordsOffset: number;
  if (quantizer === QUANT_F16) {
    wordsOffset = HEADER_BYTES + flagBytes + count * dims * 2;
    if (buffer.byteLength < wordsOffset) throw new Error("Vocabulary file is truncated");
    for (let i = 0; i < count; i++) {
      const row = new Float32Array(dims);
      const base = HEADER_BYTES + flagBytes + i * dims * 2;
      for (let d = 0; d < dims; d++) {
        row[d] = float16BitsToFloat32(view.getUint16(base + d * 2, true));
      }
      rows[i] = row;
      if (i > 0 && i % 2500 === 0) {
        onProgress({ ratio: i / count, label: "Decoding vectors" });
        await yieldToUi();
      }
    }
  } else {
    const scaleOffset = HEADER_BYTES + flagBytes;
    const matrixOffset = scaleOffset + count * 2;
    wordsOffset = matrixOffset + count * dims;
    if (buffer.byteLength < wordsOffset) throw new Error("Vocabulary file is truncated");
    const matrix = new Int8Array(buffer, matrixOffset, count * dims);
    for (let i = 0; i < count; i++) {
      const bits = view.getUint16(scaleOffset + i * 2, true);
      const scale = float16BitsToFloat32(bits);
      const quantized = matrix.subarray(i * dims, (i + 1) * dims);
      rows[i] = dequantize(quantized, scale);
      if (i > 0 && i % 2500 === 0) {
        onProgress({ ratio: i / count, label: "Decoding vectors" });
        await yieldToUi();
      }
    }
  }

  const decoded = decodeWords(new Uint8Array(buffer), wordsOffset, count);
  onProgress({ ratio: 1, label: "Decoding vectors" });
  return { words: decoded.words, rows, index: decoded.index, display };
}

function decodeWords(
  bytes: Uint8Array,
  wordsOffset: number,
  count: number,
): { words: string[]; index: Map<string, number> } {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const words: string[] = new Array(count);
  const index = new Map<string, number>();
  let cursor = wordsOffset;
  for (let i = 0; i < count; i++) {
    if (cursor >= bytes.length) throw new Error("Vocabulary file is truncated");
    const length = bytes[cursor] ?? 0;
    cursor += 1;
    const end = cursor + length;
    if (end > bytes.length) throw new Error("Vocabulary file is truncated");
    let word: string;
    try {
      word = decoder.decode(bytes.subarray(cursor, end));
    } catch {
      throw new Error("Vocabulary file has a word that is not UTF-8");
    }
    cursor = end;
    if (word.length === 0) throw new Error("Vocabulary file has an empty word");
    words[i] = word;
    index.set(word, i);
  }
  if (cursor !== bytes.length) throw new Error("Vocabulary file has trailing bytes");
  return { words, index };
}
