# SheepIt (Share App for Android, iPhone/iPad & macOS)

**SheepIt** (`com.yaroslavvb.sheepit`, by [@yaroslavvb](https://github.com/yaroslavvb)) uploads whatever you're looking at—any webpage in Chrome or Safari (with its stylesheets, images, KaTeX/MathJax math, Shadow DOM components, WebGL canvases, and streaming media) or any file on your device (images, PDFs, videos, audio, Markdown, CSV, JSON)—straight to your [Spacesheep](https://spacesheep.dev). Pages with client-rendered or lazy-loaded photos take a few extra seconds to capture.

- **Install & Status Guide (with demo video):** [`https://spacesheep.dev/@yaroslavvb/sheepit-app`](https://spacesheep.dev/@yaroslavvb/sheepit-app)
- **SheepIt Hub (Weekly Log, Pages & Builds):** [`https://spacesheep.dev/@yaroslavvb/sheepit-hub`](https://spacesheep.dev/@yaroslavvb/sheepit-hub)
- **SheepIt Quality Control (23-Site Audit):** [`https://spacesheep.dev/@yaroslavvb/sheepit-quality-control`](https://spacesheep.dev/@yaroslavvb/sheepit-quality-control)
- **Android app & Google Play bundle (`com.yaroslavvb.sheepit`):** `sheepit-v0.6.3.apk` / `sheepit-v0.6.3.aab` (version `0.6.3`, build `34`, API 37)
- **iPhone & iPad app + Share Extension (`com.yaroslavvb.sheepit`):** `ios/ShareToSpacesheep.xcodeproj` (`sheepit-v0.6.3.ipa` / `sheepit-ios-simulator-v0.6.3.zip`)
- **macOS Quick Action & Node CLI:** `bin/share-to-spacesheep.mjs` (`sheepit`)

---

## Download & Install

### Android (Phone / Tablet — Android 8.0+)

#### Way 1: Google Play Store (Self-Serve Testing Track)
1. **Join the tester Google Group:** Open [`https://groups.google.com/g/sheepit-testers`](https://groups.google.com/g/sheepit-testers) (signed into the same Google account used on your Android phone's Google Play Store) and click **Join group**.
2. **Opt in to the testing track:** Open [`https://play.google.com/apps/testing/com.yaroslavvb.sheepit`](https://play.google.com/apps/testing/com.yaroslavvb.sheepit) and tap **Become a tester**.
3. **Install from Google Play:** Tap **download it on Google Play** (or open [`https://play.google.com/store/apps/details?id=com.yaroslavvb.sheepit`](https://play.google.com/store/apps/details?id=com.yaroslavvb.sheepit) on your Android phone) and tap **Install**.

#### Way 2: Direct APK (`sheepit-v0.6.3.apk` — no Google Group needed)
1. **Direct APK Download:** Download [`sheepit-v0.6.3.apk`](https://github.com/yaroslavvb/share-to-spacesheep/releases/download/v0.6.3/sheepit-v0.6.3.apk) from [**GitHub Releases**](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) and open it on your Android phone.
2. **Auto-updates via Obtainium:** Add `https://github.com/yaroslavvb/share-to-spacesheep` to [Obtainium](https://github.com/ImranR98/Obtainium) on Android for one-tap updates.
3. **Or install the `.aab` bundle from a computer with `bundletool`:**
   ```bash
   bundletool build-apks --bundle=play-store/sheepit-v0.6.3.aab --output=sheepit.apks --connected-device
   bundletool install-apks --apks=sheepit.apks
   ```
4. **First-time sign-in:** Open **SheepIt** once and tap **Sign in with Spacesheep** (or paste an `ss_…` API key from `spacesheep.dev/settings/api-keys`).
5. **Pin SheepIt to the top of your Share menu:** In Chrome, tap **⋮ → Share…**, scroll down the alphabetical list to **S → SheepIt**, **long-press the SheepIt icon**, and tap **"Pin SheepIt"** (`📌 SheepIt`).

### iPhone & iPad (iOS / iPadOS 16+)
The iPhone/iPad app ([`ios/ShareToSpacesheep.xcodeproj`](ios/ShareToSpacesheep.xcodeproj)) includes both the standalone **SheepIt** app (`com.yaroslavvb.sheepit`) and a native **iOS/iPadOS Share Extension** (`com.yaroslavvb.sheepit.ShareExtension`) that shares credentials via App Group `group.com.yaroslavvb.sheepit` and appears as **SheepIt** directly in the Safari, Chrome, and Files share sheet.
1. **Install with TestFlight:** Open [the public beta invitation](https://testflight.apple.com/join/Tu1RPMVr), then install **SheepIt for Spacesheep** in Apple's TestFlight app. The [installation and status guide](https://spacesheep.dev/@yaroslavvb/sheepit-app) lists the latest available build.
2. **Sign in once, then share:** Open SheepIt and sign in. In Safari, Chrome or Files, tap **Share → SheepIt**. Keep the share sheet open until image copying finishes.
3. **Developer install:** Open `ios/ShareToSpacesheep.xcodeproj` in Xcode, select your Apple team under **Signing & Capabilities** for both targets, choose your connected device, and press **Run (⌘R)**. The downloadable IPA requires compatible signing; third-party sideloading is unverified.

### Capture regression checks

Serve the repository with `python3 -m http.server 8769`, then open `http://localhost:8769/tests/capture-hydration.html`. The fixture checks image hydration, lazy loading, saved image bytes, responsive layouts, and failure handling in a real browser.

---

## Releasing to Google Play Store & Apple App Store

### Google Play Store (`scripts/release-playstore.sh`)
Release a new version to Google Play in one command (auto-increments `versionCode` past the highest bundle in Play Console, builds the signed `.aab` and `.apk` targeting the latest stable Android SDK, and publishes to the track):
```bash
# Check Play Store API connectivity and current track versions
./scripts/release-playstore.sh --check-only

# Bump versionCode, build signed AAB + APK, and publish to internal testing
./scripts/release-playstore.sh --bump

# Publish to production track
./scripts/release-playstore.sh --track production --bump
```

All Google Play Store assets and metadata live in [`play-store/`](play-store/) and [`fastlane/metadata/android/en-US/`](fastlane/metadata/android/en-US/):
- **Signed Release Android App Bundle (`.aab`):** `play-store/sheepit-v0.6.3.aab` (`play-store/sheepit-latest.aab`)
- **Signed Release APK (`.apk`):** `play-store/sheepit-v0.6.3.apk` (`play-store/sheepit-latest.apk`)
- **512×512 High-Res Icon:** [`play-store/icon-512x512.png`](play-store/icon-512x512.png)
- **1024×500 Feature Graphic:** [`play-store/feature-graphic-1024x500.png`](play-store/feature-graphic-1024x500.png)
- **Phone & Tablet Screenshots:** [`play-store/screenshots/`](play-store/screenshots/)
- **Live Privacy Policy URL:** [`https://spacesheep.dev/@yaroslavvb/sheepit-privacy-policy`](https://spacesheep.dev/@yaroslavvb/sheepit-privacy-policy)
- **Permissions Required:** `android.permission.INTERNET` only.

### Apple App Store & TestFlight (`ios/build-appstore.sh` & `app-store/`)
All App Store Connect metadata, screenshots, privacy manifest (`ios/Shared/PrivacyInfo.xcprivacy`), and step-by-step archive/upload instructions are in [`app-store/APP_STORE_SUBMISSION.md`](app-store/APP_STORE_SUBMISSION.md):
```bash
DEVELOPMENT_TEAM=<YOUR_TEAM_ID> ./ios/build-appstore.sh
```
