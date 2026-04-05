/**
 * Weather Metadata Hook
 *
 * Fetches weather metadata from Driftwise S3 bucket.
 * Provides typed access to available variables, timestamps, and tile URLs.
 */

import { useState, useEffect, useCallback } from "react";

// =============================================================================
// Types
// =============================================================================

export interface ModelRun {
  date: string; // "2026-01-11"
  cycle: string; // "18"
  cycle_formatted: string; // "18Z"
  timestamp: string; // ISO 8601: "2026-01-11T18:00:00+00:00"
  unix_timestamp: number;
  display: string; // "2026-01-11 18:00 UTC"
}

export interface ColorStop {
  value: number;
  color: string;
}

export interface WeatherVariable {
  id: string; // "temperature_2m"
  name: string; // "Temperature (2m)"
  description: string;
  units: string; // "°C"
  color_ramp: string; // "temperature"
  color_stops?: ColorStop[];
  latest_timestamp?: string; // "20260111T18z"
  timestamps?: string[];
}

export interface TileConfig {
  url_template: string;
  format: string; // "png"
  tile_size: number; // 256
  min_zoom: number;
  max_zoom: number;
  bounds: [number, number, number, number]; // [west, south, east, north]
}

export interface AvailableRun {
  timestamp: string; // "20260111T18z"
  forecast_hours: string[]; // ["00", "01", "02", ...]
  forecast_count: number;
}

export interface DataFreshness {
  age_minutes: number;
  status: "fresh" | "stale" | "old";
  generated_at: string;
}

export interface WeatherMetadata {
  version: string;
  model: string; // "hrrr"
  product: string; // "sfc"
  model_run: ModelRun;
  data_freshness: DataFreshness;
  variables: WeatherVariable[];
  variable_ids: string[];
  forecast_hours: string[];
  available_runs: AvailableRun[]; // Historical model runs (newest first)
  available_runs_count: number;
  tiles: TileConfig;
  endpoints: {
    metadata: string;
    tiles: string;
    colored_cogs: string;
  };
  generated_at: string;
  pipeline_version: string;
}

export interface UseWeatherMetadataResult {
  metadata: WeatherMetadata | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  getTileUrl: (
    variable: string,
    timestamp?: string,
    forecast?: string
  ) => string | null;
  getVariable: (id: string) => WeatherVariable | undefined;
  getRun: (timestamp: string) => AvailableRun | undefined;
  getLatestRun: () => AvailableRun | undefined;
  isDataFresh: boolean;
}

// =============================================================================
// Configuration - Driftwise S3 bucket
// =============================================================================

const DEFAULT_METADATA_URL =
  "https://driftwise-weather-data.s3.us-east-1.amazonaws.com/metadata/latest.json";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function normalizeForecastHour(forecast: string): string {
  const trimmedForecast = forecast.trim();
  return /^\d+$/.test(trimmedForecast)
    ? trimmedForecast.padStart(2, "0")
    : trimmedForecast;
}

// =============================================================================
// Hook
// =============================================================================

export function useWeatherMetadata(
  metadataUrl: string = DEFAULT_METADATA_URL,
  autoRefresh: boolean = true
): UseWeatherMetadataResult {
  const [metadata, setMetadata] = useState<WeatherMetadata | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMetadata = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(metadataUrl, {
        cache: "no-cache", // Always get fresh metadata
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.status}`);
      }

      const data: WeatherMetadata = await response.json();
      setMetadata(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [metadataUrl]);

  // Initial fetch
  useEffect(() => {
    fetchMetadata();
  }, [fetchMetadata]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchMetadata, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchMetadata]);

  // Build tile URL for a specific variable/timestamp/forecast
  const getTileUrl = useCallback(
    (
      variable: string,
      timestamp?: string,
      forecast: string = "00"
    ): string | null => {
      if (!metadata) return null;

      // Use latest timestamp if not specified
      const varData = metadata.variables.find((v) => v.id === variable);
      const ts = timestamp || varData?.latest_timestamp;

      if (!ts) return null;

      return metadata.tiles.url_template
        .replace("{variable}", variable)
        .replace("{timestamp}", ts)
        .replace("{forecast}", normalizeForecastHour(forecast));
    },
    [metadata]
  );

  // Get variable by ID
  const getVariable = useCallback(
    (id: string): WeatherVariable | undefined => {
      return metadata?.variables.find((v) => v.id === id);
    },
    [metadata]
  );

  // Get run by timestamp
  const getRun = useCallback(
    (timestamp: string): AvailableRun | undefined => {
      return metadata?.available_runs?.find((r) => r.timestamp === timestamp);
    },
    [metadata]
  );

  // Get the latest (most recent) run
  const getLatestRun = useCallback((): AvailableRun | undefined => {
    return metadata?.available_runs?.[0]; // First run is newest
  }, [metadata]);

  // Check if data is fresh (less than 2 hours old)
  const isDataFresh =
    metadata?.data_freshness?.status === "fresh" ||
    (metadata?.data_freshness?.age_minutes ?? 999) < 120;

  return {
    metadata,
    loading,
    error,
    refresh: fetchMetadata,
    getTileUrl,
    getVariable,
    getRun,
    getLatestRun,
    isDataFresh,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Build a complete tile URL from metadata
 */
export function buildTileUrl(
  metadata: WeatherMetadata,
  variable: string,
  timestamp: string,
  forecast: string = "00"
): string {
  return metadata.tiles.url_template
    .replace("{variable}", variable)
    .replace("{timestamp}", timestamp)
    .replace("{forecast}", normalizeForecastHour(forecast));
}

/**
 * Format model run for display
 */
export function formatModelRun(modelRun: ModelRun): string {
  return modelRun.display || `${modelRun.date} ${modelRun.cycle}:00 UTC`;
}

/**
 * Get time since model run in human-readable format
 */
export function getDataAgeText(freshness: DataFreshness): string {
  const minutes = freshness.age_minutes;

  if (minutes < 60) {
    return `${minutes} minutes ago`;
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  } else {
    const days = Math.floor(minutes / 1440);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }
}

/**
 * Get all timestamps from available runs for animation
 */
export function getAllTimestamps(metadata: WeatherMetadata): string[] {
  return metadata.available_runs?.map((run) => run.timestamp) ?? [];
}

/**
 * Get the forecast hours available for a specific run
 */
export function getForecastHoursForRun(
  metadata: WeatherMetadata,
  timestamp: string
): string[] {
  const run = metadata.available_runs?.find((r) => r.timestamp === timestamp);
  return (run?.forecast_hours ?? []).map(normalizeForecastHour);
}

/**
 * Parse a timestamp string to Date object
 * Handles format like "20260111T18z" -> Date
 */
export function parseRunTimestamp(timestamp: string): Date | null {
  try {
    // Format: YYYYMMDDTHHZ
    const match = timestamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})z?$/i);
    if (match) {
      const [, year, month, day, hour] = match;
      return new Date(
        Date.UTC(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hour)
        )
      );
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Format run timestamp for display
 */
export function formatRunTimestamp(timestamp: string): string {
  const date = parseRunTimestamp(timestamp);
  if (!date) return timestamp;

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export default useWeatherMetadata;

export { normalizeForecastHour };
