# wali (iOS app)

The wali iPhone app: sign in, talk to wali, read what the pendant heard, see what wali remembers,
and run the pendant. It is the phone half of the pendant pipeline too: it connects to the pendant
over BLE, saves every audio frame to disk, cuts the stream into segments and uploads them as WAV to
Convex. Feature parity with the web app (`../web/apps/app`) on the same Convex deployment. The BLE
contract is `../firmware/PROTOCOL.md` (v2).

Stack: Expo SDK 58 (React Native 0.88, New Architecture), expo-router with native tabs and native
stack headers, Clerk (`@clerk/expo`, Core 3), Convex 1.50 (`ConvexProviderWithClerk`), `@expo/ui`
(SwiftUI), expo-glass-effect, react-native-keyboard-controller, react-native-ble-manager 13,
expo-file-system, expo-sqlite, expo-audio.

BLE and the native UI need native code, so this runs in a **development build or EAS build, not Expo Go**.

## What's native and what's ours

The rule: if iOS has the control, use it. Brand-specific surfaces are custom.

| Native (system) | Custom (wali brand) |
|---|---|
| Tab bar (`NativeTabs`, Liquid Glass on iOS 26+) | Chat thread, message bubbles, nudge and approval cards |
| Stack headers, back buttons, swipe-back, large titles (set in Fraunces) | Composer (native text view inside a `GlassView` capsule) |
| Header toolbar buttons and menus (`Stack.Toolbar`) | Welcome screen (photo, wordmark, display type) |
| Search bars (`Stack.SearchBar`) on Chats, Transcripts, Memory | Pill buttons, cards, the pendant hero |
| Context menu + preview on chat rows (`Link.Menu` / `Link.Preview`) | Markdown renderer for wali's replies |
| Settings screens as SwiftUI `Form`s: toggle, time pickers, steppers, gauge (`@expo/ui`) | |
| Text fields (UITextField: email/password/one-time-code autofill), alerts, action sheets, `Switch` | |
| OAuth in the system auth sheet (`expo-web-browser`) | |

Fonts are static instances of Fraunces (SOFT 100, WONK 0, weight 340) and Figtree (400/500/600),
cut from the variable fonts by `scripts/instance-fonts.py` and embedded by the expo-font plugin.
Tokens live in `src/theme.ts`; the wordmark and app-icon tile are SVG paths from the brand kit (`src/brand`).

## Screens

```
(auth)   Welcome (Google or email) -> Email -> Create account (new emails) -> Code
(app)    native tabs
  wali         home thread: nudges land here, chat with wali
  Chats        all chats, search, new chat, long-press: rename/delete; thread view
  Transcripts  local upload queue + server recordings by day, search; detail with playback
  Memory       Supermemory profile (About you / Lately), search, notes wali saved
  Pendant      BLE connect/mute, link to account, and:
               Pendant details (live status, link health), When wali speaks up (SwiftUI Form),
               Connections (Composio apps, wali's browser), Activity (Jev gate log, follow-ups),
               Try it without the pendant, Diagnostics (queue, test clip, simulated pendant), Sign out
```

