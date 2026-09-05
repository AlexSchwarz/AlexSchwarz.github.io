# Museumsnacht Zürich – map proof of concept

This static map contains all 52 records currently published for the 2026 event,
represented by 55 physical locations. It uses [Leaflet](https://leafletjs.com/)
and OpenStreetMap tiles, so an internet connection is required while viewing the
page.

## Run locally

From the repository root (Node.js is the only requirement):

```powershell
node museum-map-poc/server.mjs
```

Then open <http://localhost:4173>.

The browser reads a committed snapshot in `data/museums.generated.json`; it does
not call the event API or a geocoder at runtime. To refresh and validate the
snapshot from the official source:

```powershell
cd museum-map-poc
npm run data:sync
```

The importer reads the official [Lange Nacht museum listing](https://langenacht-zuerich.ch/museen)
and programme APIs, normalizes museum details and programme entries, and resolves
street addresses through the Swiss federal location search. Reviewed exceptional
locations are stored in `data/coordinate-overrides.json`.
