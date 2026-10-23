# SheepIt — Apple App Store Submission Guide (`v0.6.3`, Build `10`)

## 1. Key Identifiers & Configuration

| Field | Value |
| :--- | :--- |
| **App Name** | `SheepIt` |
| **Subtitle (30 chars max)** | `Share pages & files to Spacesheep` |
| **Main App Bundle ID** | `com.yaroslavvb.sheepit` |
| **Share Extension Bundle ID** | `com.yaroslavvb.sheepit.ShareExtension` |
| **App Group ID** | `group.com.yaroslavvb.sheepit` |
| **SKU** | `sheepit-ios-001` |
| **Version (`MARKETING_VERSION`)** | `0.6.3` |
| **Build (`CURRENT_PROJECT_VERSION`)** | `10` (auto-incremented from git commit count via `ios/build-appstore.sh`) |
| **Primary Category** | `Productivity` (Secondary: `Utilities`) |
| **Content Rights** | Does not contain, show, or access third-party content requiring rights |
| **Age Rating** | `4+` (No objectionable content; Unrestricted Web Access = No, since it only captures user-shared pages) |
| **Encryption (`ITSAppUsesNonExemptEncryption`)** | `false` (already declared in `ios/App/Info.plist` — skips export compliance prompts) |
| **Privacy Manifest (`PrivacyInfo.xcprivacy`)** | Bundled in both `ShareToSpacesheep` and `ShareExtension` (`CA92.1` UserDefaults) |
| **Privacy Policy URL** | `https://spacesheep.dev/@yaroslavvb/sheepit-privacy-policy` |
| **Support URL** | `https://github.com/yaroslavvb/share-to-spacesheep/issues` |

---

## 2. Step-by-Step: Upload the Build from Your Mac (Xcode or CLI)

### Option A: One-Click Upload via Xcode GUI (Easiest)
1. Open the project in Xcode:
   ```bash
   open /Users/yaroslavvb/git/share-to-spacesheep/ios/ShareToSpacesheep.xcodeproj
   ```
2. In the left sidebar, click **ShareToSpacesheep** (top-level project icon) → **Signing & Capabilities**:
   - Select target **ShareToSpacesheep** → set **Team** to your Apple Developer account.
   - Select target **ShareExtension** → set **Team** to your Apple Developer account.
   - *(Xcode will automatically register `com.yaroslavvb.sheepit`, `com.yaroslavvb.sheepit.ShareExtension`, and the `group.com.yaroslavvb.sheepit` App Group on your Apple Developer account.)*
3. In the top toolbar destination picker, select **Any iOS Device (arm64)**.
4. In the menu bar, click **Product → Archive**.
5. When the **Organizer** window opens:
   - Select the archive (`SheepIt 0.6.3 (10)`) and click **Distribute App**.
   - Choose **App Store Connect** → **Upload** → click **Next** / **Upload**.

### Option B: Command-Line Archive & Export (`ios/build-appstore.sh`)
If you know your 10-character Apple Developer Team ID (found at [developer.apple.com/account](https://developer.apple.com/account) under Membership Details):
```bash
cd /Users/yaroslavvb/git/share-to-spacesheep
DEVELOPMENT_TEAM=YOUR_TEAM_ID ./ios/build-appstore.sh
```
This automatically calculates a monotonically increasing `CFBundleVersion` from the git commit count, archives `SheepIt`, and exports a signed `.ipa` into `app-store/export/`.

---

## 3. Step-by-Step: Create & Submit the Listing in App Store Connect

1. Go to [App Store Connect → Apps](https://appstoreconnect.apple.com/apps) and click **+ → New App**:
   - **Platforms**: iOS
   - **Name**: `SheepIt`
   - **Primary Language**: English (U.S.)
   - **Bundle ID**: Select `com.yaroslavvb.sheepit`
   - **SKU**: `sheepit-ios-001`
   - **User Access**: Full Access

2. **Upload Screenshots** (ready in `/Users/yaroslavvb/git/share-to-spacesheep/app-store/screenshots/`):
   - **6.9" iPhone Display (`1320 × 2868` px, RGB no-alpha)**:
     - `app-store/screenshots/iphone-6.9-1-sheepit-launcher.png`
     - `app-store/screenshots/iphone-6.9-2-sheepit-done.png`
     - `app-store/screenshots/iphone-6.9-3-shared-space.png`
   - **13" iPad Display (`2064 × 2752` px, RGB no-alpha)**:
     - `app-store/screenshots/ipad-13-1-sheepit-launcher.png`
     - `app-store/screenshots/ipad-13-2-shared-space-aflow.png`
     - `app-store/screenshots/ipad-13-3-shared-space-thonking.png`

3. **Copy-Paste Listing Text** (also in `fastlane/metadata/ios/en-US/`):
   - **Promotional Text**:
     ```text
     Upload whatever you're looking at—webpages, PDFs, images, or notes—straight to your Spacesheep in ~1 second from Safari or Files.
     ```
   - **Keywords**:
     ```text
     spacesheep,share,publish,web clip,bookmark,read later,archive,markdown,pdf,notes
     ```
   - **Description**: Copy from `fastlane/metadata/ios/en-US/description.txt`
   - **Support URL**: `https://github.com/yaroslavvb/share-to-spacesheep/issues`
   - **Version / Copyright**: `2026 Yaroslav Bulatov`

4. **App Privacy (Data Collection Questionnaire)**:
   - Privacy Policy URL: `https://spacesheep.dev/@yaroslavvb/sheepit-privacy-policy`
   - Click **Get Started** on Data Types → Select **No, we do not collect data from this app** (all credentials stay in local device/App Group storage and uploads go directly to the user's own `spacesheep.dev` account).

5. **App Review Information**:
   - If providing a demo API key for the Apple Reviewer:
     - Check **Sign-in required**
     - In **Notes**:
       ```text
       SheepIt is an unofficial companion utility for spacesheep.dev that lets users share webpages (from Safari via the iOS Share Sheet) or local files into their Spacesheep account.
       To test without creating an account:
       1. Open SheepIt -> tap "Use API key" (or "API key" in the footer).
       2. Paste the test API key provided in the Password field and tap "Save key".
       3. Paste any URL (e.g. https://example.com) and tap "Publish to Spacesheep", or open Safari, tap Share -> SheepIt, and see the live Spacesheep link created in ~1 second.
       ```

6. Select your uploaded build under **Build**, click **Save**, and click **Add for Review / Submit to App Review**.
