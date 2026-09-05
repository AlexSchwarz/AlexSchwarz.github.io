import { MUSEUMS_API, absoluteUrl, htmlToText, normalizedAddress, writeJson } from "./lib.mjs";

const PROGRAM_API = "https://langenacht-zuerich.ch/api/longnight";
const PROGRAM_PARAMS = "culture=de-ch&limit=1000&programNodeId=7383&skip=0";
const PROGRAM_CATEGORY_PARAMS = {
  Veranstaltung: "event-category",
  Ausstellung: "exhibition-category",
  "Essen & Trinken": "culinary-category",
};

function programUrlFor(record) {
  const url = absoluteUrl(record.detailUrl);
  if (!url) return null;

  const parsed = new URL(url);
  if (parsed.hostname !== "langenacht-zuerich.ch" || parsed.pathname !== "/programm") return url;

  parsed.search = "";
  parsed.searchParams.set("culture", "de-ch");
  parsed.searchParams.set("museum", String(record.id));
  return parsed.href;
}

async function fetchJson(url, label) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${label} API returned HTTP ${response.status}`);
  return response.json();
}

const [sourceRecords, eventGroups, exhibitions, culinary] = await Promise.all([
  fetchJson(MUSEUMS_API, "Museum"),
  fetchJson(`${PROGRAM_API}/events?${PROGRAM_PARAMS}`, "Events"),
  fetchJson(`${PROGRAM_API}/exhibitions?${PROGRAM_PARAMS}`, "Exhibitions"),
  fetchJson(`${PROGRAM_API}/culinary?${PROGRAM_PARAMS}`, "Culinary"),
]);
if (!Array.isArray(sourceRecords)) {
  throw new Error("Museum API did not return an array");
}

const programByMuseum = new Map();
const museumIdsByTitle = new Map(
  sourceRecords.map((record) => [record.title?.trim(), record.id]),
);

function programEntryUrl(entry, category) {
  const museumId = museumIdsByTitle.get(entry.museum?.trim());
  if (!museumId) throw new Error(`Programme entry has unknown museum: ${entry.museum}`);

  const url = new URL("/programm", PROGRAM_API);
  url.searchParams.set("culture", "de-ch");
  url.searchParams.set("museum", String(museumId));
  url.searchParams.set("searchTerm", htmlToText(entry.title));
  url.searchParams.set("limit", "1000");
  url.searchParams.set("skip", "0");
  url.searchParams.set("programNodeId", "7383");
  url.searchParams.set("category", PROGRAM_CATEGORY_PARAMS[category]);
  return url.href;
}

function addProgramEntry(entry, category, fallbackTime = "") {
  const items = programByMuseum.get(entry.museum) ?? [];
  items.push({
    id: entry.id,
    category,
    title: htmlToText(entry.title),
    description: htmlToText(entry.lead),
    time: htmlToText(entry.experienceInfo) || htmlToText(fallbackTime),
    detailUrl: programEntryUrl(entry, category),
  });
  programByMuseum.set(entry.museum, items);
}

for (const group of eventGroups) {
  for (const entry of group.events ?? []) addProgramEntry(entry, "Veranstaltung", group.timetableLabel);
}
for (const entry of exhibitions) addProgramEntry(entry, "Ausstellung");
for (const entry of culinary) addProgramEntry(entry, "Essen & Trinken");

const records = sourceRecords
  .map((record) => {
    const { address, addressNote } = normalizedAddress(record.addressMarkup);
    return {
      id: record.id,
      title: record.title?.trim() ?? "",
      description: record.text?.trim() ?? "",
      address,
      addressNote,
      hours: htmlToText(record.openingTimesInfoMarkup),
      transport: htmlToText(record.publicTransportDetailsMarkup).replace(/\n+/g, " · "),
      programUrl: programUrlFor(record),
      mapsUrl: absoluteUrl(record.googleMapsUrl),
      imageUrl: absoluteUrl(record.imageUrls?.[0]),
      features: [...(record.icons ?? [])].sort(),
      program: programByMuseum.get(record.title?.trim()) ?? [],
    };
  })
  .sort((a, b) => a.title.localeCompare(b.title, "de"));

await writeJson(new URL("../data/museums.source.json", import.meta.url), records);
console.log(
  `Imported ${records.length} museum records and ${records.reduce((sum, museum) => sum + museum.program.length, 0)} programme entries from the official API.`,
);
