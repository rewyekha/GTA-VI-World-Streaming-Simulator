# Open-World Streaming Engine

A lightweight, original Canvas 2D demonstration of the systems behind streaming a large procedural world. It uses no game assets and makes no claim about the implementation of any commercial game. The interface borrows the reference project's focus on an explorable 10,000-chunk city and visible engine telemetry, then presents it as a recording friendly systems console.

## Run it

No Node.js, package install, or build step is required. From this directory, run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/>. Open <http://localhost:8000/?demo=1> for the deterministic 70-second guided presentation. The static page also works when opened directly, though a local server is recommended for browser consistency.

Use WASD or the arrow keys to move. Space pauses/resumes. The controls adjust travel speed and memory budget, toggle prefetch/grid/LOD/event stream, reset state, and start the guided demo.

## Architecture

- `index.html` provides the semantic dashboard, canvas, telemetry, and controls.
- `styles.css` defines the dark responsive interface and subtle state animations.
- `app.js` owns the simulation loop, procedural renderer, streaming state, metrics, and guided route.
- Canvas 2D draws only the visible neighborhood. A smooth-follow camera places the player at the center of that viewport.

The world is addressed by integer `(x, y)` coordinates in a 100 × 100 grid. Each coordinate deterministically selects a procedural district and its building layout using a seeded integer hash. No 10,000 object scene is constructed up front. Visible chunks are created on demand and rendered on the current viewport.

## Chunk streaming and prediction

The manager tracks `UNLOADED`, `LOADING`, `LOADED`, `PREFETCHING`, and `EVICTED`. A 5 × 5 demand window surrounds the player. Requests enter a simulated loading state for a seeded 470–700 ms latency; completion turns them resident. Requests are deduplicated while loading. Predictive prefetch uses the sign of player velocity to queue up to ten chunks across the next three cells. The map and minimap color those states separately. Cache hits are resident chunks touched again; misses are requests that need a load.

## LRU and memory budget

Each resident chunk consumes a modeled 1.25 MB. Before admitting a new request, the manager checks the configured hard cap and evicts the least recently used loaded chunk outside the current demand window until there is room. The currently demanded window is protected from eviction. Every eviction is logged and the memory meter updates live. The cap models chunk payload residency; it is not a measurement of browser process memory.

## LOD and rendering

Visible chunks are classified as near (<2.2 chunks), medium (<4.2), or far. Near districts draw building faces, windows, park trees, and detail; medium draws simplified forms; far draws low-detail blocks. A live estimated object count makes the effect visible. Toggle LOD to compare the full-detail near rendering. Drawing is clipped to the view neighborhood and targets standard Canvas 2D for compatibility with Intel Macs.

## Verification

The app includes a browser-side integration check at <http://localhost:8000/?test=1>. It reports checks for resident loads, prefetch queue, LRU eviction, budget enforcement, coordinate bounds, and live telemetry. In Chrome, run it headlessly with:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-sandbox --virtual-time-budget=4000 --dump-dom 'http://localhost:8000/?test=1' | rg 'PASS|FAIL|passed'
```

There is no separate production build because this is a dependency-free static application. The runtime test URL is also useful for manual inspection. Browser DevTools can be opened with Cmd+Option+I to inspect console errors.

## Record the demo

The deterministic presentation mode progresses through the overview, grid, movement, prediction, memory pressure/LRU, LOD, summary, and closing card. The no-dependency recorder captures the actual rendered Chrome tab through DevTools, then uses macOS AVFoundation to encode H.264 MP4. It does not need Node, Playwright, FFmpeg, or screen-recording privacy access.

```sh
python3 -m http.server 8000
python3 record-cdp.py --duration 72
```

The recording uses a fixed 1280 × 720 viewport and saves `output/open-world-streaming-demo.mp4`. Chrome DevTools supplies the live frames; `frames-to-mp4.swift` writes them as H.264 with AVFoundation. The frame rate is selected from captured frames and requested duration so the presentation length stays close to 72 seconds. The earlier command-line `screencapture -v` path failed in this desktop session, so the browser-tab capture is used instead.

```sh
file output/open-world-streaming-demo.mp4
mdls -name kMDItemDurationSeconds -name kMDItemPixelWidth -name kMDItemPixelHeight output/open-world-streaming-demo.mp4
```

If running from an environment where Chrome DevTools access is restricted, an interactive Mac desktop can record manually with Cmd+Shift+5 and “Record Selected Portion.”

`record-demo.mjs` remains as an optional Playwright-based alternative for machines that already have Node and Playwright installed.

## Engineering concepts demonstrated

Spatial partitioning · deterministic procedural generation · demand based chunk loading · asynchronous load latency · request deduplication · predictive prefetch · cache hit/miss accounting · LRU eviction · hard memory budgets · distance based LOD · frame telemetry · guided reproducible presentation.
