const WEATHER_API_KEY = "9c603c2c4c38c533f0ad6d215e1d0517";

const DEFAULT_CENTER = [15.5007, 32.5599];
const DEFAULT_ZOOM = 6;
const CITY_ZOOM = 11;
const MAX_FAVORITES = 8;
const FAVORITES_KEY = "favorites";

const searchForm = document.getElementById("search-form");
const locationInput = document.getElementById("location-input");
const searchBtn = document.getElementById("search-btn");
const favList = document.getElementById("fav-list");
const saveFavBtn = document.getElementById("save-fav-btn");
const alerts = document.getElementById("alerts");
const loadingBox = document.getElementById("loading-box");
const loadingText = document.getElementById("loading-text");
const forecastSection = document.getElementById("forecast-section");
const forecastTitle = document.getElementById("forecast-title");
const forecastBox = document.getElementById("forecast");
const toast = document.getElementById("toast");
const popupTemplate = document.getElementById("popup-template");
const dayTemplate = document.getElementById("day-template");

let marker = null;
let currentWeather = null;
let isLoading = false;
let toastTimer = null;

class ApiError extends Error {
  constructor(type, status = 0) {
    super(`${type} ${status}`);
    this.type = type;
    this.status = status;
  }
}

const map = L.map("map").setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const pinIcon = L.divIcon({
  className: "map-pin",
  html: "<span></span>",
  iconSize: [26, 26],
  iconAnchor: [13, 31],
  popupAnchor: [0, -30]
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = locationInput.value.trim();

  if (query === "") {
    showError("Please enter a location.", 'Type a city or town name, for example "Kassala".');
    locationInput.focus();
    return;
  }

  searchCity(query);
});

async function searchCity(query) {
  if (isLoading) {
    return;
  }

  clearAlert();
  setLoading(true, `Finding ${query}…`);

  try {
    const place = await geocode(query);
    setLoading(true, `Getting weather for ${place.name}…`);

    const [weather, forecast] = await Promise.all([
      getWeather(place.lat, place.lon),
      getForecast(place.lat, place.lon).catch(() => null)
    ]);

    showOnMap(place, weather);
    showForecast(forecast, place.name);
  } catch (error) {
    handleError(error, query);
  } finally {
    setLoading(false);
  }
}

map.on("click", (event) => {
  weatherAtPoint(event.latlng.lat, event.latlng.lng);
});

async function weatherAtPoint(lat, lon) {
  if (isLoading) {
    return;
  }

  clearAlert();
  setLoading(true, "Getting weather for this spot…");

  try {
    const [weather, forecast] = await Promise.all([
      getWeather(lat, lon),
      getForecast(lat, lon).catch(() => null)
    ]);

    const name = weather.name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    const place = { lat: lat, lon: lon, name: name, country: weather.sys.country || "" };

    if (weather.name) {
      locationInput.value = weather.name;
    }

    showOnMap(place, weather, Math.max(map.getZoom(), DEFAULT_ZOOM));
    showForecast(forecast, name);
  } catch (error) {
    handleError(error, "");
  } finally {
    setLoading(false);
  }
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&accept-language=en&q=${encodeURIComponent(query)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new ApiError("http", response.status);
  }

  const results = await response.json();

  if (results.length === 0) {
    throw new ApiError("notfound");
  }

  const result = results[0];
  const countryCode = result.address && result.address.country_code ? result.address.country_code.toUpperCase() : "";

  return {
    lat: parseFloat(result.lat),
    lon: parseFloat(result.lon),
    name: result.name || query,
    country: countryCode
  };
}

async function getWeather(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new ApiError("http", response.status);
  }

  return response.json();
}

async function getForecast(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new ApiError("http", response.status);
  }

  return response.json();
}

function showOnMap(place, weather, zoom = CITY_ZOOM) {
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }

  currentWeather = {
    name: place.name,
    country: place.country || weather.sys.country || "",
    temp: Math.round(weather.main.temp),
    description: weather.weather[0].description,
    icon: weather.weather[0].icon,
    clouds: weather.clouds.all,
    humidity: weather.main.humidity,
    wind: weather.wind.speed,
    time: formatLocalTime(weather.dt, weather.timezone)
  };

  const newMarker = L.marker([place.lat, place.lon], { icon: pinIcon, title: place.name }).addTo(map);
  newMarker.bindPopup(buildPopup(currentWeather), {
    className: "weather-popup",
    minWidth: 240,
    maxWidth: 280
  });
  marker = newMarker;

  const target = L.latLng(place.lat, place.lon);

  if (map.getZoom() === zoom && map.getCenter().distanceTo(target) < 50) {
    newMarker.openPopup();
  } else {
    map.once("moveend", () => {
      if (marker === newMarker) {
        newMarker.openPopup();
      }
    });
    map.flyTo(target, zoom, { duration: 1.2 });
  }

  renderFavorites();
}

