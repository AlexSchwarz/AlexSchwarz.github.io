import { readJson } from "./lib.mjs";

const museums = await readJson(new URL("../data/museums.generated.json", import.meta.url));
const errors = [];
const warnings = [];
const ids = new Set();
const sources = {};
const coordinateGroups = new Map();

for (const museum of museums) {
  if (ids.has(museum.id)) errors.push(`Duplicate ID: ${museum.id}`);
  ids.add(museum.id);

  for (const field of ["title", "description", "address", "hours", "programUrl"]) {
    if (!museum[field]) errors.push(`${museum.id} ${museum.title}: missing ${field}`);
    if (typeof museum[field] === "string" && /<[^>]+>/.test(museum[field])) {
      errors.push(`${museum.id} ${museum.title}: HTML remains in ${field}`);
    }
  }

  for (const field of ["programUrl", "mapsUrl", "imageUrl"]) {
    if (museum[field] && !/^https?:\/\//.test(museum[field])) {
      errors.push(`${museum.id} ${museum.title}: relative ${field}`);
    }
  }

  if (museum.programUrl) {
    const programUrl = new URL(museum.programUrl);
    if (programUrl.hostname === "langenacht-zuerich.ch" && programUrl.pathname === "/programm") {
      const linkedMuseumId = programUrl.searchParams.get("museum");
      if (linkedMuseumId !== String(museum.id)) {
        errors.push(`${museum.id} ${museum.title}: programme URL targets museum ${linkedMuseumId ?? "none"}`);
      }
    }
  }

  if (!Array.isArray(museum.program)) {
    errors.push(`${museum.id} ${museum.title}: missing programme entries`);
  }
  for (const entry of museum.program ?? []) {
    for (const field of ["title", "category", "detailUrl"]) {
      if (!entry[field]) errors.push(`${museum.id} ${museum.title}: programme entry missing ${field}`);
      if (typeof entry[field] === "string" && /<[^>]+>/.test(entry[field])) {
        errors.push(`${museum.id} ${museum.title}: HTML remains in programme ${field}`);
      }
    }
    if (entry.detailUrl && !/^https?:\/\//.test(entry.detailUrl)) {
      errors.push(`${museum.id} ${museum.title}: programme entry has relative detailUrl`);
    }
  }

  if (!museum.locations?.length) errors.push(`${museum.id} ${museum.title}: no location`);

  for (const location of museum.locations ?? []) {
    const { latitude, longitude, source } = location;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      errors.push(`${museum.id} ${museum.title}: invalid coordinate`);
      continue;
    }
    if (latitude < 45.8 || latitude > 47.9 || longitude < 5.9 || longitude > 10.6) {
      errors.push(`${museum.id} ${museum.title}: coordinate outside Switzerland`);
    }
    if (source === "geocoder" && (location.matchScore ?? 0) < 50) {
      warnings.push(`${museum.id} ${museum.title}: weak geocoder match (${location.matchScore}) ${location.matchLabel ?? ""}`);
    }
    sources[source] = (sources[source] ?? 0) + 1;
    const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const group = coordinateGroups.get(key) ?? [];
    group.push(museum.title);
    coordinateGroups.set(key, group);
  }
}

if (museums.length !== 52) {
  errors.push(`Expected the reviewed 2026 snapshot to contain 52 records; found ${museums.length}`);
}

const colocated = [...coordinateGroups.entries()].filter(([, titles]) => titles.length > 1);
console.log(`Museums: ${museums.length}`);
console.log(`Physical locations: ${museums.reduce((sum, museum) => sum + museum.locations.length, 0)}`);
console.log(`Coordinate sources: ${JSON.stringify(sources)}`);
console.log(`Colocated groups: ${colocated.length}`);
for (const [coordinate, titles] of colocated) {
  console.log(`  ${coordinate}: ${titles.join(" | ")}`);
}
for (const warning of warnings) console.warn(`WARNING: ${warning}`);

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validation passed with ${warnings.length} warning(s).`);
}
