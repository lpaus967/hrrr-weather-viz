import React, { useCallback, useEffect, useMemo, useState } from "react";
import Map, { NavigationControl } from "react-map-gl";
import type { MapRef } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import DeckWindParticleLayer from "@/components/DeckWindParticleLayer";
import { useWindData } from "@/hooks/useWindData";
import {
  formatModelRun,
  getDataAgeText,
  normalizeForecastHour,
  type WeatherVariable,
  useWeatherMetadata,
} from "@/hooks/useWeatherMetadata";
import { usePreloadedRasterLayers } from "@/hooks/usePreloadedRasterLayers";

const MAP_STYLE = "mapbox://styles/mapbox/satellite-v9";
const INITIAL_VIEW_STATE = {
  latitude: 41.163,
  longitude: -98.163,
  zoom: 3,
  projection: "mercator" as const,
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() || "";

const WEATHER_VARIABLE_ORDER = [
  "temperature_2m",
  "cloud_cover_total",
  "accumulated_snow",
  "snow_cover",
  "smoke_concentration",
];

const WEATHER_VARIABLE_META: Record<string, { shortLabel: string; category: string }> = {
  temperature_2m: { shortLabel: "Temperature", category: "Surface" },
  cloud_cover_total: { shortLabel: "Cloud Cover", category: "Sky" },
  accumulated_snow: { shortLabel: "Snow Accumulation", category: "Totals" },
  snow_cover: { shortLabel: "Snow Cover", category: "Totals" },
  smoke_concentration: { shortLabel: "Smoke", category: "Air" },
};

function formatForecastHour(forecastHour: string) {
  return `F${forecastHour.padStart(2, "0")}`;
}

function getWeatherGradient(variable: WeatherVariable | null) {
  if (!variable?.color_stops || variable.color_stops.length < 2) {
    return "linear-gradient(90deg, #1d4ed8 0%, #38bdf8 50%, #f59e0b 100%)";
  }

  return `linear-gradient(90deg, ${variable.color_stops
    .map((stop) => `${stop.color}`)
    .join(", ")})`;
}

const ParticleApp = () => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [customWindEnabled, setCustomWindEnabled] = useState(true);
  const [customWindForecast, setCustomWindForecast] = useState("00");
  const [customWindParticleCount, setCustomWindParticleCount] = useState(5000);
  const [weatherEnabled, setWeatherEnabled] = useState(false);
  const [selectedWeatherVariable, setSelectedWeatherVariable] = useState<string | null>(null);
  const [weatherForecast, setWeatherForecast] = useState("00");
  const [weatherOpacity, setWeatherOpacity] = useState(0.72);
  const [mapRef, setMapRef] = useState<MapRef | null>(null);

  const {
    windData,
    metadata,
    loading,
    error,
    refresh,
    availableForecastHours,
  } = useWindData({
    forecastHour: customWindForecast,
    enabled: customWindEnabled,
  });
  const {
    metadata: weatherMetadata,
    loading: weatherLoading,
    error: weatherError,
    refresh: refreshWeatherMetadata,
    getVariable,
    getTileUrl,
    getRun,
    getLatestRun,
  } = useWeatherMetadata();

  const forecastHours = useMemo(() => {
    return [...availableForecastHours].sort((left, right) => left - right);
  }, [availableForecastHours]);

  const forecastValues = useMemo(() => {
    if (forecastHours.length > 0) {
      return forecastHours;
    }

    return Array.from({ length: 13 }, (_, index) => index);
  }, [forecastHours]);

  const selectedForecastValue = Number.parseInt(customWindForecast, 10) || 0;
  const selectedForecastIndex = Math.max(
    0,
    forecastValues.findIndex((value) => value === selectedForecastValue)
  );
  const deckMapRef = useMemo(() => ({ current: mapRef }), [mapRef]);
  const availableWeatherVariables = useMemo(() => {
    if (!weatherMetadata?.variables) {
      return [];
    }

    return [...weatherMetadata.variables].sort((left, right) => {
      const leftIndex = WEATHER_VARIABLE_ORDER.indexOf(left.id);
      const rightIndex = WEATHER_VARIABLE_ORDER.indexOf(right.id);
      const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

      if (normalizedLeft !== normalizedRight) {
        return normalizedLeft - normalizedRight;
      }

      return left.name.localeCompare(right.name);
    });
  }, [weatherMetadata]);
  const activeWeatherVariable = useMemo(() => {
    if (!selectedWeatherVariable) {
      return null;
    }

    return getVariable(selectedWeatherVariable) ?? null;
  }, [getVariable, selectedWeatherVariable]);
  const weatherForecastHours = useMemo(() => {
    const fallbackHours = weatherMetadata?.forecast_hours ?? [];
    const runTimestamp = activeWeatherVariable?.latest_timestamp ?? getLatestRun()?.timestamp;
    const runForecastHours = runTimestamp ? getRun(runTimestamp)?.forecast_hours ?? [] : [];
    const sourceHours = runForecastHours.length > 0 ? runForecastHours : fallbackHours;

    if (sourceHours.length === 0) {
      return ["00"];
    }

    return sourceHours.map(normalizeForecastHour);
  }, [activeWeatherVariable?.latest_timestamp, getLatestRun, getRun, weatherMetadata]);
  const weatherModelRunLabel = useMemo(() => {
    if (!weatherMetadata?.model_run) {
      return null;
    }

    return formatModelRun(weatherMetadata.model_run);
  }, [weatherMetadata]);
  const weatherAgeLabel = useMemo(() => {
    if (!weatherMetadata?.data_freshness) {
      return null;
    }

    return getDataAgeText(weatherMetadata.data_freshness);
  }, [weatherMetadata]);
  const weatherGradient = useMemo(
    () => getWeatherGradient(activeWeatherVariable),
    [activeWeatherVariable]
  );
  const weatherInitializationKey = useMemo(() => {
    if (!weatherEnabled || !selectedWeatherVariable || !activeWeatherVariable?.latest_timestamp) {
      return null;
    }

    return [
      selectedWeatherVariable,
      activeWeatherVariable.latest_timestamp,
      weatherForecastHours.join(","),
    ].join("|");
  }, [
    activeWeatherVariable?.latest_timestamp,
    selectedWeatherVariable,
    weatherEnabled,
    weatherForecastHours,
  ]);

  const weatherSourceConfig = useMemo(() => ({
    tileSize: weatherMetadata?.tiles.tile_size,
    minzoom: weatherMetadata?.tiles.min_zoom,
    maxzoom: weatherMetadata?.tiles.max_zoom,
    bounds: weatherMetadata?.tiles.bounds,
  }), [weatherMetadata?.tiles.tile_size, weatherMetadata?.tiles.min_zoom, weatherMetadata?.tiles.max_zoom, weatherMetadata?.tiles.bounds]);

  const buildWeatherTileUrl = useCallback(
    (forecastHour: string) => {
      if (!selectedWeatherVariable) {
        return null;
      }

      return getTileUrl(
        selectedWeatherVariable,
        activeWeatherVariable?.latest_timestamp,
        normalizeForecastHour(forecastHour)
      );
    },
    [selectedWeatherVariable, activeWeatherVariable?.latest_timestamp, getTileUrl]
  );

  const {
    isReady: weatherLayersReady,
    loadProgress: weatherLoadProgress,
    initialize: initializeWeatherLayers,
    setActiveForecast: setActiveWeatherForecast,
    cleanup: cleanupWeatherLayers,
    setOpacity: setWeatherLayerOpacity,
    reinitialize: reinitializeWeatherLayers,
  } = usePreloadedRasterLayers({
    mapRef: deckMapRef,
    sourceConfig: weatherSourceConfig,
    baseOpacity: weatherOpacity,
    buildTileUrl: buildWeatherTileUrl,
    forecastHours: weatherForecastHours,
    enabled: weatherEnabled && Boolean(selectedWeatherVariable),
    layerIdPrefix: "weather",
  });

  useEffect(() => {
    if (!weatherMetadata || availableWeatherVariables.length === 0) {
      return;
    }

    if (!selectedWeatherVariable) {
      setSelectedWeatherVariable(availableWeatherVariables[0].id);
      return;
    }

    const variableStillExists = availableWeatherVariables.some(
      (variable) => variable.id === selectedWeatherVariable
    );
    if (!variableStillExists) {
      setSelectedWeatherVariable(availableWeatherVariables[0].id);
    }
  }, [availableWeatherVariables, selectedWeatherVariable, weatherMetadata]);

  useEffect(() => {
    if (!weatherForecastHours.includes(weatherForecast)) {
      setWeatherForecast(weatherForecastHours[0] ?? "00");
    }
  }, [weatherForecast, weatherForecastHours]);

  useEffect(() => {
    if (!weatherEnabled || !selectedWeatherVariable) {
      cleanupWeatherLayers();
      return;
    }

    if (!mapLoaded || !weatherMetadata || !activeWeatherVariable?.latest_timestamp) {
      return;
    }

    reinitializeWeatherLayers();
  }, [
    cleanupWeatherLayers,
    mapLoaded,
    reinitializeWeatherLayers,
    selectedWeatherVariable,
    weatherEnabled,
    weatherInitializationKey,
    weatherMetadata,
    activeWeatherVariable?.latest_timestamp,
  ]);

  useEffect(() => {
    setWeatherLayerOpacity(weatherOpacity);
  }, [setWeatherLayerOpacity, weatherOpacity]);

  useEffect(() => {
    if (!weatherLayersReady || !weatherEnabled || !selectedWeatherVariable) {
      return;
    }

    setActiveWeatherForecast(weatherForecast);
  }, [
    selectedWeatherVariable,
    setActiveWeatherForecast,
    weatherEnabled,
    weatherForecast,
    weatherLayersReady,
  ]);

  const weatherForecastIndex = Math.max(0, weatherForecastHours.indexOf(weatherForecast));
  const weatherActive = weatherEnabled && Boolean(selectedWeatherVariable);

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <Map
        ref={setMapRef}
        initialViewState={INITIAL_VIEW_STATE}
        style={{ width: "100%", height: "100vh" }}
        mapStyle={MAP_STYLE}
        mapboxAccessToken={MAPBOX_TOKEN}
        onLoad={() => setMapLoaded(true)}
      >
        <NavigationControl position="top-right" />
        <DeckWindParticleLayer
          mapRef={deckMapRef}
          windData={windData}
          enabled={customWindEnabled}
          baseParticleCount={customWindParticleCount}
          lineWidth={1.5}
          speedFactor={0.08}
          trailLength={15}
          maxAge={80}
          opacity={0.7}
        />
      </Map>

      <button
        className={`panel-toggle ${panelOpen ? "open" : ""}`}
        onClick={() => setPanelOpen((open) => !open)}
        aria-label="Toggle control panel"
      >
        {panelOpen ? "✕" : "☰"}
      </button>

      <div className={`panel-overlay ${panelOpen ? "visible" : ""}`} onClick={() => setPanelOpen(false)} />

      <div className={`control-panel ${panelOpen ? "open" : ""}`}>
        <div className="panel-section">
          <div className="section-header">
            <span className="section-title">Weather Layers</span>
            <button
              onClick={() => {
                if (weatherActive) {
                  setWeatherEnabled(false);
                } else {
                  const fallbackVariable =
                    selectedWeatherVariable ?? availableWeatherVariables[0]?.id ?? null;
                  setSelectedWeatherVariable(fallbackVariable);
                  setWeatherEnabled(Boolean(fallbackVariable));
                }
              }}
              className={`toggle-btn ${weatherActive ? "active" : "inactive"}`}
            >
              {weatherActive ? "ON" : "OFF"}
            </button>
          </div>

          <div className="info-card">
            <div className="info-label">Source</div>
            <div className="info-value">Driftwise HRRR raster tiles preloaded by forecast hour</div>
          </div>

          <div className="info-card">
            <div className="info-label">Model Run</div>
            <div className="info-value stacked">
              <span>{weatherModelRunLabel ?? "Loading latest HRRR run..."}</span>
              {weatherAgeLabel && <span className="info-subvalue">Updated {weatherAgeLabel}</span>}
            </div>
          </div>

          <div className="variable-grid">
            {availableWeatherVariables.map((variable) => {
              const variableMeta = WEATHER_VARIABLE_META[variable.id];
              const isSelected = selectedWeatherVariable === variable.id;
              const isActive = weatherActive && isSelected;

              return (
                <button
                  key={variable.id}
                  className={`variable-btn ${isActive ? "selected" : ""}`}
                  onClick={() => {
                    if (isActive) {
                      setWeatherEnabled(false);
                      return;
                    }

                    setSelectedWeatherVariable(variable.id);
                    setWeatherEnabled(true);
                  }}
                  disabled={weatherLoading && !weatherMetadata}
                >
                  <span>
                    <strong>{variableMeta?.shortLabel ?? variable.name}</strong>
                    <span className="variable-meta">
                      {variableMeta?.category ?? "Weather"} {variable.description ? `· ${variable.description}` : ""}
                    </span>
                  </span>
                  <span className="units">{variable.units}</span>
                </button>
              );
            })}
          </div>

          {weatherError && (
            <div className="status-message error">
              <span>{weatherError.message}</span>
              <button onClick={refreshWeatherMetadata} className="refresh-btn">
                Refresh
              </button>
            </div>
          )}

          {weatherActive && activeWeatherVariable && (
            <div className="weather-detail-card">
              <div className="weather-detail-header">
                <div>
                  <div className="info-label">Active Layer</div>
                  <div className="info-value">
                    {WEATHER_VARIABLE_META[activeWeatherVariable.id]?.shortLabel ?? activeWeatherVariable.name}
                  </div>
                </div>
                <div className={`status-badge ${weatherLayersReady ? "fresh" : "stale"}`}>
                  {weatherLayersReady ? "Ready" : `${weatherLoadProgress}%`}
                </div>
              </div>

              {weatherLayersReady ? null : (
                <div className="loading-inline">
                  <div className="loading-text">Preloading forecast tiles {weatherLoadProgress}%</div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${weatherLoadProgress}%` }} />
                  </div>
                </div>
              )}

              <div className="legend-title">{activeWeatherVariable.name}</div>
              <div className="legend-gradient" style={{ background: weatherGradient }} />
              {activeWeatherVariable.color_stops && activeWeatherVariable.color_stops.length > 1 && (
                <div className="legend-labels">
                  <span>
                    {activeWeatherVariable.color_stops[0].value}
                    {activeWeatherVariable.units}
                  </span>
                  <span>
                    {
                      activeWeatherVariable.color_stops[
                        activeWeatherVariable.color_stops.length - 1
                      ].value
                    }
                    {activeWeatherVariable.units}
                  </span>
                </div>
              )}

              <div className="slider-group">
                <div className="forecast-header">
                  <span className="forecast-label">Forecast Hour</span>
                  <span className="forecast-value">{formatForecastHour(weatherForecast)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, weatherForecastHours.length - 1)}
                  value={weatherForecastIndex}
                  onChange={(event) => {
                    const nextIndex = Number.parseInt(event.target.value, 10);
                    setWeatherForecast(weatherForecastHours[nextIndex] ?? weatherForecastHours[0] ?? "00");
                  }}
                />
              </div>

              <div className="slider-group">
                <div className="forecast-header">
                  <span className="forecast-label">Opacity</span>
                  <span className="forecast-value">{Math.round(weatherOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={Math.round(weatherOpacity * 100)}
                  onChange={(event) =>
                    setWeatherOpacity(Number.parseInt(event.target.value, 10) / 100)
                  }
                />
              </div>
            </div>
          )}
        </div>

        <div className="panel-section wind-section">
          <div className="section-header">
            <span className="section-title">Custom Wind</span>
            <button
              onClick={() => setCustomWindEnabled((enabled) => !enabled)}
              className={`toggle-btn ${customWindEnabled ? "active" : "inactive"}`}
            >
              {customWindEnabled ? "ON" : "OFF"}
            </button>
          </div>

          <div className="info-card">
            <div className="info-label">Source</div>
            <div className="info-value">HRRR wind field rendered with deck.gl particles</div>
          </div>

          <div className="info-card">
            <div className="info-label">Mapbox Token</div>
            <div className="info-value">
              {process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ? "Environment token" : "Built-in fallback token"}
            </div>
          </div>

          {customWindEnabled && (
            <div
              style={{
                marginTop: "8px",
                padding: "8px",
                background: "rgba(16, 185, 129, 0.1)",
                borderRadius: "8px",
                fontSize: "11px",
              }}
            >
              {loading && <div style={{ color: "#fbbf24" }}>Loading wind data...</div>}
              {error && <div style={{ color: "#ef4444" }}>Error: {error}</div>}
              {metadata && (
                <div style={{ color: "#10b981", marginBottom: "6px" }}>
                  <div style={{ fontWeight: "bold" }}>HRRR {metadata.model_run.cycle}</div>
                  <div style={{ opacity: 0.8 }}>{metadata.model_run.date}</div>
                </div>
              )}
              {windData && (
                <div style={{ color: "#10b981" }}>
                  Loaded {windData.width}x{windData.height} wind field
                </div>
              )}

              <div style={{ marginTop: "8px" }}>
                <label style={{ color: "rgba(255,255,255,0.7)" }}>
                  Particles: {customWindParticleCount}
                </label>
                <input
                  type="range"
                  min="1000"
                  max="20000"
                  step="1000"
                  value={customWindParticleCount}
                  onChange={(event) => setCustomWindParticleCount(Number.parseInt(event.target.value, 10))}
                  style={{ width: "100%", marginTop: "4px" }}
                />
              </div>

              <div style={{ marginTop: "8px" }}>
                <label style={{ color: "rgba(255,255,255,0.7)" }}>
                  Forecast Hour: F{customWindForecast}
                  {forecastHours.length > 0 && ` (${forecastHours.length} available)`}
                </label>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, forecastValues.length - 1)}
                  value={selectedForecastIndex}
                  onChange={(event) => {
                    const nextIndex = Number.parseInt(event.target.value, 10);
                    const nextForecast = forecastValues[nextIndex] ?? forecastValues[0] ?? 0;
                    setCustomWindForecast(String(nextForecast).padStart(2, "0"));
                  }}
                  style={{ width: "100%", marginTop: "4px" }}
                />
              </div>

              <button
                onClick={refresh}
                className="refresh-btn"
                style={{ marginTop: "8px", padding: "4px 8px", fontSize: "10px" }}
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ParticleApp;