function buildPopup(data) {
  const popup = popupTemplate.content.firstElementChild.cloneNode(true);

  popup.querySelector(".city-name").textContent = data.name;
  popup.querySelector(".city-country").textContent = data.country ? `· ${data.country}` : "";

  const icon = popup.querySelector(".popup-icon");
  icon.src = `https://openweathermap.org/img/wn/${data.icon}@2x.png`;
  icon.alt = data.description;

  popup.querySelector(".temp-value").textContent = data.temp;
  popup.querySelector(".popup-desc").textContent = data.description;
  popup.querySelector(".stat-clouds").textContent = `${data.clouds}%`;
  popup.querySelector(".stat-humidity").textContent = `${data.humidity}%`;
  popup.querySelector(".stat-wind").textContent = `${data.wind.toFixed(1)} m/s`;
  popup.querySelector(".popup-time").textContent = `Updated ${data.time} local time`;

  popup.querySelector(".btn-share").addEventListener("click", () => shareWeather(data));

  return popup;
}

function formatLocalTime(unixTime, timezoneOffset) {
  const date = new Date((unixTime + timezoneOffset) * 1000);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function showForecast(data, cityName) {
  forecastBox.replaceChildren();

  if (!data || !data.list) {
    forecastSection.hidden = true;
    return;
  }

  const days = [];
  const dayMap = {};

  data.list.forEach((item) => {
    const localDate = new Date((item.dt + data.city.timezone) * 1000);
    const key = localDate.toISOString().slice(0, 10);

    if (!dayMap[key]) {
      dayMap[key] = { date: localDate, items: [] };
      days.push(dayMap[key]);
    }

    dayMap[key].items.push({ hour: localDate.getUTCHours(), entry: item });
  });

  const nextDays = days.length > 5 ? days.slice(1, 6) : days.slice(0, 5);

  const summaries = nextDays.map((day) => {
    const highs = day.items.map((i) => i.entry.main.temp_max);
    const lows = day.items.map((i) => i.entry.main.temp_min);
    const midday = day.items.reduce((best, i) => (Math.abs(i.hour - 12) < Math.abs(best.hour - 12) ? i : best));

    return {
      date: day.date,
      max: Math.round(Math.max(...highs)),
      min: Math.round(Math.min(...lows)),
      icon: midday.entry.weather[0].icon,
      description: midday.entry.weather[0].description
    };
  });

  const weekMax = Math.max(...summaries.map((d) => d.max));
  const weekMin = Math.min(...summaries.map((d) => d.min));
  const range = Math.max(weekMax - weekMin, 1);

  summaries.forEach((day) => {
    const card = dayTemplate.content.firstElementChild.cloneNode(true);

    card.querySelector(".day-name").textContent = day.date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    card.querySelector(".day-date").textContent = day.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

    const icon = card.querySelector(".day-icon");
    icon.src = `https://openweathermap.org/img/wn/${day.icon}@2x.png`;
    icon.alt = day.description;

    card.querySelector(".day-max").textContent = `${day.max}°`;
    card.querySelector(".day-min").textContent = `${day.min}°`;

    const start = ((day.min - weekMin) / range) * 100;
    const width = Math.max(((day.max - day.min) / range) * 100, 3);
    const fill = card.querySelector(".temp-bar-fill");
    fill.setAttribute("x", start.toFixed(1));
    fill.setAttribute("width", Math.min(width, 100 - start).toFixed(1));

    forecastBox.appendChild(card);
  });

  forecastTitle.textContent = `5-day forecast for ${cityName}`;
  forecastSection.hidden = false;
}

async function shareWeather(data) {
  const place = data.country ? `${data.name}, ${data.country}` : data.name;
  const text = `${place}: ${data.temp}°C, ${data.description}. Humidity ${data.humidity}%, wind ${data.wind.toFixed(1)} m/s. (WeatherMap)`;

  if (navigator.share) {
    try {
      await navigator.share({ title: "WeatherMap", text: text });
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("✓ Copied to clipboard");
  } catch (error) {
    showError("Couldn't share the weather.", "Your browser blocked sharing and copying. Open the app over https or on localhost and try again.");
  }
}

function handleError(error, query) {
  console.error(error);

  if (error instanceof ApiError && error.type === "notfound") {
    showError(`We couldn't find "${query}".`, 'Check the spelling, or add the country, for example "Port Sudan, SD".');
  } else if (error instanceof ApiError && error.status === 401) {
    showError("The weather API key was rejected.", "Check WEATHER_API_KEY at the top of app.js. A new OpenWeather key can take a few hours to start working.");
  } else if (error instanceof ApiError && error.status === 429) {
    showError("Too many requests.", "Wait a minute, then press Get Weather again.");
  } else if (error instanceof ApiError) {
    showError("The weather service didn't respond properly.", `The server returned error ${error.status}. Try again in a moment.`);
  } else if (error instanceof TypeError || !navigator.onLine) {
    showError("No internet connection.", "The weather service couldn't be reached. Check your connection and press Get Weather again.");
  } else {
    showError("Something stopped the search.", "Reload the page and try again.");
  }
}

function showError(title, message) {
  clearAlert();

  const box = document.createElement("div");
  box.className = "alert-box";
  box.setAttribute("role", "alert");

  const icon = document.createElement("span");
  icon.className = "alert-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "!";

  const text = document.createElement("div");
  text.className = "alert-text";

  const heading = document.createElement("span");
  heading.className = "alert-title";
  heading.textContent = title;

  text.append(heading, message);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "alert-close";
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", clearAlert);

  box.append(icon, text, closeBtn);
  alerts.appendChild(box);
}

function clearAlert() {
  alerts.replaceChildren();
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function setLoading(state, message) {
  isLoading = state;
  loadingBox.hidden = !state;
  searchBtn.disabled = state;
  searchBtn.textContent = state ? "Searching…" : "Get Weather";
  document.body.classList.toggle("loading", state);

  if (message) {
    loadingText.textContent = message;
  }
}

function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    return [];
  }
}

function saveFavorites(list) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch (error) {
    showError("Couldn't save your favourites.", "Your browser is blocking storage for this page. Check its privacy settings.");
  }
}

