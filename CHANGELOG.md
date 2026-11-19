# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
Each release ticket writes the `## [X.Y.Z] - YYYY-MM-DD` section from the conventional commits since the previous tag;
`.github/workflows/release.yml` publishes that section as the GitHub Release notes.

## [Unreleased]

## [0.1.0] - 2026-11-19

First public release.

### Added
- **Trail map** of metropolitan France: start points grouped in clusters, a track opens in a side panel (stats, sources, planned outings, elevation profile synchronised with the map), slope-coloured line, kilometre markers, map view kept in the URL. Usable without an account (public tracks and outings only).
- **3D relief**: a "3D" button tilts the map over the terrain (AWS Open Data elevation tiles); maps always open flat.
- **Track editor**: draw or edit a track snapped to trails with self-hosted BRouter routing (mountain-bike profiles, with or without e-bike), drag to reroute, choose between two paths after a drag, alternatives, undo/redo, drafts saved automatically, GPX/KML import.
- **Track sources**: OpenStreetMap mountain-bike routes and singletracks, Geotrek official routes, elevation from IGN for accurate elevation gain.
- **Track visibility**: public, friends or private, with per-account defaults.
- **Outings**: dated rides on a frozen copy of a track, meeting point and directions, personal invitation links that guests follow without an account, answers (I'm in / maybe / no), who's coming, comments, rides and photos after the outing, calendar export and subscription, GPX, duplication.
- **Conditions** on each outing: weather (Open-Meteo), fire risk and hunting information for the Var department.
- **Friends** between accounts, public or private profile, ride statistics.
- **Federation (ActivityPub)**: friends and outings across Singletrack servers, moderation tools (blocked servers and accounts, rate limits, reports); on by default when `FEDERATION_KEY_ENC` is set.
- **Passwordless sign-in**: code, link and QR code by email.
- **French and English** interface, mobile first, light and dark themes, a refined visual charter (Inter, indigo accent, glass floating layers).
- **Self-hosting**: multi-arch images on GHCR (`singletrack`, `singletrack-brouter`, `singletrack-tools`), distribution `compose.yml`, `init-env.sh`, install guide.

