# Device sensor rollout plan

## Product goal

Let a user connect a device to Change Detective, explicitly choose a directory,
and view storage measurements in the web dashboard without installing a
developer toolchain or cloning this repository.

The sensor measures metadata and directory sizes only. It must not read file
contents, bypass operating-system permissions, or scan outside the user's
approved scope.

## Platform approach

### Desktop: Windows, macOS, and Linux

1. Keep the existing agent protocol and scanner as the first implementation.
2. Produce platform-specific bundles containing the agent, production
   dependencies, and a matching Node runtime. This removes the end user's
   Node.js and repository setup requirements.
3. Add a guided pairing and folder-selection UI, consent and pause controls,
   connection health, and a supported uninstall/revoke path.
4. Build and verify each target on its native CI runner. Sign Windows and
   macOS releases before public distribution.
5. Evaluate a native Rust/Go implementation only if bundled Node proves too
   large or difficult to maintain; do not rewrite the scanner before the
   packaged-agent path is measured.

### Android

1. Build a native Kotlin app; do not require Termux or Node.js.
2. Use Android's Storage Access Framework so users select and grant access to
   a directory. Do not request broad storage access as a shortcut.
3. Implement scanning through the selected document tree, persist the grant
   and credentials using Android platform storage, and submit measurements
   through the existing HTTPS agent API.
4. Use WorkManager for background work, while clearly communicating Android's
   battery and background-execution limits.
5. Add Android-specific root identity/display handling to the API before
   treating SAF document URIs as filesystem paths.

## Milestones

1. **Desktop bundle proof:** Build a runnable bundle on the build host with an
   embedded runtime and production dependencies. Browser-approved pairing,
   restart from saved credentials, and queue persistence are implemented for
   the sensor workflow.
2. **Desktop release pipeline:** Build Windows/macOS/Linux bundles on native
   CI runners. Windows ZIP and Linux tar.gz release assets are configured;
   verify actual native builds, then add signatures and graphical
   installation/uninstallation.
3. **Android technical spike:** Create the native app shell, pair it with the
   existing API, and scan a user-selected SAF directory into the current
   measurement format.
4. **Dashboard onboarding:** Windows/Linux downloads and browser approval are
   in place. Add clear connection, scan, pause, automatic-start, and revoke
   flows.
5. **Platform validation:** Test representative OS versions, unavailable
   permissions, offline uploads, app upgrades, revocation, and data retention
   before claiming a platform is supported.

## Constraints and acceptance criteria

- The hosted website alone cannot access arbitrary files on a user's device;
  the local sensor must be installed and explicitly approved.
- Android SAF grants access only to user-selected locations. The app must not
  imply whole-device access.
- Desktop bundles include Node and install without requiring the user to
  install Node.js. They are currently unsigned portable previews, not
  installers; verify native CI artifacts and add startup/uninstall support
  before claiming a finished release.
- Android is not supported until scanning works through SAF without Termux,
  permissions are recoverable after process restarts, and queued results
  synchronize after network interruptions.
- Directory measurements and the approved root are sent to the service; file
  contents are not.
