# HRRR Weather Visualization

Real-time HRRR (High-Resolution Rapid Refresh) custom wind visualization with animated deck.gl particles.

## Features

- **Animated Wind Particles** - Visualize wind speed and direction with flowing particles
- **Forecast Controls** - Scrub through available forecast hours from the latest HRRR run
- **Real-time Data** - Fetches latest HRRR model runs automatically

## Tech Stack

- **Next.js 15** - React framework
- **Mapbox GL JS** - WebGL-powered maps
- **react-map-gl** - React bindings for Mapbox
- **HRRR Data** - NOAA High-Resolution Rapid Refresh model

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local`:
```bash
cp .env.example .env.local
```

3. Add your Mapbox token to `.env.local`

   The app includes a fallback public token for local development, but `NEXT_PUBLIC_MAPBOX_TOKEN` still takes precedence.

4. Run development server:
```bash
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Public Mapbox access token. Overrides the built-in fallback token. |
| `MAPBOX_SECRET_TOKEN` | Secret token for tileset metadata (optional) |

## Data Sources

- **Wind Particles**: Mapbox tileset `onwaterllc.wind-hrrr-daily-two`
- **Weather Tiles**: S3-hosted raster tiles with latest HRRR wind data
- **Metadata**: `https://sat-data-container.s3.us-east-1.amazonaws.com/metadata/latest.json`

## Deployment

Deploy to Vercel:
```bash
vercel
```

Add environment variables in Vercel dashboard.
