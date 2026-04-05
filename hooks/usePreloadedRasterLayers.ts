/**
 * Preloaded Raster Layers Hook
 *
 * For truly instant transitions with ZERO visual artifacts:
 * - Creates a separate layer for EACH forecast hour upfront
 * - Waits for ALL tiles to load before enabling interactions
 * - Switching forecasts is just an opacity toggle (instant, no network)
 *
 * Trade-off: Uses more memory, but transitions are completely seamless.
 */

import { useRef, useCallback, useState, useEffect } from "react";
import type { MapRef } from "react-map-gl";
import type mapboxgl from "mapbox-gl";

interface RasterSourceConfig {
  tileSize?: number;
  minzoom?: number;
  maxzoom?: number;
  bounds?: [number, number, number, number];
}

interface UsePreloadedRasterLayersOptions {
  mapRef: React.RefObject<MapRef>;
  sourceConfig: RasterSourceConfig;
  baseOpacity?: number;
  /** Function to build tile URL for a given forecast hour */
  buildTileUrl: (forecastHour: string) => string | null;
  /** All forecast hours to preload */
  forecastHours: string[];
  /** Whether the layer system is enabled */
  enabled?: boolean;
  /** Optional prefix for layer/source IDs (default: "weather") */
  layerIdPrefix?: string;
}

interface UsePreloadedRasterLayersResult {
  /** Initialize all layers (call once when ready) */
  initialize: () => void;
  /** Switch to a different forecast hour (instant) */
  setActiveForecast: (forecastHour: string) => void;
  /** Current active forecast hour */
  activeForecast: string | null;
  /** Whether all layers are loaded and ready */
  isReady: boolean;
  /** Loading progress (0-100) */
  loadProgress: number;
  /** Number of layers loaded */
  loadedCount: number;
  /** Total layers to load */
  totalCount: number;
  /** Clean up all sources and layers */
  cleanup: () => void;
  /** Set opacity for the active layer */
  setOpacity: (opacity: number) => void;
  /** Re-initialize with new URLs (e.g., when variable changes) */
  reinitialize: () => void;
}