When the phone connects to a pendant over BLE, the signed-in account is linked to the pendant
stream automatically (`devices.connect`, same as the web app's "Connect pendant").

## Auth

Clerk custom flow on the Core 3 API (`src/auth/flow.ts`): sign-in by emailed code; a new email
creates an account (this instance requires a password; iOS offers a strong one) and verifies with a
code; Google through `useSSO`. Convex gets Clerk's `convex` JWT template through
`ConvexProviderWithClerk`. The Clerk instance is the web app's accountless dev instance, in test
mode: any `name+clerk_test@example.com` address works with code `424242`.

The pendant pipeline starts before sign-in and never depends on it: audio is saved first, always.

## Environment

| Variable | Where | Value |
|---|---|---|
| `EXPO_PUBLIC_CONVEX_URL` | `.env.local` (gitignored) for local dev | dev: `https://dapper-retriever-913.convex.cloud` |
| | `eas.json` per build profile | `development*`: dev, `preview` / `production`: prod `https://posh-orca-594.convex.cloud` |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` and `eas.json` | the web app's Clerk dev instance (publishable, not secret) |

The app has no secrets. The ElevenLabs key lives only in Convex.

## Simulators (simslim + AXe)

Simulators are slimmed with [simslim](https://github.com/MobAI-App/simslim) (`brew install mobai-app/tap/simslim`),
which turns off ~175 background daemons (about 4 GB -> 0.9 GB per simulator):

```bash
simslim list
simslim on <udid>                       # slim and reboot (done for "iPhone 18 Pro")
npx expo run:ios -d "iPhone 18 Pro"     # build the dev client (by name; a UDID triggers device signing)
```

[AXe](https://github.com/cameroncooke/AXe) (`brew install cameroncooke/axe/axe`) drives a headless simulator:
`axe tap -x 201 -y 810 --udid <udid>`, `axe tap --label Send`, `axe type 'text'`, `axe describe-ui`.
Type in short chunks: fast input can drop characters in controlled text inputs.

## Run on your own iPhone (dev build)

```bash
npm install
npm test                 # ADPCM / segmenter / WAV unit tests (node --test)
npx tsc --noEmit

# Option A: build locally with Xcode (iPhone plugged in, Developer Mode on)
npx expo run:ios --device

# Option B: EAS dev build (registers the device, installs via QR link)
eas device:create                                  # once per iPhone
eas build -p ios --profile development
npx expo start --dev-client                        # then open the app on the phone
```

`patches/expo-dev-launcher+58.0.20.patch` (applied by `patch-package` on `npm install`, also on
EAS) removes an `axisBehavior` call that doesn't compile with the Xcode 27.0 SDK. Drop it once
expo-dev-launcher ships a fix.

If CocoaPods crashes with `Unicode Normalization not appropriate for ASCII-8BIT`, run
`export LANG=en_US.UTF-8` first.

## Build for a friend's iPhone (ad hoc "preview" build, points at prod)

```bash
npm i -g eas-cli          # >= 16; tested with 27.10
eas login                 # already logged in as reedgrenager
eas device:create         # send the friend the link/QR; they install the profile -> UDID registered
eas build -p ios --profile preview
```

EAS asks for your Apple ID on the first build and creates the distribution certificate and an
ad hoc provisioning profile that includes the registered devices (answer "yes" to generate). When
the build finishes, send the friend the install link/QR from the build page. A device added
later needs a rebuild (`eas build -p ios --profile preview`, pick "yes" to update the profile).

EAS uploads the working tree (respecting `.gitignore`, so `ios/`, `node_modules/` and
`.env.local` are excluded); a commit is not required (checked with
`eas build:inspect --stage archive`).

**TestFlight alternative** (no UDIDs, friend installs TestFlight):
`eas build -p ios --profile production --auto-submit` (or `eas submit -p ios` afterwards), then
add the friend as an internal/external tester in App Store Connect.

## Over-the-air updates (EAS Update)

JS-only changes ship without a rebuild. Each build profile listens on the channel of the same name
(`preview-dev`, `preview`, `production`, ...):

```bash
npx eas-cli@latest update --channel preview-dev --message "what changed"
```

The phone downloads the update when wali opens and runs it from the next launch. Open wali, wait a
few seconds, then close it from the app switcher and open it again.

- `runtimeVersion` uses the `fingerprint` policy: any native change (new native package, config
  plugin, `app.json` iOS settings) gives a new runtime, and old builds ignore updates for it.
  Those changes need a new build.
- Debug dev-client builds don't apply updates; they load JS from Metro.
- With the background launch (below), the headless React host loads the same bundle expo-updates
  would launch (`plugins/withBackgroundLaunch.js`).

## Pipeline (save first, never lose audio)

```
BLE notify (172 B frame)                         src/lib/ble.ts
  -> recorder.onFrame                            src/lib/recorder.ts
       segmenter decide(): append / new / drop   src/lib/segment.ts
       FrameWriter: append [u16 len][frame] to segments/<uuid>.frames, flushed every 1 s
       SQLite row per segment (state=recording)  src/lib/db.ts
  -> close segment (20 s without frames, 5 min of audio, bootTag change, seq gap > 20 s,
     seq going backwards, app -> background, Force close)
  -> build: decode IMA ADPCM per frame from its header state, place by seq into a linear 16 kHz
     timeline (gaps = silence), levels = frame RMS per 20 ms slot (0 = gap), write <uuid>.wav,
     startedAt via PROTOCOL §8, state=queued
  -> uploader (src/lib/uploader.ts), whenever online / app active / every 30 s:
     recordings.generateUploadUrl -> File.upload (raw body, iOS background session)
     -> recordings.create(clientId = segment uuid, ...) -> state=uploaded
     failures: backoff 5 s .. 10 min, state stays queued; survives restarts
  -> local files deleted 3 days after upload
```

- **Segments**: frames of the same boot whose seq gaps are < 20 s (gated START...END stretches
  with short pauses stay in one segment, so Scribe speaker ids are consistent). Backfill frames
  arrive in seq order through the same path and are segmented the same way.
- **Clock**: every Status at phone time T gives an anchor per `bootTag`;
  `wall(seq) = T - (status.seq - seq) * 20 ms`. Frames whose bootTag has no Status (backlog
  from an earlier boot) are timed relative to the first frame received from them and uploaded with
  `timeApprox: true`.
- **Crash safety**: segments left in `recording` (app killed) are rebuilt from their frames file
  on the next launch; `uploading` goes back to `queued`. `recordings.create` is idempotent on
  `clientId`, so retries never duplicate.
- **Background**: `UIBackgroundModes: bluetooth-central` and a CoreBluetooth restore identifier
  (`com.reedgrenager.mind.central`) keep notifications flowing while the screen is off. The
  connection is a pending iOS connect, so the phone reconnects whenever the pendant is back in range.
- **Relaunch after iOS kills the app**: the pipeline starts when the JS bundle loads (`index.ts` ->
  `src/lib/boot.ts`), not when a screen mounts. In Release builds, `plugins/withBackgroundLaunch.js`
  starts the React host without a view on a background launch, because under the scene life cycle
  React Native otherwise starts only when a UI scene connects, which a Bluetooth relaunch may never
  do. Dev-client (Debug) builds don't get this (the dev launcher picks the bundle), so test
  background behavior with a `preview-dev` build. A force-quit (swipe away) app is never relaunched
  by iOS.
- **Uploads in the background** use a regular URLSession: iOS defers background-session transfers
  started while the app is backgrounded (discretionary), which held audio for up to 100 min.
- **MTU**: on connect the app reads the max write length (ATT MTU - 3) and shows an error if
  MTU < 175 (a frame wouldn't fit one notification).

## Connection handling (Nov 15 fixes)

The Convex client only hears about network changes through the browser's `window "online"` event,
which React Native doesn't have. After a Wi-Fi/cellular switch or a spell in the background it kept
waiting on a dead socket for up to 60 s, then sat out a reconnect backoff: chats and transcripts
spun, sent messages vanished, "New chat" did nothing, and actions failed with "Connection lost
while action was in flight".

- `src/lib/connection.ts` reconnects on NetInfo changes and on foregrounding, restarts a socket
  that's stalled (a mutation in flight for 10 s, or a screen waiting 8 s on a query), shortens the
  dead-socket timer to 30 s, and publishes `ok` / `reconnecting` / `offline`. It uses the client's
  WebSocket manager, which isn't public API; every access is guarded.
- `ConnectionPill` (under the navigation bar) and `Loading` (a spinner that says why it's still
  there) show that state. Use `Loading` wherever a screen waits on the server.
- `messages.send` is optimistic: the bubble appears at once with "Sending…", and the text goes
  back in the field if the send fails.
- Errors shown to people go through `friendlyError` (`src/lib/errors.ts`): no `[CONVEX A(...)]`,
  no "Called by client". Loads that fail show `LoadError` in the page with a retry, not an alert
  (an alert could arrive minutes later over a different screen).
- `useReadAction` retries read-only actions and gives up with a timeout; `useTimedAction` puts a
  deadline on actions that change things.

## Layout

```
src/app/            routes: (auth)/*, (app)/_layout (native tabs), (app)/{(home),chats,transcripts,memory,settings}/*
src/auth/           Clerk flow hooks, auth form pieces
src/chat/           ChatView, Composer, Cards (nudge/approval/update), ToolCall
src/ui/             Pill, Card, Row, Page, Markdown...
src/brand/          Wordmark, WaliMark, EmberDot (+ generated SVG paths)
src/theme.ts        colours, fonts, type
src/lib/convex-api.ts  typed Convex API (generated; same file as web/apps/app/lib/convex-api.ts)
src/lib/protocol.ts UUIDs, frame/status parsing (PROTOCOL.md)
src/lib/adpcm.ts    IMA ADPCM decoder (+ reference encoder for tests/simulation)
src/lib/segment.ts  segmenter, record format, assembly, clock math (pure, unit tested)
src/lib/wav.ts      WAV writer/reader
src/lib/recorder.ts frames -> disk -> segments -> WAV
src/lib/uploader.ts queue -> Convex
src/lib/convex.ts   ConvexReactClient + hand-typed pipeline API
tests/              node --test unit tests
assets/             brand icons, fonts, photos, test clip
```

## Robustness notes (Nov 14 fixes)

- **Writes are synchronous.** In expo-file-system SDK 58, `File.write()` is async. The pipeline
  uses `writeSync` everywhere, writes WAVs to `<id>.wav.tmp` and moves them into place, and checks
  the size. An unawaited write caused "WAV file missing" on a large segment.
- **Fast Refresh safe.** All pipeline state lives in `src/lib/runtime.ts` singletons, and every
  native listener and interval is registered through `replace()`. Re-running `startPipeline()`
  swaps listeners instead of stacking them. Crash recovery runs once per JS runtime and never
  builds the segment that's still recording.
- **Background.** iOS freezes JS timers while the app is suspended but still wakes it for BLE
  events. Segment closing, sweeps and upload kicks therefore also run on incoming frames and
  Status. Uploads use `ConvexHttpClient` (HTTPS) rather than the WebSocket client. Locking the
  phone flushes frames to disk but doesn't split the conversation.
- **Self-healing.**
  - A missing or truncated WAV is rebuilt from the `.frames` file.
  - Segments stuck in `recording` are rebuilt by a 30 s sweep.
  - Broken segments whose frames still exist are retried on startup.
  - A hung upload is abandoned by a watchdog and retried; `create` is idempotent.
  - The uploader can't lose a wake-up.
- **Background CPU.** iOS kills a background app that averages more than 80% CPU over 60 s
  (`cpu_resource_fatal` in Settings > Privacy > Analytics Data). Pipeline stores skip no-op
  updates and don't notify React while the app is inactive (`src/lib/store.ts`). Components select
  only what they need (`useStoreSelector`). Date formatters are cached (`src/lib/time.ts`). Idle
  CPU went from about 20% to about 1%. Crash and CPU reports can be pulled from a paired iPhone
  with `xcrun devicectl device info files --domain-type systemCrashLogs`.
- **Diagnostics.** The Device tab's "Background and link health" section shows frames received
  while backgrounded (all / backfill), subscription state, how Status arrives (notify vs read) and
  the last upload. Status turns orange when it's more than 6 s old.

### Tests

`npm test` runs unit tests plus `tests/runtime.test.ts`: about 30 integration scenarios that run the
real recorder, uploader and BLE modules in Node. The fakes are `node:sqlite` for expo-sqlite, a
temp dir for expo-file-system, a scriptable pendant for ble-manager, and a fake Convex server. The
scenarios cover:
- Fast Refresh re-init, crash recovery, missing or truncated WAVs
- full disk, offline/online, hung uploads, lost `create` responses
- reconnect re-sends, frozen background timers, pendant reboot
- BLE reconnect, state restoration and mute confirmation
