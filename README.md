# Share to Spacesheep (Unofficial)

> **Third-Party Disclaimer:** **Share to Spacesheep** is an independent, unofficial third-party community application and desktop CLI companion created by [@yaroslavvb](https://github.com/yaroslavvb). It is **not** built by, affiliated with, or officially endorsed by the Spacesheep team ([spacesheep.dev](https://spacesheep.dev)).

An Android share-target app (`dev.spacesheep.share`), macOS Quick Action (`Share to spacesheep.workflow`), and Node CLI (`bin/share-to-spacesheep.mjs`) that let you share any web page from Chrome (with all images, stylesheets, and CSS assets bundled) or local files (images, PDFs, videos, audio, Markdown, CSV, JSON) directly to [spacesheep.dev](https://spacesheep.dev).

Built on the open-source capture, viewer, plan-checking, and MCP publishing modules from [`spacesheep-dev/spacesheep-extension`](https://github.com/spacesheep-dev/spacesheep-extension).

---

## Download & Install

### Android (Phone / Tablet)
1. **Direct APK Download:** Download the latest [`share-to-spacesheep-v0.1.0.apk`](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) from [**GitHub Releases**](https://github.com/yaroslavvb/share-to-spacesheep/releases) and open it on your Android phone.
2. **Auto-updates via Obtainium:** Add `https://github.com/yaroslavvb/share-to-spacesheep` to [Obtainium](https://github.com/ImranR98/Obtainium) on Android to receive one-tap updates whenever a new release is tagged.
3. **First-time sign-in:** Open **Share to spacesheep** once to sign in with your `spacesheep.dev` account (or paste a `ss_…` API key from `spacesheep.dev/settings/api-keys`).
4. **Share from Chrome:** Open any webpage in Chrome on Android, tap **Share… → Share to spacesheep**.

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
- **Single & Multi-File Sharing:** Sharing images, PDFs (rendered to WebP pages with extracted text via bundled `pdf.js`), videos, audio, Markdown, CSV, or multiple files from any Android app or desktop folder builds an interactive viewer space and publishes it.

---

## How to Share & Distribute This App (App Store / Play Store Guide)

Because this is an **unofficial third-party client** for `spacesheep.dev`, there are three ways to distribute it depending on how wide an audience you want:

### 1. Direct Distribution (Live Now — Zero Review Wait)
- **GitHub Releases APK:** Anyone can install [`share-to-spacesheep-v0.1.0.apk`](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) directly on Android or track `https://github.com/yaroslavvb/share-to-spacesheep` in [Obtainium](https://github.com/ImranR98/Obtainium).

### 2. Google Play Store (Android)
- **Google Play Internal Testing (Fastest for friends/teammates):**
  - Build a signed Android App Bundle (`.aab`) with `./gradlew bundleRelease`.
  - In Google Play Console, create an app and upload the `.aab` to **Testing → Internal testing**.
  - Google Play makes an install link available within **seconds** (no store review required) for up to 100 invited testers.
- **Google Play Production Listing:**
  - **Naming rule (Google Play Impersonation Policy):** Name the store listing **"Share for Spacesheep (Unofficial)"** (`for Spacesheep`, not `Spacesheep Share`) so it clearly indicates compatibility rather than official ownership.
  - **Store description disclaimer:** Include in the first paragraph: *"Unofficial third-party community app for sharing webpages and files to spacesheep.dev. Not affiliated with or endorsed by the Spacesheep team."*
  - **Application ID note:** Before first uploading to Google Play Console, if you want a personal namespace instead of `dev.spacesheep.share`, set `applicationId "com.yaroslavvb.sharetospacesheep"` in `app/build.gradle`.

### 3. Apple App Store & TestFlight (iOS / macOS)
- **Architecture on iOS / macOS:**
  - The core capture and MCP engine in [`app/src/main/assets/lib/`](app/src/main/assets/lib/) (`capture-refs.js`, `share-engine.js`, `mcp.js`, `viewers.js`) is pure ES module JavaScript with zero Android-specific dependencies.
  - On iOS, wrap `app/src/main/assets/` in a lightweight `WKWebView` app + **iOS Share Extension** (`NSExtensionPointIdentifier: com.apple.share-services` accepting `public.url`, `public.file-url`, `public.image`, and `com.apple.property-list` with `NSExtensionJavaScriptPreprocessingFile` to pass Safari's live DOM directly to the extension).
- **TestFlight External Testing:**
  - Upload via Xcode / `xcrun altool` to App Store Connect and enable a **Public TestFlight Link** (up to 10,000 testers after a quick beta review).
- **App Store Review Guideline 5.2.2 / 4.1 (Third-Party Clients):**
  - Title the app **"Share for Spacesheep"** with subtitle **"Unofficial Web & File Clipper"**, and state in the App Store description and Review Notes that it is an independent open-source third-party companion using `spacesheep.dev`'s public user API key / OAuth flow.

---

## Building from Source

```bash
# Build debug APK
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew assembleDebug

# Install onto connected Android device
npm run install:android
```
