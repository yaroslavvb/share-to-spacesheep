# Google Play Store Listing Metadata

## App Details
- **App name (up to 30 chars):** `spacesheep` *(or `spacesheep (Unofficial)` if Play Review requests brand disambiguation)*
- **Application ID / Package name:** `dev.spacesheep.share`
- **Target SDK:** `35` (Android 15)
- **Min SDK:** `26` (Android 8.0)
- **Version Code:** `2` (`0.2.0`)
- **App Category:** Tools / Productivity
- **Privacy Policy URL:** `https://github.com/yaroslavvb/share-to-spacesheep/blob/main/PRIVACY.md`

## Short Description (79 / 80 characters)
```text
Share webpages (with all images & CSS) and files to spacesheep.dev from Chrome.
```

## Full Description (up to 4000 characters)
```text
Unofficial third-party community app for sharing webpages and files to spacesheep.dev. This application is independently developed by @yaroslavvb and is not built by, affiliated with, or officially endorsed by the Spacesheep team.

spacesheep registers directly in the Android Share sheet ("Share → spacesheep") so you can publish any webpage from Chrome or any file from your phone to your spacesheep.dev account in one tap:

• Full Webpage + Asset Bundling: Renders the shared webpage, promotes lazy-loaded images (loading="lazy", data-src, data-lazy-src, data-original, data-srcset), resolves relative paths, downloads same-origin images, stylesheets, fonts, SVGs, and CSS url(...) references into _assets/<sha256>.<ext>, rewrites index.html to relative ./_assets/… paths, and uploads via https://mcp.spacesheep.dev/mcp.
• Single & Multi-File Sharing: Share images, PDFs (rendered to WebP pages with extracted text via bundled pdf.js), videos, audio, Markdown, CSV, or multiple files from any Android app to create an interactive viewer space on spacesheep.dev.
• Privacy-First: No third-party analytics, ads, or tracking. Your spacesheep.dev API key is stored locally on your device and sent only to spacesheep.dev over HTTPS.

Open-source repository: https://github.com/yaroslavvb/share-to-spacesheep
```

## Release Artifacts
- **Signed Play Store App Bundle (`.aab`):** `app/build/outputs/bundle/release/app-release.aab`
- **Signed Release APK (`.apk`):** `app/build/outputs/apk/release/app-release.apk`
- **512×512 App Icon:** `play-store/icon-512.png`
- **1024×500 Feature Graphic:** `play-store/feature-graphic-1024x500.png`
- **Phone Screenshot:** `play-store/phone-screenshot-1.png`, `play-store/phone-screenshot-2.png`
- **Tablet Screenshot:** `play-store/tablet-screenshot-1.png`
