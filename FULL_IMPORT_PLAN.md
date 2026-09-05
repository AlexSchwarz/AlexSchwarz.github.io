# Plan: import every Lange Nacht museum into the map

## Objective

Extend the existing three-location prototype so it displays every current
participant from the 2026 Lange Nacht website. Keep the result a local static
site: the browser should read a generated JSON file and must not depend on the
event API, a geocoder, or Google Maps while the user is navigating the map.

The official API currently returns **52 museum records**.

## Authoritative source

Fetch the records from the event site's JSON endpoint instead of scraping the
rendered HTML:

```text
https://langenacht-zuerich.ch/api/longnight/museums?culture=de-ch&limit=1000&museumsOverviewNodeId=7384&skip=0
```

Each record currently contains:

- `id`
- `title`
- `text` — museum description
- `addressMarkup`
- `openingTimesInfoMarkup`
- `publicTransportDetailsMarkup`
- `detailUrl` — museum-specific programme filter
- `googleMapsUrl`
- `imageUrls`
- `icons` — for example wheelchair accessibility and food/drink

Do not make the production map fetch this API in the browser. Import it once,
normalize it, verify it, and commit the generated data file. This avoids CORS,
network, API-change, and event-night availability problems.

## Files to add or change

```text
museum-map-poc/
  app.js                         update map to load generated data
  index.html                     retain the current compact map shell
  styles.css                     add dense-list and grouped-marker states
  data/
    museums.generated.json      normalized records used by the browser
    coordinate-overrides.json   reviewed fixes for ambiguous venues
  scripts/
    sync-museums.mjs            fetch and normalize the official API
    geocode-museums.mjs          resolve and cache coordinates
    validate-museums.mjs         fail on missing or suspicious data
```

The scripts must run with Node.js. Prefer built-in Node APIs so the static
prototype remains dependency-light. If an HTML parser is added, keep it local
and use it only in the import scripts.

## Normalized data model

Write each browser-facing record in this shape:

```json
{
  "id": 1145,
  "title": "Landesmuseum Zürich",
  "description": "…",
  "address": "Museumstrasse 2, 8001 Zürich",
  "addressNote": null,
  "hours": "18–02 Uhr",
  "transport": "Shuttle M3; Bahnhofquai/HB …",
  "programUrl": "https://langenacht-zuerich.ch/programm?culture=de-ch&museum=1145",
  "mapsUrl": "https://…",
  "imageUrl": "https://langenacht-zuerich.ch/media/…",
  "features": ["wheelchairAccessible", "eatAndDrink"],
  "locations": [
    {
      "label": "Landesmuseum Zürich",
      "latitude": 47.3791,
      "longitude": 8.5402,
      "source": "reviewed"
    }
  ]
}
```

Use a `locations` array even for ordinary museums. It cleanly handles a single
event record representing multiple physical venues.

## Phase 1: import and clean the museum records

1. `sync-museums.mjs` requests the endpoint and requires HTTP 200 plus JSON.
2. Assert that the response is an array and currently contains 52 records.
   Treat a later count change as a warning requiring review, not as permission
   to silently discard or invent entries.
3. Convert the HTML fields to readable plain text:
   - `<br>` becomes a line break or separator.
   - HTML entities such as `&#228;` and `&nbsp;` are decoded.
   - Accessibility links are removed from the address text and represented by
     `features` instead.
   - Preserve operational notes such as alternative entrances, last admission,
     meeting points, and waiting-time warnings in `addressNote`.
4. Resolve relative `detailUrl` and `imageUrls` values against
   `https://langenacht-zuerich.ch`.
5. Preserve the German wording from the official source. Do not rewrite or
   summarize the descriptions.
6. Sort by title for a stable diff, while keeping `id` as the durable identity.

## Phase 2: produce reliable coordinates

Use a deterministic, reviewable pipeline rather than manually pasting 49 new
coordinate pairs into `app.js`.

1. Parse coordinates directly when the supplied Google Maps URL contains an
   explicit `@latitude,longitude` or `!3d…!4d…` pair.
2. For the remaining records, derive a geocoding query from the cleaned street
   address plus `Zürich, Switzerland`.
3. Geocode with one documented provider. Prefer the Swiss federal location
   search or OpenStreetMap Nominatim. When using Nominatim:
   - send an identifying User-Agent;
   - make at most one request per second;
   - cache every response locally;
   - never geocode again when a reviewed cached result exists.
4. Score candidates using street name, house number, postcode, city, and museum
   name. Never select a weak first result only because it was returned first.
5. Store uncertain or exceptional results in `coordinate-overrides.json` with a
   short reason. The generated file should record the coordinate source as
   `url`, `geocoder`, or `reviewed`.
