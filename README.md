# Dragonfall — source handoff

Current playable browser prototype, exported from commit ecfad6c880a8998baf82ffa1fcbe64a6c7ccba8f (Sites version 7).
Original ChatGPT-hosted copy: https://dragonfall-glide.jack6323.chatgpt.site

**Play now (GitHub Pages, auto-deployed from `dist/` on every push to `main`):** https://bfarmer27-ops.github.io/dragonfall/
**Repo:** https://github.com/bfarmer27-ops/dragonfall

## Run locally
Python 3: `python -m http.server 8000 --directory dist`
Open http://localhost:8000. No build or package installation required. dist contains authored source, not generated bundles. Three.js and fonts are vendored locally.
Phone motion controls require an HTTPS host (a phone accessing a computer's plain HTTP LAN address is insufficient).
Deploy dist to any static HTTPS host. Original hosting identity is intentionally omitted from this portable export. No credentials are included.

## Files
- game.js: scene setup, camera, input, UI, loop, collisions and game state.
- flight.js: pure flight physics and tuning constants.
- tilt.js: phone orientation mapping, permission handling and calibration.
- control-settings.js: saved control mode and separate inversion preferences.
- dragon.js / wingbeat.js: procedural dragon and wing animation.
- environment.js: terrain and scenery.
- render-quality.js: render resolution budget.
- index.html / style.css: responsive UI and settings.
- vendor/: local dependencies and their licenses; retain license files.

## Accepted controls and tuning
Forward speed 1.75x original; sideways strength 1.5x original; vertical speed 2x original. Do not silently change these.
Two thumbs is the default on every device (Ryan's order 2026-09-09); phone tilt is selectable in Settings. Tilt inversion defaults OFF. Lift screen top edge to climb, lower to dive, tilt left/right to turn. Calibrate at start/resume; recenter in Settings. Screen rotation is supported.
Two-thumb mode remains selectable; its inversion defaults ON with independently saved preferences. Non-inverted thumb mapping: both up climbs, both down dives, left down/right up banks left, opposite banks right. Inversion must only reverse pitch, never bank.
Keyboard: arrows or W/S for left wing and I/K for right wing. On sensorless devices select Two thumbs in Settings.

## Current build (2026-09-09, Claude)
- Look: film-style render. HDRI sun lighting (Poly Haven kiara_8_sunset, CC0), height fog with sun scatter, storm-cloud dome, PBR canyon rock (Poly Haven cliff_side, CC0) with waterfalls, mist and birds, reflective teal water, post chain (ambient occlusion, depth of field, sun shafts, bloom, film grade) on the High tier; a lighter chain on the Phone tier. Tier is chosen in `quality.js` (Settings > Graphics: Auto / High / Phone).
- Camera: **Rider** (first person from the saddle: gloved hands, reins, horned neck ahead) is the default; **Chase** (third person behind the dragon) is in Settings > Camera. Saved in localStorage `dragonfall-camera`.
- Controls: Two thumbs is the default on every device; Phone tilt is in Settings. Tilt mapping (`tilt.js`): lower the top edge to dive, raise it to climb, lower the left/right edge to bank; one corner down does both. Keyboard: arrows, W/S, I/K.
- Flight (`flight.js`): forward speed default 2.45x the original (the accepted 1.75x build times 1.4, Ryan 2026-09-09), adjustable 1x-3.5x via `setSpeedMultiplier` (localStorage `dragonfall-speed`); vertical 2x; sideways 1.5x; landscape vertical gain helper 1.5x; nose dive after a full dive is held for 2 s.
- Written and unit-tested but NOT yet wired into game.js: `audio.js` (synthesized wind, water, waterfall, cloud, flap, wall hit, gate bell, fireball, explosion), `speech.js` (say the fire word, default "dracarys"), `fireball.js` (projectile + explosion), `net.js` (PeerJS rooms: host a 4-letter code, friends join, riders see each other, fireball hits). Wiring spec: see the project notes.
- Tests: `node --test tests/*.test.mjs` (15). Dev pages under `dist/dev/` load each module alone. Debug overlay: add `?stats=1` to the URL.
- Licenses: `dist/assets/LICENSES.txt` (Poly Haven CC0), `dist/vendor/*LICENSE*` (three.js MIT, PeerJS MIT, fonts OFL).

## Visual goal and honest status
The owner wants the graphics and gliding style of their uploaded dragon video. They explicitly reject incremental scenery changes or higher pixel counts being presented as matching that reference. The current procedural model, materials, environment and animation are an unsatisfactory prototype, not an approved visual target.
Obtain and inspect the ORIGINAL reference video before proposing a visual redesign. The currently available scratch copy failed ffprobe with `moov atom not found`; it is not included in this export. Ask the owner to attach a playable original to Claude.
Do not claim reference-level graphics without side-by-side visual evidence. First make one representative scene with the intended dragon, materials, lighting, animation and camera; have the owner assess it before expanding the world. Identify missing production assets and licensing. Choose an engine based on actual phone rendering/performance requirements, not a promise that changing engines automatically fixes art quality.

## Validation and known limitations
Syntax and CPU checks covered settings defaults, pitch/bank directions across four screen rotations, motion permission denial/unavailability, calibration and permission reuse. Physical-phone sensor behavior and visual parity have NOT been verified. Test portrait/landscape on the user's phone, including permissions, neutral drift, rotation, pause/resume and frame pacing.
Current graphics are procedural; native render resolution does not equal production art quality. No automated test suite is included in this snapshot.

## Suggested next-agent task
Read this handoff and inspect a playable reference video. Audit what must be replaced to achieve the reference's visual style. Preserve existing gameplay tuning. Build and validate one representative scene before rebuilding the full endless runner. Be explicit about required assets, limitations and mobile performance. Commit changes in reviewable stages.
