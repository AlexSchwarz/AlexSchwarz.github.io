const map = L.map("map", {
  zoomControl: false,
  minZoom: 11,
  scrollWheelZoom: "center",
  wheelDebounceTime: 60,
  wheelPxPerZoomLevel: 120,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  bounceAtZoomLimits: false,
}).setView([47.373, 8.538], 13);

L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const markerLayer = L.featureGroup().addTo(map);
const cardsContainer = document.querySelector("#museum-cards");
const searchInput = document.querySelector("#museum-search");
const summary = document.querySelector("#location-summary");
const fitButton = document.querySelector("#fit-map");
const markersByMuseum = new Map();
const markerGroups = [];
let museums = [];
const PIN_COLOR_COUNT = 7;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function featureLabels(features) {
  const labels = {
    wheelchairAccessible: "Rollstuhlgängig",
    eatAndDrink: "Essen & Trinken",
  };
  return features.map((feature) => labels[feature]).filter(Boolean);
}

function pinColorIndex(key) {
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % PIN_COLOR_COUNT;
}

function markerIcon(group) {
  const grouped = group.items.length > 1;
  return L.divIcon({
    className: `museum-marker pin-color-${group.colorIndex}${grouped ? " museum-marker--group" : ""}`,
    html: `<span>${group.pinNumber}</span>`,
    iconSize: [29, 29],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  });
}

function popupOptions() {
  const mobile = window.matchMedia("(max-width: 680px)").matches;
  return {
    maxWidth: 360,
    minWidth: 280,
    autoPanPaddingTopLeft: mobile ? L.point(12, 12) : L.point(306, 14),
    autoPanPaddingBottomRight: mobile ? L.point(12, 205) : L.point(14, 14),
  };
}

function sharedLocationPicker(group, selectedMuseum) {
  if (!group || group.items.length < 2) return "";

  return `
    <label class="popup-switcher">
      <span>Museum an diesem Ort</span>
      <select data-shared-location-picker data-popup-group="${escapeHtml(group.key)}" aria-label="Museum an diesem Ort wechseln">
        ${group.items
          .map(
            ({ museum }) =>
              `<option value="${museum.id}"${museum.id === selectedMuseum.id ? " selected" : ""}>${escapeHtml(museum.title)}</option>`,
          )
          .join("")}
      </select>
    </label>
  `;
}

function programContent(entries = []) {
  const countLabel = entries.length === 1 ? "1 Eintrag" : `${entries.length} Einträge`;
  const list = entries.length
    ? `<div class="popup-program-list">
        ${entries
          .map(
            (entry) => `
              <article class="popup-program-entry">
                <div class="popup-program-meta">
                  <span>${escapeHtml(entry.time || "Ganzer Abend")}</span>
                  <span>${escapeHtml(entry.category)}</span>
                </div>
                <h3>${escapeHtml(entry.title)}</h3>
                ${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}
              </article>
            `,
          )
          .join("")}
      </div>`
    : '<p class="popup-program-empty">Für dieses Museum sind keine Programmeinträge verfügbar.</p>';

  return `
    <details class="popup-program">
      <summary>
        <span>Programm</span>
        <span>${countLabel}</span>
      </summary>
      ${list}
    </details>
  `;
}

function popupContent(museum, location, group) {
  const features = featureLabels(museum.features);
  const locationLabel =
    museum.locations.length > 1 && location.label !== museum.title
      ? `<p class="popup-location">${escapeHtml(location.label)}</p>`
      : "";
  const address = location.address || museum.address;
  const note = museum.addressNote
    ? `<p class="popup-note">${escapeHtml(museum.addressNote).replaceAll("\n", "<br>")}</p>`
    : "";
  const chips = features.length
    ? `<div class="popup-features">${features.map((feature) => `<span>${escapeHtml(feature)}</span>`).join("")}</div>`
    : "";

  return `
    <article class="popup-card">
      <header class="popup-top">
        <p class="popup-kicker"><span>Lange Nacht 2026</span><span>Standort #${group?.pinNumber ?? "–"}</span></p>
        <h2>${escapeHtml(museum.title)}</h2>
        ${locationLabel}
        ${sharedLocationPicker(group, museum)}
      </header>
      <div class="popup-body">
        <p class="popup-description">${escapeHtml(museum.description)}</p>
        <dl class="popup-meta">
          <dt>Adresse</dt><dd>${escapeHtml(address)}</dd>
          <dt>Geöffnet</dt><dd>${escapeHtml(museum.hours)}</dd>
          <dt>Anreise</dt><dd>${escapeHtml(museum.transport)}</dd>
        </dl>
        ${note}
        ${chips}
        ${programContent(museum.program)}
        <div class="popup-actions">
          <a class="popup-link" href="${escapeHtml(museum.programUrl)}" target="_blank" rel="noreferrer">Programm öffnen</a>
          <a class="popup-link popup-link--secondary" href="${escapeHtml(museum.mapsUrl)}" target="_blank" rel="noreferrer">Route</a>
        </div>
      </div>
    </article>
  `;
}

