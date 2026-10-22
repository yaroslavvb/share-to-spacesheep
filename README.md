# Share to Spacesheep (Unofficial)

> **Third-Party Disclaimer:** **Share to Spacesheep** is an independent, unofficial third-party community application and desktop CLI companion created by [@yaroslavvb](https://github.com/yaroslavvb). It is **not** built by, affiliated with, or officially endorsed by the Spacesheep team ([spacesheep.dev](https://spacesheep.dev)).

An Android share-target app (`dev.spacesheep.share`), iPhone/iPad app + Share Extension (`ios/ShareToSpacesheep.xcodeproj`), macOS Quick Action (`Share to spacesheep.workflow`), and Node CLI (`bin/share-to-spacesheep.mjs`) that let you share any web page from Chrome or Safari (with all images, stylesheets, and CSS assets bundled) or local files (images, PDFs, videos, audio, Markdown, CSV, JSON) directly to [spacesheep.dev](https://spacesheep.dev).

Built on the open-source capture, viewer, plan-checking, and MCP publishing modules from [`spacesheep-dev/spacesheep-extension`](https://github.com/spacesheep-dev/spacesheep-extension).

---

## Download & Install

### Android (Phone / Tablet)
1. **Direct APK Download:** Download the latest [`share-to-spacesheep-v0.1.0.apk`](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) from [**GitHub Releases**](https://github.com/yaroslavvb/share-to-spacesheep/releases) and open it on your Android phone.
2. **Auto-updates via Obtainium:** Add `https://github.com/yaroslavvb/share-to-spacesheep` to [Obtainium](https://github.com/ImranR98/Obtainium) on Android to receive one-tap updates whenever a new release is tagged.
3. **First-time sign-in:** Open **Share to spacesheep** once to sign in with your `spacesheep.dev` account (or paste a `ss_…` API key from `spacesheep.dev/settings/api-keys`).
4. **Share from Chrome:** Open any webpage in Chrome on Android, tap **Share… → Share to spacesheep**.

### iPhone & iPad (iOS / iPadOS 16+)
The iPhone/iPad app ([`ios/ShareToSpacesheep.xcodeproj`](ios/ShareToSpacesheep.xcodeproj)) includes both the standalone **Share to spacesheep** app (`dev.spacesheep.share`) and a native **iOS/iPadOS Share Extension** (`dev.spacesheep.share.ShareExtension`) that appears directly in the Chrome, Safari, and Files share sheet.
1. **Install via Sideloadly / AltStore / SideStore / TrollStore:** Download [`share-to-spacesheep-v0.1.0.ipa`](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) from [**GitHub Releases**](https://github.com/yaroslavvb/share-to-spacesheep/releases) and install it onto your iPhone or iPad using [Sideloadly](https://sideloadly.io), [AltStore](https://altstore.io), or [SideStore](https://sidestore.io) (signs automatically with your free Apple ID).
2. **Or Install Directly from Xcode:** Open `ios/ShareToSpacesheep.xcodeproj` in Xcode, select your Apple ID team under **Signing & Capabilities**, pick your connected iPhone or iPad, and press **Run (⌘R)**.
3. **Share from Chrome or Safari on iPad/iPhone:** Open any page in Chrome or Safari, tap the **Share** button, and tap **Share to spacesheep** in the share sheet.

### macOS / Desktop (CLI & Chrome Service)
```bash
git clone https://github.com/yaroslavvb/share-to-spacesheep.git
cd share-to-spacesheep
npm run install:macos-service
```
- **From Chrome on macOS:** Use **Chrome → Services → Share to spacesheep** (or right-click any link → **Services → Share to spacesheep**).
- **From the terminal:**
  ```bash
  ./bin/share-to-spacesheep.mjs https://example.com
  ./bin/share-to-spacesheep.mjs ./saved-page.html --visibility signed_in
  ./bin/share-to-spacesheep.mjs ./page.html --space <existing-space-uuid>
  ```

---

## What It Captures

- **Full Webpage + Asset Bundling:** Renders the target page, promotes lazy-loaded images (`loading="lazy"`, `data-src`, `data-lazy-src`, `data-original`, `data-srcset`), resolves relative paths (including Chrome saved-archive folders with colons such as `page:name_files/…`), downloads all same-origin images, stylesheets, fonts, SVGs, and CSS `url(...)` references into `_assets/<sha256>.<ext>`, rewrites `index.html` to relative `./_assets/…` paths, and uploads via `https://mcp.spacesheep.dev/mcp` (using `stage_begin` automatically for multi-megabyte bundles).
- **Single & Multi-File Sharing:** Sharing images, PDFs (rendered to WebP pages with extracted text via bundled `pdf.js`), videos, audio, Markdown, CSV, or multiple files from any Android/iOS app or desktop folder builds an interactive viewer space and publishes it.

---

## How to Share & Distribute This App (App Store / Play Store Guide)

Because this is an **unofficial third-party client** for `spacesheep.dev`, there are three ways to distribute it depending on how wide an audience you want:

### 1. Direct Distribution (Live Now — Zero Review Wait)
- **Android APK:** Anyone can install [`share-to-spacesheep-v0.1.0.apk`](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) directly on Android or track `https://github.com/yaroslavvb/share-to-spacesheep` in [Obtainium](https://github.com/ImranR98/Obtainium).
- **iOS / iPadOS IPA:** Anyone can download [`share-to-spacesheep-v0.1.0.ipa`](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) and sideload it with [AltStore](https://altstore.io), [SideStore](https://sidestore.io), or [Sideloadly](https://sideloadly.io) using a free Apple ID, or build `ios/ShareToSpacesheep.xcodeproj` in Xcode.

### 2. Google Play Store (Android)
- **Google Play Internal Testing (Fastest for friends/teammates):**
  - Build a signed Android App Bundle (`.aab`) with `./gradlew bundleRelease`.
  - In Google Play Console, create an app and upload the `.aab` to **Testing → Internal testing**.
  - Google Play makes an install link available within **seconds** (no store review required) for up to 100 invited testers.
- **Google Play Production Listing:**
  - **Naming rule (Google Play Impersonation Policy):** Name the store listing **"Share for Spacesheep (Unofficial)"** (`for Spacesheep`, not `Spacesheep Share`) so it clearly indicates compatibility rather than official ownership.
  - **Store description disclaimer:** Include in the first paragraph: *"Unofficial third-party community app for sharing webpages and files to spacesheep.dev. Not affiliated with or endorsed by the Spacesheep team."*
  - **Application ID note:** Before first uploading to Google Play Console, if you want a personal namespace instead of `dev.spacesheep.share`, set `applicationId "com.yaroslavvb.sharetospacesheep"` in `app/build.gradle`.

### 3. Apple App Store & TestFlight (iPhone / iPad)
- **Included Native Xcode Project (`ios/ShareToSpacesheep.xcodeproj`):**
  - Targets both iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`, `IPHONEOS_DEPLOYMENT_TARGET = 16.0`).
  - Contains `ShareToSpacesheep.app` and `ShareExtension.appex` (`com.apple.share-services`), sharing [`ios/Shared/SpacesheepBridgeViewController.swift`](ios/Shared/SpacesheepBridgeViewController.swift) and the web assets in [`app/src/main/assets/`](app/src/main/assets/).
  - Uses an App Group (`group.dev.spacesheep.share`) with `UserDefaults` fallback so your `spacesheep.dev` API key / sign-in token is shared between the main app and the Share Extension.
- **TestFlight External Testing (Recommended for sharing with friends/teammates on iPad & iPhone):**
  - Open `ios/ShareToSpacesheep.xcodeproj` in Xcode, choose **Product → Archive**, and click **Distribute App → TestFlight & App Store**.
  - In App Store Connect under **TestFlight → External Groups**, create a group and click **Enable Public Link**. Up to 10,000 people can install the iPhone/iPad app from that link with one tap (no UDID registration needed).
- **App Store Review Guideline 5.2.2 / 4.1 (Third-Party Clients):**
  - Title the app **"Share for Spacesheep"** with subtitle **"Unofficial Web & File Clipper"**, and state in the App Store description and Review Notes that it is an independent open-source third-party companion using `spacesheep.dev`'s public user API key / OAuth flow.

---

## Building from Source

```bash
# Build debug APK (Android)
npm run build:android

# Install onto connected Android device
npm run install:android

# Build iOS / iPadOS Simulator app
npm run build:ios-sim

# Build unsigned Release .ipa for iOS / iPadOS
npm run build:ipa
```
