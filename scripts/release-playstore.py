#!/usr/bin/env python3
"""
Automated Google Play Store Release Tool for SheepIt (com.yaroslavvb.sheepit).

Features:
- Zero external Python dependencies (uses stdlib + macOS/Linux `openssl` CLI to sign RS256 JWTs).
- Authenticates with ~/.config/spacesheep/play-store-service-account.json
  (sheepit-play-publisher@gen-lang-client-0341207673.iam.gserviceaccount.com).
- Checks existing version codes on Google Play via androidpublisher v3 API.
- Automatically bumps `versionCodeFloor` in app/build.gradle so every release
  has a strictly higher versionCode than anything already built or uploaded.
- Runs `./gradlew bundleRelease` to produce a signed API 37+ Android App Bundle (.aab).
- Uploads the .aab, assigns it to the target track (default: `internal`), attaches
  release notes, and commits the edit (with automatic fallback for `draft` status or
  `changesNotSentForReview=true` when required by Play Console).
"""

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PACKAGE_NAME = "com.yaroslavvb.sheepit"
INTERNAL_TEST_URL = "https://play.google.com/apps/internaltest/4700926400133112995"
PLAY_CONSOLE_USERS_URL = "https://play.google.com/console/u/0/developers/users-and-permissions"
DEFAULT_KEY_PATH = os.path.expanduser("~/.config/spacesheep/play-store-service-account.json")
SCOPE = "https://www.googleapis.com/auth/androidpublisher"
API_BASE = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE_NAME}"
UPLOAD_BASE = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE_NAME}"

REPO_ROOT = Path(__file__).resolve().parent.parent
BUILD_GRADLE = REPO_ROOT / "app" / "build.gradle"
AAB_PATH = REPO_ROOT / "play-store" / "sheepit-latest.aab"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def get_access_token(sa_path: str) -> str:
    if not os.path.isfile(sa_path):
        raise FileNotFoundError(
            f"Service account JSON key not found at: {sa_path}\n"
            "Set PLAY_STORE_JSON_KEY or place the key at ~/.config/spacesheep/play-store-service-account.json"
        )
    with open(sa_path, "r", encoding="utf-8") as f:
        sa = json.load(f)

    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    if sa.get("private_key_id"):
        header["kid"] = sa["private_key_id"]
    payload = {
        "iss": sa["client_email"],
        "scope": SCOPE,
        "aud": sa.get("token_uri", "https://oauth2.googleapis.com/token"),
        "iat": now - 30,
        "exp": now + 3600,
    }
    signing_input = (
        f"{b64url(json.dumps(header, separators=(',', ':')).encode())}."
        f"{b64url(json.dumps(payload, separators=(',', ':')).encode())}"
    )

    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as kf:
        kf.write(sa["private_key"])
        key_file = kf.name

    try:
        sig = subprocess.check_output(
            ["openssl", "dgst", "-sha256", "-sign", key_file],
            input=signing_input.encode("ascii"),
        )
    finally:
        try:
            os.remove(key_file)
        except OSError:
            pass

    assertion = f"{signing_input}.{b64url(sig)}"
    body = urllib.parse.urlencode(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        sa.get("token_uri", "https://oauth2.googleapis.com/token"),
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        token_data = json.loads(resp.read().decode("utf-8"))
    return token_data["access_token"]


def api_request(token: str, method: str, url: str, data=None, content_type="application/json", timeout=120):
    headers = {"Authorization": f"Bearer {token}"}
    body = None
    if data is not None:
        if isinstance(data, (bytes, bytearray)):
            body = data
            headers["Content-Type"] = content_type
        else:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} on {method} {url}:\n{err_body}") from e


def read_gradle_version_info() -> tuple[int, str]:
    text = BUILD_GRADLE.read_text(encoding="utf-8")
    floor_m = re.search(r"resolveMonotonicVersionCode\((\d+)\)", text)
    floor_val = int(floor_m.group(1)) if floor_m else 12
    vname_m = re.search(r'versionName\s*=\s*"([^"]+)"', text)
    vname = vname_m.group(1) if vname_m else "0.6.3"
    try:
        git_count = int(
            subprocess.check_output(["git", "rev-list", "--count", "HEAD"], cwd=REPO_ROOT, text=True).strip()
        )
        computed = max(floor_val, git_count - 11)
    except Exception:
        computed = floor_val
    return computed, vname


def bump_gradle_version_floor(new_floor: int, new_version_name: str = None):
    text = BUILD_GRADLE.read_text(encoding="utf-8")
    text = re.sub(
        r"(resolveMonotonicVersionCode\()\d+(\))",
        f"\\g<1>{new_floor}\\g<2>",
        text,
        count=1,
    )
    if new_version_name:
        text = re.sub(
            r'(versionName\s*=\s*")[^"]+(")',
            f'\\g<1>{new_version_name}\\g<2>',
            text,
            count=1,
        )
    BUILD_GRADLE.write_text(text, encoding="utf-8")


