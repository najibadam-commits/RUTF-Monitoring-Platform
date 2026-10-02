# TPM Process Monitoring — Android App

Native Android implementation of the TPM Process Monitoring field app, built from the design
handoff package in `../design_handoff_android/` (`README.md` is the spec of record; the `.dc.html`
prototype and `issue-map.jsx` are supporting reference for exact copy/behavior — see
`CLAUDE_CODE_PROMPT.md` for the full brief this was built against).

Kotlin + Jetpack Compose, Navigation Compose, Room, WorkManager, CameraX, FusedLocationProviderClient,
osmdroid (OpenStreetMap — see the map-SDK note below).

## How to Build & Run

### Option A — Android Studio (recommended)

1. Open this `android/` folder as a project in Android Studio (Koala/2024.1+ recommended).
2. Let Gradle sync finish (it will download dependencies on first sync — needs network access).
3. Select a device: a physical device with USB debugging enabled, or a Google APIs/Google Play
   emulator image (needed for FusedLocationProviderClient's Play Services dependency — a plain
   AOSP image without Play Services will fail location capture).
4. Run ▶ the `app` configuration.

### Option B — Command line

```bash
cd android
./gradlew assembleDebug      # builds app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug       # builds and installs to a connected device/emulator
```

On Windows use `gradlew.bat` instead of `./gradlew`.

**Minimum requirements:** JDK 17+, Android SDK with `compileSdk 35` / `build-tools 36.0.0`
platform installed (`sdkmanager "platforms;android-35"` if not already present), and a
`local.properties` pointing `sdk.dir` at your SDK — Android Studio creates this automatically on
first open; for CLI-only builds, copy `local.properties.example` if present or create one with
`sdk.dir=/path/to/Android/Sdk`.

**First-run permissions:** the app requests Location, Camera, and Microphone permissions
in-context (on the GPS/photo/voice-to-text steps of the wizards, not all at launch) — grant them
when prompted to exercise those flows. All three have graceful denial states if you decline.

### A note on this dev environment

This project was built and code-reviewed in a session where the local machine's networking
blocked Gradle's daemon IPC (`Unable to establish loopback connection`, traced to something
intercepting local socket connections — likely corporate VPN/EDR software) — so a live
`./gradlew assembleDebug` couldn't be run start-to-finish here to confirm a completely clean
build. The code was written carefully against stable, well-documented APIs and reviewed file by
file, but **please treat your first build in Android Studio as the real verification step** and
report back anything that doesn't compile — happy to fix fast.

## Project Structure

```
app/src/main/java/org/tpmnigeria/tpm/
├── domain/           Plain Kotlin models + business rules (SLA calc, status/severity meta,
│                      issue ID generation, location seed data) — no Android dependencies.
├── data/              Room entities/DAOs/database, AppRepository (the single read/write API
│                      the UI talks to), seed data matching the prototype's 5 sample issues.
├── session/           AppSession — in-memory login/role/demo-offline state.
├── sync/              SyncApiService (TODO(backend) stub), SyncWorker, SyncScheduler —
│                      the offline-sync pipeline.
├── ui/theme/          Design tokens (Color/Type/Dimens), Modifier.blueprintCorners().
├── ui/components/     Reusable design-system widgets (buttons, cards, tags, inputs, header,
│                      bottom nav, profile sheet) + the GPS/Camera/Voice capture modals.
├── ui/navigation/     Routes + AppNavHost (the Scaffold: header/bottom-nav/sync-banner/toast
│                      chrome wrapping a Navigation Compose graph).
├── ui/screens/        The 8 non-wizard screens (Login, Home, Issue List, Issue Detail, Map,
│                      Notifications, Sync Queue).
└── ui/wizard/         The 3 multi-step wizards (newissue/, driresponse/, verification/), each
                       a ViewModel + screen pair sharing ui/wizard/common/'s WizardScaffold.
```

## Explicitly Out of Scope (see TODO comments at each site)

These were called out in the design handoff as needing a decision from the team, not something to
guess at — the client-side seams are in place, but nothing behind them is real yet:

- **Backend API** — `sync/SyncApiService.kt`. `StubSyncApiService` simulates a successful push
  after a short delay; `AppRepository` and `SyncWorker` only depend on the `SyncApiService`
  interface, so swapping in a real client (Retrofit/Ktor) doesn't require touching either.
- **Push notifications (FCM)** — see the `TODO(fcm)` comment in `AndroidManifest.xml`
  (`POST_NOTIFICATIONS` permission is already declared for API 33+; no FCM SDK/service is wired
  up). In-app notifications (the Notifications screen + unread badges) work today via Room —
  it's only *server-triggered* push that's missing.
- **Map SDK / API key** — `ui/screens/MapScreen.kt` uses osmdroid (OpenStreetMap tiles, no API
  key) instead of Google Maps or Mapbox, specifically so the Map screen works out of the box
  without provisioning a key. If the team wants Google Maps/Mapbox for production (nicer tiles,
  offline packs, etc.), that's a swap inside `MapScreen.kt` — `AppRepository`'s issue data and the
  severity/overdue pin-coloring logic (`domain/SeverityMeta.kt`) don't change either way.

## Known Simplifications (deliberate, documented at the point of the decision)

- **Location cascade data** (`domain/LocationData.kt`) is the prototype's small 3-state sample
  set, per the README's own "treat as seed/sample data" note — not the real
  state/LGA/ward reference data. (Worth noting: `../LGA.sqlite`, `../Ward.sqlite`, and
  `../state.sqlite` sit right next to this project and look like real Nigerian admin-boundary
  data — swapping them in would be a natural next step, but pulling in and querying a ~10–25MB
  SQLite asset was out of scope for this handoff pass.)
- **Design-token discrepancies between the README and `_ds_styles.css`/the `.dc.html` prototype**
  (corner radius: rounded vs. the CSS's later "blueprint frame" override to square; corner-bracket
  color: accent vs. the CSS's muted text; tag shape: pill vs. square) were resolved in the
  README's favor throughout, since `CLAUDE_CODE_PROMPT.md` names it the spec of record and the
  other files as supporting reference only. See comments in `ui/theme/Dimens.kt` and
  `ui/theme/BlueprintCorners.kt`.
- **Issue Detail CTA copy** ("Respond to Issue" / "Verify Resolution") follows the README's quoted
  button text rather than the prototype's slightly different internal labels ("Update Response"
  for an already-Ongoing DRI response, "Start Final Verification") — same reasoning as above.
- **Login** accepts any non-blank username/password (no real backend to authenticate against yet)
  and always signs in as Field Monitor, matching the prototype — use the profile sheet's demo role
  switcher to preview the DRI experience. Per README §11, drop that switcher (and the demo
  connectivity toggle next to it) once real authentication exists.
