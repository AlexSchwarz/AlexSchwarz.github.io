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
const favoritesFilter = document.querySelector("#favorites-filter");
const favoritesCount = document.querySelector("#favorites-count");
const summary = document.querySelector("#location-summary");
const fitButton = document.querySelector("#fit-map");
const museumList = document.querySelector("#museum-list");
const hideListButton = document.querySelector("#hide-list");
const showListButton = document.querySelector("#show-list");
const detailPanel = document.querySelector("#museum-detail");
const detailContent = document.querySelector("#museum-detail-content");
const markersByMuseum = new Map();
const markerGroups = [];
let museums = [];
let selectedLocationGroup = null;
let activeMuseumId = null;
let favoritesOnly = false;
const favoriteMuseumIds = new Set();
const favoriteProgramIds = new Set();
const PIN_COLOR_COUNT = 7;
const FAVORITES_STORAGE_KEY = "lndm-map-favorites-v1";
const FAVORITES_COOKIE_PREFIX = "lndm-map-favorites-v1";
const FAVORITES_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const FAVORITES_COOKIE_CHUNK_SIZE = 2500;

function parseFavoritePayload(value) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (!parsed || !Array.isArray(parsed.museums) || !Array.isArray(parsed.programs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cookieValues() {
  return new Map(
    document.cookie
      .split("; ")
      .filter(Boolean)
      .map((cookie) => {
        const separator = cookie.indexOf("=");
        return separator === -1
          ? [cookie, ""]
          : [cookie.slice(0, separator), cookie.slice(separator + 1)];
      }),
  );
}

function favoriteCookieAttributes(maxAge = FAVORITES_COOKIE_MAX_AGE) {
  return `Max-Age=${maxAge}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

function readFavoritesCookie() {
  const cookies = cookieValues();
  const chunkCount = Number(cookies.get(`${FAVORITES_COOKIE_PREFIX}-count`) ?? 0);
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 20) return null;

  let encoded = "";
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = cookies.get(`${FAVORITES_COOKIE_PREFIX}-${index}`);
    if (chunk === undefined) return null;
    encoded += chunk;
  }

  try {
    return parseFavoritePayload(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

function writeFavoritesCookie(payload) {
  const cookies = cookieValues();
  const previousCount = Number(cookies.get(`${FAVORITES_COOKIE_PREFIX}-count`) ?? 0);
  const encoded = encodeURIComponent(payload);
  const chunks = [];
  for (let offset = 0; offset < encoded.length; offset += FAVORITES_COOKIE_CHUNK_SIZE) {
    chunks.push(encoded.slice(offset, offset + FAVORITES_COOKIE_CHUNK_SIZE));
  }

  chunks.forEach((chunk, index) => {
    document.cookie = `${FAVORITES_COOKIE_PREFIX}-${index}=${chunk}; ${favoriteCookieAttributes()}`;
  });
  document.cookie = `${FAVORITES_COOKIE_PREFIX}-count=${chunks.length}; ${favoriteCookieAttributes()}`;

  for (let index = chunks.length; index < previousCount; index += 1) {
    document.cookie = `${FAVORITES_COOKIE_PREFIX}-${index}=; ${favoriteCookieAttributes(0)}`;
  }
}

function loadFavorites() {
  try {
    const localSaved = parseFavoritePayload(localStorage.getItem(FAVORITES_STORAGE_KEY));
    const cookieSaved = readFavoritesCookie();
    const saved = [localSaved, cookieSaved]
      .filter(Boolean)
      .sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0))[0];

    favoriteMuseumIds.clear();
    favoriteProgramIds.clear();
    for (const id of saved?.museums ?? []) favoriteMuseumIds.add(Number(id));
    for (const id of saved?.programs ?? []) favoriteProgramIds.add(Number(id));
  } catch (error) {
    console.warn("Could not read saved favourites", error);
  }
}

function saveFavorites() {
  const payload = JSON.stringify({
    updatedAt: Date.now(),
    museums: [...favoriteMuseumIds],
    programs: [...favoriteProgramIds],
  });

  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, payload);
  } catch (error) {
    console.warn("Could not save favourites to local storage", error);
  }

  try {
    writeFavoritesCookie(payload);
  } catch (error) {
    console.warn("Could not save favourites to cookies", error);
  }
}

loadFavorites();
saveFavorites();

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
  const favorite = group.items.some(({ museum }) => favoriteMuseumIds.has(museum.id));
  return L.divIcon({
    className: `museum-marker pin-color-${group.colorIndex}${grouped ? " museum-marker--group" : ""}${favorite ? " museum-marker--favorite" : ""}`,
    html: `<span>${group.pinNumber}</span>`,
    iconSize: [29, 29],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  });
}

function popupOptions() {
  const mobile = isMobileLayout();
  return {
    maxWidth: 290,
    minWidth: 230,
    autoPanPaddingTopLeft: mobile || museumList.hidden ? L.point(12, 12) : L.point(306, 14),
    autoPanPaddingBottomRight: mobile ? L.point(64, 12) : L.point(12, 12),
  };
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 680px)").matches;
}

function keepSelectedLocationVisible(group) {
  if (!group?.marker || !isMobileLayout() || detailPanel.hidden) return;

  window.requestAnimationFrame(() => {
    const panelHeight = detailPanel.getBoundingClientRect().height;
    map.panInside(group.marker.getLatLng(), {
      paddingTopLeft: L.point(16, 80),
      paddingBottomRight: L.point(64, panelHeight + 20),
      animate: true,
    });
  });
}

function sharedLocationPicker(group, selectedMuseum) {
  if (!group || group.items.length < 2) return "";

  return `
    <label class="popup-switcher">
      <span>Museum an diesem Ort</span>
      <select data-detail-location-picker data-popup-group="${escapeHtml(group.key)}" aria-label="Museum an diesem Ort wechseln">
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

function favoriteProgramCount(museum) {
  return museum.program.filter((entry) => favoriteProgramIds.has(entry.id)).length;
}

function museumFavoriteButton(museum, className) {
  const active = favoriteMuseumIds.has(museum.id);
  const programCount = favoriteProgramCount(museum);
  const action = active ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen";
  const reason = programCount
    ? programCount === 1
      ? ", 1 gemerkter Programmpunkt"
      : `, ${programCount} gemerkte Programmpunkte`
    : "";

  return `
    <button
      class="favorite-button ${className}"
      type="button"
      data-favorite-museum="${museum.id}"
      data-favorite-label="${escapeHtml(museum.title)}"
      aria-pressed="${active}"
      aria-label="${action}: ${escapeHtml(museum.title)}${reason}"
      title="${action}"
    >
      <span class="favorite-heart" aria-hidden="true">${active ? "♥" : "♡"}</span>
      <span class="favorite-reason-count" aria-hidden="true">${programCount || ""}</span>
    </button>
  `;
}

function programContent(entries = [], museumId) {
  const countLabel = entries.length === 1 ? "1 Eintrag" : `${entries.length} Einträge`;
  const list = entries.length
    ? `<div class="popup-program-list">
        ${entries
          .map((entry) => {
            const active = favoriteProgramIds.has(entry.id);
            const action = active ? "Programmpunkt aus Favoriten entfernen" : "Programmpunkt merken";
            return `
              <article class="popup-program-entry${active ? " popup-program-entry--favorite" : ""}" data-program-entry="${entry.id}">
                <div class="popup-program-entry-head">
                  <div class="popup-program-meta">
                    <span>${escapeHtml(entry.time || "Ganzer Abend")}</span>
                    <span>${escapeHtml(entry.category)}</span>
                  </div>
                  <button
                    class="favorite-button program-favorite"
                    type="button"
                    data-favorite-program="${entry.id}"
                    data-program-museum="${museumId}"
                    data-favorite-label="${escapeHtml(`${entry.title}, ${entry.time || "Ganzer Abend"}`)}"
                    aria-pressed="${active}"
                    aria-label="${action}: ${escapeHtml(entry.title)}, ${escapeHtml(entry.time || "Ganzer Abend")}"
                    title="${action}"
                  ><span class="favorite-heart" aria-hidden="true">${active ? "♥" : "♡"}</span></button>
                </div>
                <h3>
                  <a
                    class="program-entry-link"
                    href="${escapeHtml(entry.detailUrl)}"
                    target="_blank"
                    rel="noreferrer"
                  >${escapeHtml(entry.title)}</a>
                </h3>
                ${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}
              </article>
            `;
          })
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

function detailPanelContent(museum, location, group) {
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
        <button class="detail-close" type="button" data-close-detail aria-label="Museumdetails schliessen">×</button>
        <p class="popup-kicker"><span>Lange Nacht 2026</span><span>Standort #${group?.pinNumber ?? "–"}</span></p>
        <div class="popup-title-row">
          <h2>${escapeHtml(museum.title)}</h2>
          ${museumFavoriteButton(museum, "detail-favorite")}
        </div>
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
        ${programContent(museum.program, museum.id)}
        <div class="popup-actions">
          <a class="popup-link" href="${escapeHtml(museum.programUrl)}" target="_blank" rel="noreferrer">Programm öffnen</a>
          <a class="popup-link popup-link--secondary" href="${escapeHtml(museum.mapsUrl)}" target="_blank" rel="noreferrer">Route</a>
        </div>
      </div>
    </article>
  `;
}

function locationPopupContent(group) {
  return `
    <article class="map-popup">
      <header class="map-popup-top">
        <span class="map-popup-pin pin-color-${group.colorIndex}">${group.pinNumber}</span>
        <strong>Standort #${group.pinNumber}</strong>
      </header>
      <div class="map-popup-list">
        ${group.items
          .map(
            ({ museum, location }) => `
              <button type="button" data-detail-museum="${museum.id}" data-detail-location="${escapeHtml(location.label)}">
                <strong>${favoriteMuseumIds.has(museum.id) ? '<span class="map-popup-favorite" aria-hidden="true">♥</span>' : ""}${escapeHtml(museum.title)}</strong>
                <span>${escapeHtml(museum.hours)}</span>
              </button>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function openDetailPanel(museum, location, group) {
  activeMuseumId = museum.id;
  selectMuseum(museum.id);
  setSelectedLocation(group);
  detailContent.innerHTML = detailPanelContent(museum, location, group);
  detailPanel.hidden = false;
  if (isMobileLayout()) setMuseumListVisible(false);
  keepSelectedLocationVisible(group);
}

function closeDetailPanel() {
  activeMuseumId = null;
  detailPanel.hidden = true;
  detailContent.replaceChildren();
  selectMuseum("");
  setSelectedLocation(null);
}

function setSelectedLocation(group) {
  if (selectedLocationGroup?.marker) {
    selectedLocationGroup.marker.getElement()?.classList.remove("museum-marker--selected");
    selectedLocationGroup.marker.setZIndexOffset(0);
  }

  selectedLocationGroup = group;
  if (selectedLocationGroup?.marker) {
    selectedLocationGroup.marker.getElement()?.classList.add("museum-marker--selected");
    selectedLocationGroup.marker.setZIndexOffset(1000);
  }
}

function updateFavoriteButton(button, active, programCount = 0) {
  const label = button.dataset.favoriteLabel;
  const isProgram = button.matches("[data-favorite-program]");
  const action = isProgram
    ? active
      ? "Programmpunkt aus Favoriten entfernen"
      : "Programmpunkt merken"
    : active
      ? "Aus Favoriten entfernen"
      : "Zu Favoriten hinzufügen";
  const reason = !isProgram && programCount
    ? programCount === 1
      ? ", 1 gemerkter Programmpunkt"
      : `, ${programCount} gemerkte Programmpunkte`
    : "";

  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", `${action}: ${label}${reason}`);
  button.title = action;
  button.querySelector(".favorite-heart").textContent = active ? "♥" : "♡";
  const count = button.querySelector(".favorite-reason-count");
  if (count) count.textContent = programCount || "";
}

function updateFavoriteInterface() {
  document.querySelectorAll("[data-favorite-museum]").forEach((button) => {
    const museum = museums.find((item) => item.id === Number(button.dataset.favoriteMuseum));
    if (!museum) return;
    updateFavoriteButton(button, favoriteMuseumIds.has(museum.id), favoriteProgramCount(museum));
  });

  document.querySelectorAll("[data-favorite-program]").forEach((button) => {
    const active = favoriteProgramIds.has(Number(button.dataset.favoriteProgram));
    updateFavoriteButton(button, active);
    button.closest("[data-program-entry]")?.classList.toggle("popup-program-entry--favorite", active);
  });

  document.querySelectorAll(".museum-card").forEach((card) => {
    card.classList.toggle("museum-card--favorite", favoriteMuseumIds.has(Number(card.dataset.museumId)));
  });

  favoritesCount.textContent = String(favoriteMuseumIds.size);
  favoritesFilter.setAttribute("aria-pressed", String(favoritesOnly));
  favoritesFilter.setAttribute(
    "aria-label",
    `${favoritesOnly ? "Alle Museen zeigen" : "Nur Favoriten zeigen"}, ${favoriteMuseumIds.size} gespeichert`,
  );

  for (const group of markerGroups) {
    group.marker.setIcon(markerIcon(group));
    group.marker.getElement()?.setAttribute("aria-label", group.accessibleLabel);
    group.marker.setPopupContent(locationPopupContent(group));
    if (selectedLocationGroup === group) {
      group.marker.getElement()?.classList.add("museum-marker--selected");
    }
  }

  if (museums.length) applySearch();
  if (favoritesOnly && activeMuseumId && !favoriteMuseumIds.has(activeMuseumId)) closeDetailPanel();
}

function toggleMuseumFavorite(museumId) {
  const museum = museums.find((item) => item.id === museumId);
  if (!museum) return;

  if (favoriteMuseumIds.has(museumId)) {
    favoriteMuseumIds.delete(museumId);
    for (const entry of museum.program) favoriteProgramIds.delete(entry.id);
  } else {
    favoriteMuseumIds.add(museumId);
  }

  saveFavorites();
  updateFavoriteInterface();
}

function toggleProgramFavorite(programId, museumId) {
  if (favoriteProgramIds.has(programId)) {
    favoriteProgramIds.delete(programId);
  } else {
    favoriteProgramIds.add(programId);
    favoriteMuseumIds.add(museumId);
  }

  saveFavorites();
  updateFavoriteInterface();
}

function setMuseumListVisible(visible) {
  museumList.hidden = !visible;
  showListButton.hidden = visible;
  showListButton.setAttribute("aria-expanded", String(visible));
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
  openDetailPanel(museum, first.location, first.group);
  openPopupAfterMove(first.marker, locationPopupContent(first.group));
}

function createCard(museum) {
  const groups = [...new Map(
    (markersByMuseum.get(museum.id) ?? []).map(({ group }) => [group.key, group]),
  ).values()];
  const card = document.createElement("article");
  card.className = "museum-card";
  card.dataset.museumId = String(museum.id);
  card.dataset.searchText = `${museum.title} ${museum.address}`.toLocaleLowerCase("de");
  card.setAttribute("aria-current", "false");
  card.innerHTML = `
    <button class="museum-card-main" type="button" aria-label="${escapeHtml(museum.title)} auf der Karte öffnen">
      <span class="card-pins" aria-hidden="true">
        ${groups.map((group) => `<span class="card-pin pin-color-${group.colorIndex}">${group.pinNumber}</span>`).join("")}
      </span>
      <span class="card-copy">
        <strong>${escapeHtml(museum.title)}</strong>
        <span>${escapeHtml(museum.address)} · ${escapeHtml(museum.hours)}</span>
      </span>
      <span class="card-arrow" aria-hidden="true">›</span>
    </button>
    ${museumFavoriteButton(museum, "card-favorite")}
  `;
  card.querySelector(".museum-card-main").addEventListener("click", () => openMuseum(museum));
  card.querySelector("[data-favorite-museum]").addEventListener("click", () => toggleMuseumFavorite(museum.id));
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
    group.accessibleLabel = label;
    const marker = L.marker([group.latitude, group.longitude], {
      icon: markerIcon(group),
      title: label,
    }).addTo(markerLayer);
    marker.getElement()?.setAttribute("aria-label", label);

    marker.bindPopup(
      locationPopupContent(group),
      popupOptions(),
    );
    marker.on("click", () => {
      selectMuseum(group.items.length === 1 ? group.items[0].museum.id : "");
    });
    marker.on("popupclose", () => {
      if (detailPanel.hidden) selectMuseum("");
    });

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
    const museumId = Number(card.dataset.museumId);
    const matchesSearch = !query || card.dataset.searchText.includes(query);
    const matchesFavorites = !favoritesOnly || favoriteMuseumIds.has(museumId);
    const visible = matchesSearch && matchesFavorites;
    card.hidden = !visible;
    if (visible) {
      visibleCount += 1;
      visibleMuseumIds.add(museumId);
    }
  });

  for (const group of markerGroups) {
    const visible = group.items.some(({ museum }) => visibleMuseumIds.has(museum.id));
    if (visible && !markerLayer.hasLayer(group.marker)) markerLayer.addLayer(group.marker);
    if (!visible && markerLayer.hasLayer(group.marker)) markerLayer.removeLayer(group.marker);
  }

  summary.textContent = favoritesOnly
    ? `${visibleCount} von ${favoriteMuseumIds.size} Favoriten`
    : query
      ? `${visibleCount} von ${museums.length} Museen`
      : `${museums.length} Museen · ${markerGroups.length} Standorte`;
  cardsContainer.querySelector(".list-status--empty")?.remove();
  if (visibleCount === 0) {
    const empty = document.createElement("p");
    empty.className = "list-status list-status--empty";
    empty.textContent = favoritesOnly
      ? favoriteMuseumIds.size
        ? "Keine passenden Favoriten gefunden."
        : "Noch keine Favoriten gespeichert."
      : "Kein Museum gefunden.";
    cardsContainer.appendChild(empty);
  }
}

map.getContainer().addEventListener("click", (event) => {
  const button = event.target.closest("[data-detail-museum]");
  if (!button) return;
  const museum = museums.find((item) => item.id === Number(button.dataset.detailMuseum));
  const entry = (markersByMuseum.get(museum?.id) ?? []).find(
    ({ location }) => location.label === button.dataset.detailLocation,
  );
  if (museum && entry) {
    openDetailPanel(museum, entry.location, entry.group);
  }
});

detailPanel.addEventListener("change", (event) => {
  const picker = event.target.closest("[data-detail-location-picker]");
  if (!picker) return;

  const group = markerGroups.find((item) => item.key === picker.dataset.popupGroup);
  const selected = group?.items.find(({ museum }) => museum.id === Number(picker.value));
  if (!group || !selected) return;

  openDetailPanel(selected.museum, selected.location, group);
});

detailPanel.addEventListener("click", (event) => {
  const programButton = event.target.closest("[data-favorite-program]");
  if (programButton) {
    toggleProgramFavorite(
      Number(programButton.dataset.favoriteProgram),
      Number(programButton.dataset.programMuseum),
    );
    return;
  }

  const museumButton = event.target.closest("[data-favorite-museum]");
  if (museumButton) {
    toggleMuseumFavorite(Number(museumButton.dataset.favoriteMuseum));
    return;
  }

  if (event.target.closest("[data-close-detail]")) closeDetailPanel();
});

fitButton.addEventListener("click", fitVisibleMarkers);
searchInput.addEventListener("input", applySearch);
favoritesFilter.addEventListener("click", () => {
  favoritesOnly = !favoritesOnly;
  updateFavoriteInterface();
});
hideListButton.addEventListener("click", () => setMuseumListVisible(false));
showListButton.addEventListener("click", () => setMuseumListVisible(true));

let resizeFrame = 0;
function refreshMapLayout() {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    map.invalidateSize();
    keepSelectedLocationVisible(selectedLocationGroup);
  });
}

window.addEventListener("resize", refreshMapLayout);
window.visualViewport?.addEventListener("resize", refreshMapLayout);

const detailResizeObserver = new ResizeObserver(() => {
  keepSelectedLocationVisible(selectedLocationGroup);
});
detailResizeObserver.observe(detailPanel);

async function loadMuseums() {
  try {
    const response = await fetch("data/museums.generated.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    museums = await response.json();
    if (!Array.isArray(museums) || museums.length === 0) throw new Error("Empty data set");

    renderMarkers(museums);
    renderCards(museums);
    updateFavoriteInterface();
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