def build_aab(version_code: int, version_name: str) -> Path:
    print("🔨 Building signed release Android App Bundle & APK (./gradlew bundleRelease assembleRelease)...")
    subprocess.run(["./gradlew", "bundleRelease", "assembleRelease"], cwd=REPO_ROOT, check=True)
    if not AAB_PATH.is_file():
        raise FileNotFoundError(f"Expected signed bundle at {AAB_PATH}, but it was not found.")
    versioned_copy = REPO_ROOT / "play-store" / f"sheepit-v{version_name}-vc{version_code}.aab"
    shutil.copy2(AAB_PATH, versioned_copy)
    print(f"📦 Ready bundle: {versioned_copy} (and {AAB_PATH})")
    return versioned_copy


def print_permission_help(sa_email: str, built_aab: Path, vc: int, vname: str):
    print(
        "\n"
        "================================================================================\n"
        "🔑 ONE-TIME PLAY CONSOLE API LINK NEEDED (takes ~30 seconds)\n"
        "================================================================================\n"
        f"Your new bundle (v{vname}, versionCode {vc}) is ALREADY built and signed at:\n"
        f"  {built_aab}\n\n"
        "To let this script upload directly to Google Play without using the browser UI:\n\n"
        "  1. Open Google Play Console -> Users and permissions:\n"
        f"     {PLAY_CONSOLE_USERS_URL}\n\n"
        "  2. Click 'Invite new users' and paste this Service Account email:\n"
        f"     {sa_email}\n\n"
        "  3. Under 'App permissions', click 'Add app' -> select 'SheepIt (com.yaroslavvb.sheepit)'\n"
        "     -> check 'Releases' (Release to production / Release to testing tracks),\n"
        "     OR under 'Account permissions' check 'Admin (all permissions)',\n"
        "     then click 'Invite user' -> 'Send invite'.\n\n"
        "  4. From then on, every release is a single command:\n"
        "     ./scripts/release-playstore.sh\n"
        "================================================================================\n"
    )


