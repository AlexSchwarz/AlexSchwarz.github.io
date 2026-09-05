import {
  geocodingAddress,
  normalizeForMatch,
  parseCoordinatesFromUrl,
  readJson,
  sleep,
  writeJson,
} from "./lib.mjs";

const sourcePath = new URL("../data/museums.source.json", import.meta.url);
const cachePath = new URL("../data/geocode-cache.json", import.meta.url);
const overridesPath = new URL("../data/coordinate-overrides.json", import.meta.url);
const outputPath = new URL("../data/museums.generated.json", import.meta.url);

const museums = await readJson(sourcePath);
const cache = await readJson(cachePath, {});
const overrides = await readJson(overridesPath, {});

function candidateScore(candidate, query) {
  const label = normalizeForMatch(candidate.attrs.label);
  const normalizedQuery = normalizeForMatch(query);
  const queryNumber = normalizedQuery.match(/\b\d+[a-z]?\b/)?.[0];
  const street = normalizedQuery.replace(/\b\d+[a-z]?\b.*$/, "").trim();
  let score = 0;
  if (street && label.includes(street)) score += 40;
  if (queryNumber && new RegExp(`\\b${queryNumber}\\b`).test(label)) score += 35;
  if (label.includes("zurich")) score += 10;
  score -= candidate.attrs.rank ?? 0;
  return score;
}

async function geocode(query) {
  if (cache[query]) return cache[query];

  const url = new URL("https://api3.geo.admin.ch/rest/services/api/SearchServer");
  url.searchParams.set("searchText", `${query}, Zürich`);
  url.searchParams.set("type", "locations");
  url.searchParams.set("origins", "address");
  url.searchParams.set("limit", "8");
  url.searchParams.set("sr", "4326");

  const response = await fetch(url, {
    headers: { "User-Agent": "LangeNachtMuseumMap/1.0 (local prototype)" },
  });
  if (!response.ok) throw new Error(`Geocoder returned HTTP ${response.status} for ${query}`);

  const payload = await response.json();
  const candidates = (payload.results ?? [])
    .filter((candidate) => Number.isFinite(candidate.attrs?.lat) && Number.isFinite(candidate.attrs?.lon))
    .map((candidate) => ({ ...candidate, score: candidateScore(candidate, query) }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const result = best
    ? {
        latitude: best.attrs.lat,
        longitude: best.attrs.lon,
        label: best.attrs.label,
        score: best.score,
      }
    : null;

  cache[query] = result;
  await writeJson(cachePath, cache);
  await sleep(180);
  return result;
}

const generated = [];
for (const museum of museums) {
  const override = overrides[String(museum.id)];
  let locations;

  if (override?.locations?.length) {
    locations = override.locations.map((location) => ({ ...location, source: "reviewed" }));
  } else {
    const fromUrl = parseCoordinatesFromUrl(museum.mapsUrl);
    if (fromUrl) {
      locations = [{ label: museum.title, ...fromUrl }];
    } else {
      const query = override?.query ?? geocodingAddress(museum.address);
      const result = await geocode(query);
      locations = result
        ? [{
            label: museum.title,
            latitude: result.latitude,
            longitude: result.longitude,
            source: override?.query ? "reviewed" : "geocoder",
            matchLabel: result.label,
            matchScore: result.score,
          }]
        : [];
    }
  }

  generated.push({ ...museum, locations });
}

await writeJson(outputPath, generated);
console.log(`Generated ${generated.length} museums with ${generated.reduce((sum, museum) => sum + museum.locations.length, 0)} physical locations.`);
