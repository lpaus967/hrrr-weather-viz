'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer } from '@deck.gl/layers';
import type mapboxgl from 'mapbox-gl';
import type { MapRef } from 'react-map-gl';
import type { WindData } from '@/hooks/useWindData';

interface Particle {
  id: number;
  x: number;
  y: number;
  age: number;
  maxAge: number;
  trail: { lng: number; lat: number; age: number }[];
}

interface ViewBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

function resolveSpawnBounds(dataBounds: ViewBounds, currentViewBounds: ViewBounds | null, currentZoom: number): ViewBounds {
  if (!currentViewBounds || currentZoom <= 4) {
    return dataBounds;
  }

  const candidate = {
    west: Math.max(dataBounds.west, currentViewBounds.west),
    east: Math.min(dataBounds.east, currentViewBounds.east),
    south: Math.max(dataBounds.south, currentViewBounds.south),
    north: Math.min(dataBounds.north, currentViewBounds.north),
  };

  if (candidate.west >= candidate.east || candidate.south >= candidate.north) {
    return dataBounds;
  }

  return candidate;
}

interface DeckWindParticleLayerProps {
  mapRef: React.RefObject<MapRef>;
  windData: WindData | null;
  enabled?: boolean;
  baseParticleCount?: number;
  lineWidth?: number;
  speedFactor?: number;
  trailLength?: number;
  maxAge?: number;
  opacity?: number;
}

// Smoother color scale for wind speed (m/s) - more muted/aesthetic
const COLOR_SCALE: [number, number, number][] = [
  [100, 180, 200],  // 0-5 m/s - soft cyan
  [120, 200, 180],  // 5-10 m/s - teal
  [160, 210, 160],  // 10-15 m/s - soft green
  [200, 220, 140],  // 15-20 m/s - lime
  [230, 210, 120],  // 20-25 m/s - gold
  [240, 180, 100],  // 25-30 m/s - orange
  [240, 140, 90],   // 30-35 m/s - coral
  [230, 100, 80],   // 35-40 m/s - salmon
  [210, 70, 70],    // 40-45 m/s - red
  [180, 50, 60],    // 45+ m/s - dark red
];

function getColorForMagnitude(magnitude: number): [number, number, number] {
  const maxSpeed = 40;
  const normalized = Math.min(magnitude / maxSpeed, 1);
  const index = Math.min(Math.floor(normalized * (COLOR_SCALE.length - 1)), COLOR_SCALE.length - 1);
  return COLOR_SCALE[index];
}