6. Validate that ordinary venues fall in the expected Zürich region. Allow an
   override for a legitimate outlying venue instead of enforcing an overly
   narrow city bounding box.

## Phase 3: explicitly review special cases

These cases must not be flattened blindly:

- **Altstadtkirchen** represents Fraumünster, Grossmünster, St. Peter, and
  Wasserkirche. Create four physical locations pointing to the same museum
  record.
- **Archäologische Fenster** mentions Ehgraben and Schifflände 30/32. Confirm
  whether these are one entrance or separate programme venues and model them
  accordingly.
- **Einfach Zürich** and **Landesmuseum Zürich** share Museumstrasse 2.
- **extract ETH Zürich**, **Graphische Sammlung ETH Zürich**, and the
  **Thomas-Mann-Archiv** share Rämistrasse 101.
- The two **Museum für Gestaltung Zürich** records are separate venues and must
  retain their own addresses even though the supplied Maps URLs may be similar.
- Some Maps URLs are shortened links, and one record currently links to a city
  website rather than a map. Do not rely on resolving those links as the only
  coordinate strategy.

The map may therefore contain more physical location pins than the 52 API
records.

## Phase 4: render the complete map

1. Replace the hard-coded `museums` array in `app.js` with a fetch of
   `data/museums.generated.json`.
2. Show a small loading state in the compact overview while the JSON loads.
3. On failure, show a useful message in the overview instead of leaving a blank
   map.
4. Create one marker per physical item in each record's `locations` array.
5. Keep the current small, upright marker style.
6. Fit the initial view to every location after markers are added.
7. The overview should show one row per museum record, not one row per pin.
   Selecting a multi-location record should fit all of that record's pins.
8. A marker popup should show:
   - museum name and optional location label;
   - official description;
   - address and operational note;
   - event hours;
   - public-transport information;
   - link to the museum-specific programme;
   - original Maps link as a secondary directions link.
9. Do not number 52 entries as though they form a visit sequence. Use a compact
   museum dot or icon; reserve numbers for an actual itinerary feature later.

## Phase 5: handle overlapping markers

Several museum records intentionally share a building. At an identical or
near-identical coordinate:

- show a small count badge rather than stacking inaccessible markers;
- clicking it should reveal the colocated museums or expand/spiderfy them;
- selecting a museum from the overview must still open that museum's details.

If a clustering library is used, vendor its JavaScript and CSS locally. The
earlier prototype failure was caused by externally hosted Leaflet CSS not
loading, so no required map styling should depend on a CDN.

## Phase 6: validation

Automated checks in `validate-museums.mjs` must fail when:

- the generated record count is not the fetched record count;
- an ID is duplicated;
- a title, description, cleaned address, hours value, or programme URL is empty;
- a record has no physical location;
- coordinates are not finite numbers or fall outside plausible Switzerland
  bounds without an explicit reviewed override;
- a relative URL remains in the generated browser data;
- HTML tags remain in a plain-text field.

Also print a review report containing:

- total museum records;
- total physical locations;
- number of coordinates from URLs, geocoding, and overrides;
- colocated groups;
- all warnings and ambiguous addresses.

## Manual acceptance test

1. Start the existing local server and open the map on desktop and a narrow
   mobile viewport.
2. Confirm the map initially includes every pin and has no broken tile seams.
3. Pan and wheel-zoom in both directions.
4. Select at least:
   - a normal single-location museum;
   - Altstadtkirchen;
   - one shared-building ETH record;
   - Museum Rietberg;
   - Zoo Zürich or another edge-of-map location.
5. Verify that the correct popup appears fully inside the viewport and contains
   the official text, hours, address, and programme link.
6. Confirm `Alle zeigen` returns to the complete extent.
7. Confirm the browser console has no errors.

## Recommended execution order

1. Build `sync-museums.mjs` and generate normalized records without coordinates.
2. Build the geocoding cache and manual overrides.
3. Run validation until every record has reviewed coordinates.
4. Switch `app.js` to the generated JSON.
5. Add overlap handling and multi-location behavior.
6. Perform the acceptance test and correct data issues.
7. Re-run the import once immediately before delivery and inspect the diff for
   last-minute event-site changes.

## Definition of done

- Every record returned by the official API is represented.
- Every physical venue has a usable map location.
- Descriptions and operational information match the official source.
- Overlapping and multi-location museums remain discoverable.
- The page remains a static localhost site and does not call the event API or a
  geocoder at runtime.
- All required Leaflet layout CSS is local.
- Validation and the manual acceptance test pass.