function isSameCity(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

function renderFavorites() {
  favList.querySelectorAll(".fav-item").forEach((item) => item.remove());

  const favorites = loadFavorites();
  const currentName = currentWeather ? currentWeather.name : "";

  favorites.forEach((name) => {
    const item = document.createElement("span");
    item.className = "fav-item";

    if (currentName && isSameCity(name, currentName)) {
      item.classList.add("active");
    }

    const cityBtn = document.createElement("button");
    cityBtn.type = "button";
    cityBtn.className = "fav-btn";
    cityBtn.textContent = name;
    cityBtn.addEventListener("click", () => {
      locationInput.value = name;
      searchCity(name);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "fav-remove";
    removeBtn.setAttribute("aria-label", `Remove ${name}`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => removeFavorite(name));

    item.append(cityBtn, removeBtn);
    favList.insertBefore(item, saveFavBtn);
  });

  const alreadySaved = currentName !== "" && favorites.some((name) => isSameCity(name, currentName));
  saveFavBtn.disabled = currentName === "" || alreadySaved;
  saveFavBtn.textContent = alreadySaved ? "Saved" : "+ Save current";
}

function removeFavorite(name) {
  const favorites = loadFavorites().filter((item) => !isSameCity(item, name));
  saveFavorites(favorites);
  renderFavorites();
}

saveFavBtn.addEventListener("click", () => {
  if (!currentWeather) {
    return;
  }

  const favorites = loadFavorites();

  if (favorites.length >= MAX_FAVORITES) {
    showError(`You can save up to ${MAX_FAVORITES} cities.`, "Remove one with × before adding another.");
    return;
  }

  favorites.push(currentWeather.name);
  saveFavorites(favorites);
  renderFavorites();
  showToast("✓ Saved to favourites");
});

renderFavorites();

if (location.protocol === "file:") {
  showError("The map can't load from a local file.", "OpenStreetMap blocks map tiles for pages opened by double-clicking. Open this folder with a local server such as VS Code Live Server, then reload.");
}
