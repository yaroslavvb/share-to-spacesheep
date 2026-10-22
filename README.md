# SheepIt (Unofficial Share App for Android, iPhone/iPad & macOS)

> **Third-Party Disclaimer:** **SheepIt** (`dev.spacesheep.share`) is an independent, unofficial third-party community application and desktop CLI companion created by [@yaroslavvb](https://github.com/yaroslavvb). It is **not** built by, affiliated with, or officially endorsed by the Spacesheep team ([spacesheep.dev](https://spacesheep.dev)).

**SheepIt** uploads whatever you're looking at—any webpage in Chrome or Safari (with its stylesheets, images, KaTeX/MathJax math, and streaming media) or any file on your device (images, PDFs, videos, audio, Markdown, CSV, JSON)—straight to your [Spacesheep](https://spacesheep.dev) in ~1 second.

- **Android app & Google Play bundle:** `dev.spacesheep.share` (`sheepit-v0.6.0.apk` / `sheepit-v0.6.0.aab`)
- **iPhone & iPad app + Share Extension:** `ios/ShareToSpacesheep.xcodeproj` (`sheepit-v0.6.0.ipa` / `sheepit-ios-simulator-v0.6.0.zip`)
- **macOS Quick Action & Node CLI:** `bin/share-to-spacesheep.mjs` (`sheepit`)

---

## Download & Install

### Android (Phone / Tablet)
1. **Direct APK Download:** Download [`sheepit-v0.6.0.apk`](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) from [**GitHub Releases**](https://github.com/yaroslavvb/share-to-spacesheep/releases) and open it on your Android phone.
2. **Auto-updates via Obtainium:** Add `https://github.com/yaroslavvb/share-to-spacesheep` to [Obtainium](https://github.com/ImranR98/Obtainium) on Android for one-tap updates.
3. **First-time sign-in:** Open **SheepIt** once to sign in with your `spacesheep.dev` account (or paste a `ss_…` API key from `spacesheep.dev/settings/api-keys`).
4. **Share from Chrome:** Open any webpage in Chrome on Android and tap **Share… → SheepIt**.

### iPhone & iPad (iOS / iPadOS 16+)
The iPhone/iPad app ([`ios/ShareToSpacesheep.xcodeproj`](ios/ShareToSpacesheep.xcodeproj)) includes both the standalone **SheepIt** app (`dev.spacesheep.share.ios`) and a native **iOS/iPadOS Share Extension** (`dev.spacesheep.share.ios.ShareExtension`) that appears as **SheepIt** directly in the Chrome, Safari, and Files share sheet.
1. **Install via Sideloadly / AltStore / SideStore / TrollStore:** Download [`sheepit-v0.6.0.ipa`](https://github.com/yaroslavvb/share-to-spacesheep/releases/latest) from [**GitHub Releases**](https://github.com/yaroslavvb/share-to-spacesheep/releases) and install it onto your iPhone or iPad.
2. **Or Install Directly from Xcode:** Open `ios/ShareToSpacesheep.xcodeproj` in Xcode, select your Apple ID team under **Signing & Capabilities**, pick your connected iPhone or iPad, and press **Run (⌘R)**.
3. **Share from Chrome or Safari on iPad/iPhone:** Open any page in Chrome or Safari, tap the **Share** button, and tap **SheepIt** in the share sheet.

---

## Google Play Store Submission Package (`play-store/` & `fastlane/`)

All assets and metadata required to submit **SheepIt** to the Google Play Store are ready in [`play-store/`](play-store/) and [`fastlane/metadata/android/en-US/`](fastlane/metadata/android/en-US/):

- **Signed Release Android App Bundle (`.aab`):** `play-store/sheepit-v0.6.0.aab` (also published on [GitHub Releases](https://github.com/yaroslavvb/share-to-spacesheep/releases/tag/v0.6.0))
- **App Name:** `SheepIt`
- **Short Description (80 chars):** `Upload whatever you're looking at—webpages or files—straight to your Spacesheep.`
- **Full Description:** [`fastlane/metadata/android/en-US/full_description.txt`](fastlane/metadata/android/en-US/full_description.txt)
- **512×512 High-Res Icon:** [`play-store/icon-512x512.png`](play-store/icon-512x512.png)
- **1024×500 Feature Graphic:** [`play-store/feature-graphic-1024x500.png`](play-store/feature-graphic-1024x500.png)
- **Phone & Tablet Screenshots:** [`play-store/screenshots/`](play-store/screenshots/)
- **Live Privacy Policy URL:** [`https://spacesheep.dev/@yaroslavvb/sheepit-privacy-policy`](https://spacesheep.dev/@yaroslavvb/sheepit-privacy-policy)
- **Permissions Required:** `android.permission.INTERNET` only (zero restricted permissions or foreground service declarations required).