export function DeckWindParticleLayer({
  mapRef,
  windData,
  enabled = true,
  baseParticleCount = 4000,
  lineWidth = 1.5,
  speedFactor = 0.08,
  trailLength = 15,
  maxAge = 80,
  opacity = 0.7,
}: DeckWindParticleLayerProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const attachedMapRef = useRef<mapboxgl.Map | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const [viewBounds, setViewBounds] = useState<ViewBounds | null>(null);
  const [zoom, setZoom] = useState(3);

  const removeOverlay = useCallback(() => {
    if (!overlayRef.current || !attachedMapRef.current) {
      return;
    }

    try {
      attachedMapRef.current.removeControl(overlayRef.current as any);
    } catch (error) {
      // Ignore duplicate cleanup and stale map errors during teardown.
    } finally {
      overlayRef.current = null;
      attachedMapRef.current = null;
    }
  }, []);

  // Calculate particle count based on zoom level - DECREASE as you zoom in
  const getParticleCount = useCallback((currentZoom: number) => {
    if (currentZoom < 4) return baseParticleCount;
    if (currentZoom < 6) return Math.floor(baseParticleCount * 0.5);
    if (currentZoom < 8) return Math.floor(baseParticleCount * 0.2);
    if (currentZoom < 10) return Math.floor(baseParticleCount * 0.08);
    if (currentZoom < 12) return Math.floor(baseParticleCount * 0.04);
    return Math.floor(baseParticleCount * 0.025); // Slightly more at max zoom
  }, [baseParticleCount]);

  // Calculate speed factor based on zoom - SLOWER as you zoom in
  const getSpeedFactor = useCallback((currentZoom: number) => {
    if (currentZoom < 4) return speedFactor;
    if (currentZoom < 6) return speedFactor * 0.7;
    if (currentZoom < 8) return speedFactor * 0.4;
    if (currentZoom < 10) return speedFactor * 0.15;
    if (currentZoom < 12) return speedFactor * 0.06;
    return speedFactor * 0.02; // Barely moving at max zoom
  }, [speedFactor]);

  // Calculate trail length based on zoom - SHORTER as you zoom in
  const getTrailLength = useCallback((currentZoom: number) => {
    if (currentZoom < 4) return trailLength;
    if (currentZoom < 6) return Math.floor(trailLength * 0.8);
    if (currentZoom < 8) return Math.floor(trailLength * 0.6);
    if (currentZoom < 10) return Math.floor(trailLength * 0.4);
    if (currentZoom < 12) return Math.floor(trailLength * 0.25);
    return Math.max(3, Math.floor(trailLength * 0.15)); // Minimal trail at max zoom
  }, [trailLength]);

  // Initialize/reinitialize particles within view bounds
  const initParticles = useCallback((forceViewBounds?: ViewBounds, forceZoom?: number) => {
    if (!windData) return;

    const { width, height, bounds: dataBounds } = windData;
    const currentZoom = forceZoom ?? zoom;
    const currentViewBounds = forceViewBounds ?? viewBounds;
    const particleCount = getParticleCount(currentZoom);
    
    // Determine spawn bounds (intersection of view and data bounds, or just data bounds)
    const spawnBounds = resolveSpawnBounds(dataBounds, currentViewBounds, currentZoom);

    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      // Spawn within spawn bounds
      const lng = spawnBounds.west + Math.random() * (spawnBounds.east - spawnBounds.west);
      const lat = spawnBounds.south + Math.random() * (spawnBounds.north - spawnBounds.south);
      
      // Convert to pixel coordinates
      const x = ((lng - dataBounds.west) / (dataBounds.east - dataBounds.west)) * width;
      const y = ((dataBounds.north - lat) / (dataBounds.north - dataBounds.south)) * height;

      particles.push({
        id: i,
        x,
        y,
        age: Math.floor(Math.random() * maxAge),
        maxAge: maxAge + Math.floor(Math.random() * 30) - 15,
        trail: [{ lng, lat, age: 0 }],
      });
    }

    particlesRef.current = particles;
  }, [windData, zoom, viewBounds, maxAge, getParticleCount]);

  // Update particle positions based on wind field
  const updateParticles = useCallback(() => {
    if (!windData) return;

    const { imageData, width, height, bounds } = windData;
    const particles = particlesRef.current;
    
    // Get zoom-adjusted values
    const currentSpeedFactor = getSpeedFactor(zoom);
    const currentTrailLength = getTrailLength(zoom);

    particles.forEach((particle) => {
      // Get wind at current position
      const px = Math.floor(particle.x);
      const py = Math.floor(particle.y);

      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const a = imageData.data[idx + 3];

        if (a > 0) {
          // Decode wind components
          const u = ((r / 255) * 100 - 50);
          const v = ((g / 255) * 100 - 50);

          // Update position with zoom-adjusted speed
          particle.x += u * currentSpeedFactor;
          particle.y -= v * currentSpeedFactor;

          // Calculate new lat/lng
          const lng = bounds.west + (particle.x / width) * (bounds.east - bounds.west);
          const lat = bounds.north - (particle.y / height) * (bounds.north - bounds.south);

          // Add to trail with age tracking
          particle.trail.unshift({ lng, lat, age: 0 });
          
          // Age all trail points
          particle.trail.forEach(p => p.age++);
          
          // Trim trail based on zoom
          if (particle.trail.length > currentTrailLength) {
            particle.trail = particle.trail.slice(0, currentTrailLength);
          }
        }
      }

      // Age particle
      particle.age++;

      // Reset if too old or out of bounds
      if (
        particle.age > particle.maxAge ||
        particle.x < 0 || particle.x >= width ||
        particle.y < 0 || particle.y >= height
      ) {
        // Respawn within view bounds when zoomed in
        const spawnBounds = resolveSpawnBounds(bounds, viewBounds, zoom);
        
        const lng = spawnBounds.west + Math.random() * (spawnBounds.east - spawnBounds.west);
        const lat = spawnBounds.south + Math.random() * (spawnBounds.north - spawnBounds.south);
        particle.x = ((lng - bounds.west) / (bounds.east - bounds.west)) * width;
        particle.y = ((bounds.north - lat) / (bounds.north - bounds.south)) * height;
        particle.age = 0;
        particle.maxAge = maxAge + Math.floor(Math.random() * 30) - 15;
        particle.trail = [{ lng, lat, age: 0 }];
      }
    });
  }, [windData, speedFactor, trailLength, maxAge, viewBounds, zoom, getSpeedFactor, getTrailLength]);

  // Create deck.gl layers with fading trails (head bright, tail fades out)
  const createLayers = useCallback(() => {
    if (!windData) return [];
    
    const particles = particlesRef.current;
    const { imageData, width, height } = windData;

    // Build segment data - each trail broken into 2-point segments with fading alpha
    const segmentData: { path: [number, number][]; color: [number, number, number, number] }[] = [];

    particles.forEach((p) => {
      if (p.trail.length < 2) return;

      // Get wind magnitude at particle head for color
      const px = Math.floor(p.x);
      const py = Math.floor(p.y);
      let magnitude = 5;
      
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const u = ((r / 255) * 100 - 50);
        const v = ((g / 255) * 100 - 50);
        magnitude = Math.sqrt(u * u + v * v);
      }

      const baseColor = getColorForMagnitude(magnitude);
      const trailLen = p.trail.length;

      // Create a segment for each pair of consecutive points
      for (let i = 0; i < trailLen - 1; i++) {
        const t0 = p.trail[i];
        const t1 = p.trail[i + 1];
        
        // Alpha fades from 255 at head (i=0) to near 0 at tail
        const alpha = Math.floor(255 * Math.pow(1 - (i / trailLen), 1.5));
        
        segmentData.push({
          path: [[t0.lng, t0.lat], [t1.lng, t1.lat]],
          color: [baseColor[0], baseColor[1], baseColor[2], alpha],
        });
      }
    });

    return [
      new PathLayer({
        id: 'wind-trails',
        data: segmentData,
        getPath: (d: any) => d.path,
        getColor: (d: any) => d.color,
        getWidth: lineWidth,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        widthMaxPixels: 3,
        capRounded: true,
        jointRounded: true,
        billboard: false,
        opacity: opacity,
        getPolygonOffset: () => [0, -100],
      }),
    ];
  }, [windData, lineWidth, opacity]);

  // Track map view changes
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;

    const updateView = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      const currentZoom = map.getZoom();
      
      setViewBounds({
        west: bounds.getWest(),
        east: bounds.getEast(),
        south: bounds.getSouth(),
        north: bounds.getNorth(),
      });
      setZoom(currentZoom);
    };

    // Initial update
    updateView();

    // Listen to view changes
    map.on('moveend', updateView);
    map.on('zoomend', updateView);

    return () => {
      map.off('moveend', updateView);
      map.off('zoomend', updateView);
    };
  }, [mapRef]);

  // Reinitialize particles when zoom changes significantly
  useEffect(() => {
    if (enabled && windData && viewBounds) {
      initParticles(viewBounds, zoom);
    }
  }, [zoom > 6 ? Math.floor(zoom) : 0, enabled, windData]); // Only reinit on significant zoom changes

  // Animation loop
  useEffect(() => {
    if (!enabled || !windData || !mapRef.current) {
      removeOverlay();
      return;
    }

    const map = mapRef.current.getMap();
    if (!map) {
      removeOverlay();
      return;
    }

    // Create overlay if it doesn't exist
    if (!overlayRef.current) {
      overlayRef.current = new MapboxOverlay({
        interleaved: false,
        layers: [],
      });
      map.addControl(overlayRef.current as any);
      attachedMapRef.current = map as mapboxgl.Map;
    }

    // Initialize particles with current view
    const bounds = map.getBounds();
    if (!bounds) return;
    const currentZoom = map.getZoom();
    initParticles({
      west: bounds.getWest(),
      east: bounds.getEast(),
      south: bounds.getSouth(),
      north: bounds.getNorth(),
    }, currentZoom);

    let lastTime = 0;
    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS;

    // Animation loop
    const animate = (currentTime: number) => {
      if (currentTime - lastTime >= frameInterval) {
        updateParticles();
        
        if (overlayRef.current) {
          overlayRef.current.setProps({
            layers: createLayers(),
          });
        }
        lastTime = currentTime;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [enabled, windData, mapRef, initParticles, updateParticles, createLayers, removeOverlay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeOverlay();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [mapRef, removeOverlay]);

  // Handle enable/disable
  useEffect(() => {
    if (!overlayRef.current) return;

    if (!enabled) {
      overlayRef.current.setProps({ layers: [] });
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, [enabled]);

  return null;
}

export default DeckWindParticleLayer;
