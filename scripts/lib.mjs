import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_ORIGIN = "https://langenacht-zuerich.ch";
export const MUSEUMS_API = `${SITE_ORIGIN}/api/longnight/museums?culture=de-ch&limit=1000&museumsOverviewNodeId=7384&skip=0`;

const namedEntities = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function decodeHtml(value = "") {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return namedEntities[entity.toLowerCase()] ?? match;
  });
}

export function htmlToText(value = "") {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function paragraphsFromHtml(value = "") {
  const paragraphs = [];
  for (const match of value.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = htmlToText(match[1]);
    if (text) paragraphs.push(text);
  }
  return paragraphs.length ? paragraphs : [htmlToText(value)].filter(Boolean);
}

export function absoluteUrl(value) {
  return value ? new URL(value, SITE_ORIGIN).href : null;
}

export function normalizedAddress(markup) {
  const paragraphs = paragraphsFromHtml(markup);
  const address = (paragraphs[0] ?? "")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  const addressNote = paragraphs
    .slice(1)
    .filter((part) => !/^Zugänglichkeit(?:\s|$)/i.test(part))
    .join("\n") || null;
  return { address, addressNote };
}

export function geocodingAddress(address) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const numbered = parts.filter((part) => /\d/.test(part));
  const streetLike = numbered.find((part) =>
    /(strasse|straße|gasse|quai|platz|weg|rain|hofstatt|zäune|sackzelg|steig|promenade|ring)\b/i.test(part),
  );
  return streetLike ?? numbered.at(-1) ?? parts.at(-1) ?? address;
}

export function normalizeForMatch(value = "") {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseCoordinatesFromUrl(url = "") {
  const precise = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (precise) {
    return { latitude: Number(precise[1]), longitude: Number(precise[2]), source: "url" };
  }
  return null;
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== null) return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  const filesystemPath = path instanceof URL ? fileURLToPath(path) : path;
  await mkdir(dirname(filesystemPath), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
