# Technical architecture

## Runtime flow

`requestAnimationFrame` drives a small simulation loop. Each frame reads keyboard intent (or the guided route), advances the player in world coordinates, synchronizes demand and prefetch regions, completes simulated loads, renders only the viewport neighborhood, then refreshes telemetry. Delta time is capped to keep tab switches from causing a large movement jump.

The world is a 100 × 100 integer grid. A coordinate hash selects the same district type and building layout on every run. Chunk records are created lazily. The Canvas renderer clips work to the camera viewport and follows the player with easing.

## Residency state machine

`UNLOADED → LOADING → LOADED` is the demand path. `UNLOADED → PREFETCHING → LOADED` is the predicted path. Eviction moves a resident to `EVICTED`; a later request can reload it. Duplicate in-flight requests are ignored. A resident touched when the player's demand window shifts is a cache hit; a newly admitted request is a miss.

## Resource control

The active 5 × 5 window is protected. A chunk reserves a modeled 1.25 MB once it becomes resident. The budget check removes the least recently used unprotected resident until there is capacity. The same check runs after loads complete and when a user lowers the budget, so asynchronous completions cannot silently exceed the modeled cap. At the UI's 32 MB minimum, 25 demanded chunks fit in 31.25 MB.

Prediction uses the normalized signs of player velocity and ranks cells across three steps ahead. The minimap exposes the direction; blue outlines indicate queued work. Disabling prediction leaves demand streaming active.

## Rendering and presentation

Three distance bands select near, medium, and far representations. Near includes windows, roof trim, park trees, and water ripples; medium uses simplified blocks; far uses low-detail building shapes. The guided route uses timed phases to expose grid, traversal, prefetch, memory pressure, LRU, and LOD. Its route and loading delays are deterministic. The live clock and actual FPS remain observational values.

## Video narration (about 60 seconds)

“This is an independent technical simulation of a large streamed world. The city is a deterministic 100 by 100 grid: ten thousand addressable chunks, generated only when needed. As the player moves, a five by five demand window requests nearby chunks and the camera follows smoothly. The blue region is predictive prefetch: velocity points the streamer toward the next cells before the player arrives. Each resident chunk consumes a modeled memory budget. When pressure rises, least recently used chunks outside the active window are evicted first. Near buildings keep their detail; distant geometry is simplified to reduce draw work. The dashboard makes residency, cache behavior, latency, memory, frame rate, and LOD visible as the simulation runs. This is an educational systems demo, not a representation of any game's internal engine.”

## Concepts to call out

- Spatial partitioning and lazy world generation
- Demand loading and asynchronous latency
- Motion prediction and prefetch queue prioritization
- Cache hit/miss accounting
- LRU replacement under a hard modeled memory budget
- Level of Detail and draw workload tradeoffs
- Runtime observability and reproducible demo routes