function groupPopupContent(group) {
  return `
    <article class="popup-card group-popup">
      <header class="popup-top">
        <p class="popup-kicker"><span>Gemeinsamer Standort</span><span>Standort #${group.pinNumber}</span></p>
        <h2>${group.items.length} Museen an diesem Ort</h2>
      </header>
      <div class="group-popup-list">
        ${group.items
          .map(
            ({ museum, location }) => `
              <button type="button" data-popup-museum="${museum.id}" data-popup-location="${escapeHtml(location.label)}">
                <strong>${escapeHtml(museum.title)}</strong>
                <span>${escapeHtml(museum.hours)}</span>
              </button>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function selectMuseum(museumId) {
  document.querySelectorAll(".museum-card").forEach((card) => {
    card.setAttribute("aria-current", String(card.dataset.museumId === String(museumId)));
  });
}

function openPopupAfterMove(marker, content) {
  map.closePopup();
  marker.setPopupContent(content);
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    map.off("moveend", open);
    marker.openPopup();
  };
  map.once("moveend", open);
  window.setTimeout(open, 720);
}

function openMuseum(museum) {
  const entries = markersByMuseum.get(museum.id) ?? [];
  if (!entries.length) return;

  selectMuseum(museum.id);
  const bounds = L.latLngBounds(museum.locations.map((location) => [location.latitude, location.longitude]));
  const first = entries[0];

  if (museum.locations.length > 1) {
    map.fitBounds(bounds.pad(0.65), { maxZoom: 15, animate: true });
  } else {
    map.flyTo([first.location.latitude, first.location.longitude], Math.max(map.getZoom(), 15), {
      duration: 0.55,
    });
  }
  openPopupAfterMove(first.marker, popupContent(museum, first.location, first.group));
}

function createCard(museum) {
  const groups = [...new Map(
    (markersByMuseum.get(museum.id) ?? []).map(({ group }) => [group.key, group]),
  ).values()];
  const card = document.createElement("button");
  card.type = "button";
  card.className = "museum-card";
  card.dataset.museumId = String(museum.id);
  card.dataset.searchText = `${museum.title} ${museum.address}`.toLocaleLowerCase("de");
  card.setAttribute("aria-current", "false");
  card.setAttribute("aria-label", `${museum.title} auf der Karte öffnen`);
  card.innerHTML = `
    <span class="card-pins" aria-hidden="true">
      ${groups.map((group) => `<span class="card-pin pin-color-${group.colorIndex}">${group.pinNumber}</span>`).join("")}
    </span>
    <span class="card-copy">
      <strong>${escapeHtml(museum.title)}</strong>
      <span>${escapeHtml(museum.address)} · ${escapeHtml(museum.hours)}</span>
    </span>
    <span class="card-arrow" aria-hidden="true">›</span>
  `;
  card.addEventListener("click", () => openMuseum(museum));
  return card;
}