def main():
    parser = argparse.ArgumentParser(description="Build and upload SheepIt to Google Play Store.")
    parser.add_argument(
        "--track",
        default="internal",
        choices=["internal", "alpha", "beta", "production"],
        help="Play Store track to publish to (default: internal)",
    )
    parser.add_argument(
        "--status",
        default="completed",
        choices=["completed", "draft", "inProgress", "halted"],
        help="Release status on the track (default: completed; automatically falls back to draft if app is in draft)",
    )
    parser.add_argument(
        "--notes",
        default="Faster 2-stage page sharing, improved MathJax/VitePress/Shadow DOM/WebGL rendering, and Android 17 (API 37) support.",
        help="What's new release notes (en-US)",
    )
    parser.add_argument(
        "--bump",
        action="store_true",
        help="Increment versionCode by +1 before building",
    )
    parser.add_argument(
        "--version-name",
        default=None,
        help="Optional new versionName (e.g., 0.6.4) to write to app/build.gradle",
    )
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="Skip running ./gradlew bundleRelease and upload the existing play-store/sheepit-latest.aab",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only verify Play Store API authentication and list current tracks/releases without uploading",
    )
    parser.add_argument(
        "--set-google-group",
        default=None,
        help="Set a Google Group (e.g. sheepit-testers@googlegroups.com) on the testing track so anyone who joins the group gets instant Play Store test access without manual email entry",
    )
    parser.add_argument(
        "--key",
        default=os.environ.get("PLAY_STORE_JSON_KEY", DEFAULT_KEY_PATH),
        help=f"Path to Google Play Service Account JSON key (default: {DEFAULT_KEY_PATH})",
    )
    args = parser.parse_args()

    local_vc, local_vname = read_gradle_version_info()
    if args.bump or args.version_name:
        next_vc = local_vc + 1 if args.bump else local_vc
        vname_to_set = args.version_name or local_vname
        print(f"🔼 Updating app/build.gradle: versionCode {local_vc} -> {next_vc} (versionName {vname_to_set})")
        bump_gradle_version_floor(next_vc, args.version_name)
        local_vc, local_vname = read_gradle_version_info()

    built_aab = AAB_PATH
    if not args.check_only and not args.no_build and not (args.set_google_group and not args.bump):
        built_aab = build_aab(local_vc, local_vname)

    with open(args.key, "r", encoding="utf-8") as f:
        sa_email = json.load(f).get("client_email", "unknown")

    print(f"🔐 Authenticating with Google Play API as {sa_email}...")
    token = get_access_token(args.key)

    print(f"📡 Opening edit session for {PACKAGE_NAME} on Google Play...")
    try:
        edit = api_request(token, "POST", f"{API_BASE}/edits", data={})
    except RuntimeError as e:
        msg = str(e)
        if "HTTP 403" in msg or "PERMISSION_DENIED" in msg or "401" in msg:
            print_permission_help(sa_email, built_aab, local_vc, local_vname)
            sys.exit(2)
        raise

    edit_id = edit["id"]
    print(f"✅ Created edit session: {edit_id}")

    existing_bundles_resp = api_request(token, "GET", f"{API_BASE}/edits/{edit_id}/bundles")
    existing_bundles = existing_bundles_resp.get("bundles", [])
    max_remote_vc = max([int(b["versionCode"]) for b in existing_bundles], default=0)

    tracks_resp = api_request(token, "GET", f"{API_BASE}/edits/{edit_id}/tracks")
    print(f"📊 Highest versionCode currently in Play Library: {max_remote_vc or 'none'}")
    for tr in tracks_resp.get("tracks", []):
        tname = tr.get("track")
        rels = tr.get("releases", [])
        if rels:
            vcs = [vc for r in rels for vc in r.get("versionCodes", [])]
            statuses = [r.get("status") for r in rels]
            testers_info = ""
            if tname in ("internal", "alpha", "beta"):
                try:
                    t_resp = api_request(token, "GET", f"{API_BASE}/edits/{edit_id}/testers/{tname}")
                    groups = t_resp.get("googleGroups", [])
                    if groups:
                        testers_info = f" googleGroups={groups}"
                except Exception:
                    pass
            print(f"   • Track '{tname}': versionCodes={vcs} status={statuses}{testers_info}")

    if args.set_google_group and not args.bump:
        grp = args.set_google_group.strip()
        print(f"👥 Setting Google Group '{grp}' on track '{args.track}'...")
        api_request(
            token,
            "PUT",
            f"{API_BASE}/edits/{edit_id}/testers/{args.track}",
            data={"googleGroups": [grp]},
        )
        try:
            api_request(token, "POST", f"{API_BASE}/edits/{edit_id}:commit")
        except RuntimeError:
            api_request(token, "POST", f"{API_BASE}/edits/{edit_id}:commit?changesNotSentForReview=true")
        print(f"✅ Linked Google Group '{grp}' to track '{args.track}'! Anyone who joins that group can install from {INTERNAL_TEST_URL}")
        return

    if args.check_only:
        api_request(token, "DELETE", f"{API_BASE}/edits/{edit_id}")
        print("✅ Play Store API connection verified (--check-only).")
        return

    if max_remote_vc >= local_vc:
        target_vc = max_remote_vc + 1
        print(f"🔼 Play Store already has versionCode {max_remote_vc}; bumping local versionCode -> {target_vc} and rebuilding...")
        bump_gradle_version_floor(target_vc, args.version_name)
        local_vc, local_vname = read_gradle_version_info()
        built_aab = build_aab(local_vc, local_vname)

    aab_bytes = AAB_PATH.read_bytes()
    print(f"📦 Uploading {built_aab.name} ({len(aab_bytes) / 1024:.1f} KB, versionCode {local_vc})...")
    upload_url = f"{UPLOAD_BASE}/edits/{edit_id}/bundles?uploadType=media"
    bundle_res = api_request(
        token,
        "POST",
        upload_url,
        data=aab_bytes,
        content_type="application/octet-stream",
        timeout=300,
    )
    uploaded_vc = int(bundle_res["versionCode"])
    print(f"✅ Uploaded bundle: versionCode={uploaded_vc}, sha256={bundle_res.get('sha256', '')[:16]}...")

    release_name = f"{uploaded_vc} ({local_vname})"
    release_notes = [{"language": "en-US", "text": args.notes[:500]}] if args.notes else []

    def update_track(status_to_use: str):
        track_body = {
            "track": args.track,
            "releases": [
                {
                    "name": release_name,
                    "versionCodes": [str(uploaded_vc)],
                    "status": status_to_use,
                    "releaseNotes": release_notes,
                }
            ],
        }
        return api_request(
            token,
            "PUT",
            f"{API_BASE}/edits/{edit_id}/tracks/{args.track}",
            data=track_body,
        )

    print(f"🛤️  Assigning versionCode {uploaded_vc} to track '{args.track}' (status='{args.status}')...")
    try:
        update_track(args.status)
    except RuntimeError as e:
        if args.status != "draft" and ("draft" in str(e).lower() or "HTTP 400" in str(e)):
            print("⚠️  App is still in draft state on Play Console; retrying track assignment with status='draft'...")
            update_track("draft")
        else:
            raise

    print("🚀 Committing edit on Google Play...")
    try:
        api_request(token, "POST", f"{API_BASE}/edits/{edit_id}:commit")
    except RuntimeError as e:
        if "changesNotSentForReview" in str(e) or "HTTP 400" in str(e):
            print("ℹ️  Retrying commit with changesNotSentForReview=true...")
            api_request(
                token,
                "POST",
                f"{API_BASE}/edits/{edit_id}:commit?changesNotSentForReview=true",
            )
        else:
            raise

    print(
        f"\n🎉 SUCCESS! SheepIt v{local_vname} (versionCode {uploaded_vc}) is now published to the '{args.track}' track!\n"
        f"🔗 Internal testing link: {INTERNAL_TEST_URL}"
    )


if __name__ == "__main__":
    main()