export function usePreloadedRasterLayers(
  options: UsePreloadedRasterLayersOptions
): UsePreloadedRasterLayersResult {
  const {
    mapRef,
    sourceConfig,
    baseOpacity = 0.7,
    buildTileUrl,
    forecastHours,
    enabled = true,
    layerIdPrefix = "weather",
  } = options;

  const SOURCE_PREFIX = `${layerIdPrefix}-preload-`;
  const LAYER_PREFIX = `${layerIdPrefix}-layer-`;

  const [activeForecast, setActiveForecastState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const isInitializedRef = useRef(false);
  const opacityRef = useRef(baseOpacity);
  const loadedSourcesRef = useRef<Set<string>>(new Set());
  const activeForecastRef = useRef<string | null>(null);
  const cleanupListenersRef = useRef<(() => void)[]>([]);

  const getMap = useCallback(() => mapRef.current?.getMap(), [mapRef]);

  const getSourceId = (forecastHour: string) => `${SOURCE_PREFIX}${forecastHour}`;
  const getLayerId = (forecastHour: string) => `${LAYER_PREFIX}${forecastHour}`;

  const cleanup = useCallback(() => {
    const map = getMap();
    if (!map) return;

    cleanupListenersRef.current.forEach((cleanupListener) => cleanupListener());
    cleanupListenersRef.current = [];

    // Remove all layers and sources for each forecast hour
    forecastHours.forEach((hour) => {
      const layerId = getLayerId(hour);
      const sourceId = getSourceId(hour);

      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    });

    isInitializedRef.current = false;
    loadedSourcesRef.current.clear();
    setIsReady(false);
    setLoadedCount(0);
    setTotalCount(0);
    setActiveForecastState(null);
    activeForecastRef.current = null;
  }, [getMap, forecastHours]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const setOpacity = useCallback(
    (opacity: number) => {
      opacityRef.current = opacity;
      const map = getMap();
      if (!map || !activeForecastRef.current) return;

      const activeLayerId = getLayerId(activeForecastRef.current);
      if (map.getLayer(activeLayerId)) {
        map.setPaintProperty(activeLayerId, "raster-opacity", opacity);
      }
    },
    [getMap]
  );

  const setActiveForecast = useCallback(
    (forecastHour: string) => {
      const map = getMap();
      if (!map || !isReady) return;

      const previousForecast = activeForecastRef.current;

      // Show new layer FIRST (prevents flash where nothing is visible)
      const newLayerId = getLayerId(forecastHour);
      if (map.getLayer(newLayerId)) {
        map.setPaintProperty(newLayerId, "raster-opacity", opacityRef.current);
      }

      // THEN hide previous layer
      if (previousForecast && previousForecast !== forecastHour) {
        const prevLayerId = getLayerId(previousForecast);
        if (map.getLayer(prevLayerId)) {
          map.setPaintProperty(prevLayerId, "raster-opacity", 0);
        }
      }

      activeForecastRef.current = forecastHour;
      setActiveForecastState(forecastHour);
    },
    [getMap, isReady]
  );

  const initialize = useCallback(() => {
    const map = getMap();
    if (!map || isInitializedRef.current || !enabled || forecastHours.length === 0) {
      return;
    }

    // Clean up any existing layers first
    cleanup();

    const { tileSize = 256, minzoom = 0, maxzoom = 8, bounds } = sourceConfig;
    const total = forecastHours.length;
    setTotalCount(total);
    setLoadedCount(0);
    loadedSourcesRef.current.clear();

    // Track which sources have loaded
    const checkAllLoaded = () => {
      const loaded = loadedSourcesRef.current.size;
      setLoadedCount(loaded);

      if (loaded >= total) {
        setIsReady(true);
        // Set initial active forecast
        if (forecastHours.length > 0 && !activeForecastRef.current) {
          const initialForecast = forecastHours[0];
          activeForecastRef.current = initialForecast;
          setActiveForecastState(initialForecast);

          // Make initial layer visible
          const initialLayerId = getLayerId(initialForecast);
          if (map.getLayer(initialLayerId)) {
            map.setPaintProperty(initialLayerId, "raster-opacity", opacityRef.current);
          }
        }
      }
    };

    let beforeLayer: string | undefined;
    const candidates = ["rivers-casing", "rivers-line", "lakes-fill", "blm-fill"];
    for (const candidate of candidates) {
      if (map.getLayer(candidate)) {
        beforeLayer = candidate;
        break;
      }
    }

    // Create a source and layer for each forecast hour
    forecastHours.forEach((hour) => {
      const tileUrl = buildTileUrl(hour);
      if (!tileUrl) return;

      const sourceId = getSourceId(hour);
      const layerId = getLayerId(hour);

      // Create source
      map.addSource(sourceId, {
        type: "raster",
        tiles: [tileUrl],
        tileSize,
        minzoom,
        maxzoom,
        ...(bounds && { bounds }),
      });

      // Create layer (all start hidden except we'll show the first one after all load)
      map.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": 0,
          "raster-fade-duration": 0,
          "raster-opacity-transition": { duration: 0, delay: 0 },
        },
      }, beforeLayer);

      // Listen for source load
      const onSourceData = (e: mapboxgl.MapSourceDataEvent) => {
        if (e.sourceId === sourceId && e.isSourceLoaded && !loadedSourcesRef.current.has(hour)) {
          loadedSourcesRef.current.add(hour);
          checkAllLoaded();
        }
      };

      map.on("sourcedata", onSourceData);
      cleanupListenersRef.current.push(() => map.off("sourcedata", onSourceData));

      // Also check immediately in case already cached
      if (map.isSourceLoaded(sourceId)) {
        loadedSourcesRef.current.add(hour);
        checkAllLoaded();
      }
    });

    isInitializedRef.current = true;
  }, [getMap, enabled, forecastHours, sourceConfig, buildTileUrl, cleanup]);

  const reinitialize = useCallback(() => {
    cleanup();
    // Small delay to ensure cleanup completes
    setTimeout(() => {
      initialize();
    }, 50);
  }, [cleanup, initialize]);

  const loadProgress = totalCount > 0 ? Math.round((loadedCount / totalCount) * 100) : 0;

  return {
    initialize,
    setActiveForecast,
    activeForecast,
    isReady,
    loadProgress,
    loadedCount,
    totalCount,
    cleanup,
    setOpacity,
    reinitialize,
  };
}

export default usePreloadedRasterLayers;
