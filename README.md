# SheepIt (Unofficial Share App for Android, iPhone/iPad & macOS)

> **Third-Party Disclaimer:** **SheepIt** (`com.yaroslavvb.sheepit`) is an independent, unofficial third-party community application and desktop CLI companion created by [@yaroslavvb](https://github.com/yaroslavvb). It is **not** built by, affiliated with, or officially endorsed by the Spacesheep team ([spacesheep.dev](https://spacesheep.dev)).

**SheepIt** uploads whatever you're looking at—any webpage in Chrome or Safari (with its stylesheets, images, KaTeX/MathJax math, Shadow DOM components, WebGL canvases, and streaming media) or any file on your device (images, PDFs, videos, audio, Markdown, CSV, JSON)—straight to your [Spacesheep](https://spacesheep.dev) in ~1 second.

- **Install & Status Guide (with demo video):** [`https://spacesheep.dev/@yaroslavvb/sheepit-app`](https://spacesheep.dev/@yaroslavvb/sheepit-app)
- **SheepIt Hub (Weekly Log, Pages & Builds):** [`https://spacesheep.dev/@yaroslavvb/sheepit-hub`](https://spacesheep.dev/@yaroslavvb/sheepit-hub)
- **SheepIt Quality Control (23-Site Audit):** [`https://spacesheep.dev/@yaroslavvb/sheepit-quality-control`](https://spacesheep.dev/@yaroslavvb/sheepit-quality-control)
- **Android app & Google Play bundle (`com.yaroslavvb.sheepit`):** `sheepit-v0.6.3.apk` / `sheepit-v0.6.3.aab` (version `0.6.3`, build `14`, API 37)
- **iPhone & iPad app + Share Extension (`com.yaroslavvb.sheepit`):** `ios/ShareToSpacesheep.xcodeproj` (`sheepit-v0.6.3.ipa` / `sheepit-ios-simulator-v0.6.3.zip`)
- **macOS Quick Action & Node CLI:** `bin/share-to-spacesheep.mjs` (`sheepit`)

---

## Download & Install

### Android (Phone / Tablet — Android 8.0+)

#### Way 1: Google Play Store Test
1. Ask [@yaroslavvb](https://github.com/yaroslavvb) to add your Google Play email to the tester list.
2. Open the [**Google Play Internal Test link**](https://play.google.com/apps/internaltest/4700926400133112995) on your phone, tap **Accept invite**, and install **SheepIt** directly from Google Play.

#### Way 2: Direct APK (`sheepit-v0.6.3.apk` — no invitation needed)
1. **Direct APK Download:** Download [`sheepit-v0.6.3.apk`](https://github.com/yaroslavvb/share-to-spacesheep/releases/download/v0.6.3/sheepit-v0.6.3.apk) from [**GitHub Releases**](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) and open it on your Android phone.
2. **Auto-updates via Obtainium:** Add `https://github.com/yaroslavvb/share-to-spacesheep` to [Obtainium](https://github.com/ImranR98/Obtainium) on Android for one-tap updates.
3. **Or install the `.aab` bundle from a computer with `bundletool`:**
   ```bash
   bundletool build-apks --bundle=play-store/sheepit-v0.6.3.aab --output=sheepit.apks --connected-device
   bundletool install-apks --apks=sheepit.apks
   ```
4. **First-time sign-in:** Open **SheepIt** once and tap **Sign in with Spacesheep** (or paste an `ss_…` API key from `spacesheep.dev/settings/api-keys`).
5. **Share from Chrome or Files:** Open any webpage in Chrome on Android and tap **⋮ → Share… → SheepIt**.

### iPhone & iPad (iOS / iPadOS 16+)
The iPhone/iPad app ([`ios/ShareToSpacesheep.xcodeproj`](ios/ShareToSpacesheep.xcodeproj)) includes both the standalone **SheepIt** app (`com.yaroslavvb.sheepit`) and a native **iOS/iPadOS Share Extension** (`com.yaroslavvb.sheepit.ShareExtension`) that shares credentials via App Group `group.com.yaroslavvb.sheepit` and appears as **SheepIt** directly in the Safari, Chrome, and Files share sheet.
1. **Install Directly from Xcode:** Open `ios/ShareToSpacesheep.xcodeproj` in Xcode, select your Apple team under **Signing & Capabilities** for both targets, pick your connected iPhone or iPad, and press **Run (⌘R)**.
2. **Or Install via Sideloadly / AltStore / SideStore:** Download [`sheepit-v0.6.3.ipa`](https://github.com/yaroslavvb/share-to-spacesheep/releases/download/v0.6.3/sheepit-v0.6.3.ipa) from [**GitHub Releases**](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) and install it onto your iPhone or iPad.
3. **Share from Safari or Chrome on iPhone/iPad:** Open any page in Safari or Chrome, tap the **Share** button, and tap **SheepIt** in the share sheet.

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
