import { MUSEUMS_API, absoluteUrl, htmlToText, normalizedAddress, writeJson } from "./lib.mjs";

const PROGRAM_API = "https://langenacht-zuerich.ch/api/longnight";
const PROGRAM_PARAMS = "culture=de-ch&limit=1000&programNodeId=7383&skip=0";

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

function addProgramEntry(entry, category, fallbackTime = "") {
  const items = programByMuseum.get(entry.museum) ?? [];
  items.push({
    id: entry.id,
    category,
    title: htmlToText(entry.title),
    description: htmlToText(entry.lead),
    time: htmlToText(entry.experienceInfo) || htmlToText(fallbackTime),
    detailUrl: absoluteUrl(entry.detailUrl),
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
      programUrl: absoluteUrl(record.detailUrl),
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