function groupLocations(records) {
  const groups = new Map();
  for (const museum of records) {
    for (const location of museum.locations) {
      const key = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
      const group = groups.get(key) ?? {
        key,
        latitude: location.latitude,
        longitude: location.longitude,
        items: [],
      };
      group.items.push({ museum, location });
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

function renderMarkers(records) {
  const groups = groupLocations(records);
  groups.forEach((group, index) => {
    group.pinNumber = index + 1;
    group.colorIndex = pinColorIndex(group.key);
  });

  for (const group of groups) {
    const label =
      group.items.length > 1
        ? `Standort ${group.pinNumber}, ${group.items.length} Museen: ${group.items.map(({ museum }) => museum.title).join(", ")}`
        : `Standort ${group.pinNumber}: ${group.items[0].museum.title}`;
    const marker = L.marker([group.latitude, group.longitude], {
      icon: markerIcon(group),
      title: label,
    }).addTo(markerLayer);

    marker.bindPopup(
      group.items.length > 1
        ? groupPopupContent(group)
        : popupContent(group.items[0].museum, group.items[0].location, group),
      popupOptions(),
    );
    marker.on("click", () => {
      selectMuseum(group.items.length === 1 ? group.items[0].museum.id : "");
    });
    marker.on("popupclose", () => selectMuseum(""));

    group.marker = marker;
    markerGroups.push(group);
    for (const item of group.items) {
      const entries = markersByMuseum.get(item.museum.id) ?? [];
      entries.push({ marker, location: item.location, group });
      markersByMuseum.set(item.museum.id, entries);
    }
  }
}

function renderCards(records) {
  cardsContainer.replaceChildren(...records.map(createCard));
}

function fitVisibleMarkers() {
  map.closePopup();
  selectMuseum("");
  const visibleMarkers = markerGroups
    .filter((group) => markerLayer.hasLayer(group.marker))
    .map((group) => group.marker);
  if (!visibleMarkers.length) return;
  map.fitBounds(L.featureGroup(visibleMarkers).getBounds().pad(0.12), {
    maxZoom: 14,
    animate: true,
  });
}

function applySearch() {
  const query = searchInput.value.trim().toLocaleLowerCase("de");
  const visibleMuseumIds = new Set();
  let visibleCount = 0;

  document.querySelectorAll(".museum-card").forEach((card) => {
    const visible = !query || card.dataset.searchText.includes(query);
    card.hidden = !visible;
    if (visible) {
      visibleCount += 1;
      visibleMuseumIds.add(Number(card.dataset.museumId));
    }
  });

  for (const group of markerGroups) {
    const visible = group.items.some(({ museum }) => visibleMuseumIds.has(museum.id));
    if (visible && !markerLayer.hasLayer(group.marker)) markerLayer.addLayer(group.marker);
    if (!visible && markerLayer.hasLayer(group.marker)) markerLayer.removeLayer(group.marker);
  }

  summary.textContent = query
    ? `${visibleCount} von ${museums.length} Museen`
    : `${museums.length} Museen · ${markerGroups.length} Standorte`;
  cardsContainer.querySelector(".list-status--empty")?.remove();
  if (visibleCount === 0) {
    const empty = document.createElement("p");
    empty.className = "list-status list-status--empty";
    empty.textContent = "Kein Museum gefunden.";
    cardsContainer.appendChild(empty);
  }
}

map.getContainer().addEventListener("click", (event) => {
  const button = event.target.closest("[data-popup-museum]");
  if (!button) return;
  const museum = museums.find((item) => item.id === Number(button.dataset.popupMuseum));
  const entry = (markersByMuseum.get(museum?.id) ?? []).find(
    ({ location }) => location.label === button.dataset.popupLocation,
  );
  if (museum && entry) {
    selectMuseum(museum.id);
    entry.marker.setPopupContent(popupContent(museum, entry.location, entry.group));
  }
});

map.getContainer().addEventListener("change", (event) => {
  const picker = event.target.closest("[data-shared-location-picker]");
  if (!picker) return;

  const group = markerGroups.find((item) => item.key === picker.dataset.popupGroup);
  const selected = group?.items.find(({ museum }) => museum.id === Number(picker.value));
  if (!group || !selected) return;

  selectMuseum(selected.museum.id);
  group.marker.setPopupContent(popupContent(selected.museum, selected.location, group));
});

fitButton.addEventListener("click", fitVisibleMarkers);
searchInput.addEventListener("input", applySearch);

async function loadMuseums() {
  try {
    const response = await fetch("data/museums.generated.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    museums = await response.json();
    if (!Array.isArray(museums) || museums.length === 0) throw new Error("Empty data set");

    renderMarkers(museums);
    renderCards(museums);
    applySearch();
    fitVisibleMarkers();
  } catch (error) {
    console.error("Could not load museum data", error);
    summary.textContent = "Daten nicht verfügbar";
    cardsContainer.innerHTML =
      '<p class="list-status list-status--error">Die Museumsdaten konnten nicht geladen werden. Bitte die Seite neu laden.</p>';
    searchInput.disabled = true;
    fitButton.disabled = true;
  }
}

loadMuseums();
