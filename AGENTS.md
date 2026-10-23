# AGENTS.md — SheepIt

SheepIt (`com.yaroslavvb.sheepit`) sends whatever you're looking at on a phone, a web page or a file, to
spacesheep.dev as a page. It is an unofficial app by Yaroslav Bulatov (@yaroslavvb), not by the spacesheep team.
This repo holds the Android app (`app/`), the iPhone and iPad app with its share extension (`ios/`), a Mac command
line (`bin/`) and the store kits (`play-store/`, `fastlane/`, `app-store/`). It lives at `~/git/share-to-spacesheep`
on Yaroslav's M5 MacBook, where its agents (Antigravity) work.

**This repo is public.** Nothing private goes into a commit: no keys, tokens or passwords (signing secrets come from
`~/.config/spacesheep/` or the environment), no testers' addresses, nothing from the spacesheep team's private code.

## Start here

1. This file.
2. `README.md`: features and install. It is stale (it still says `dev.spacesheep.share` and 0.6.0); bring it up to
   date with the next release.
3. `scripts/release-playstore.sh`: a Google Play release in one command (`--check-only` tests access,
   `--track production` later).
4. `app-store/APP_STORE_SUBMISSION.md` and `ios/build-appstore.sh`: the App Store.

## Keep the SheepIt Hub and the SheepIt app page current

Two living pages on spacesheep.dev, kept by the M5's agents (Yaroslav's ask, Fri 23 Oct 2026: *"instruct agents to
update this hub (managed by M5)"*):

| Page | Link | Source (gyroscope, synced by Dropbox) | Space |
|---|---|---|---|
| SheepIt Hub: everything about the app, a Log by week | https://spacesheep.dev/@yaroslavvb/sheepit-hub | `~/git0/gyroscope/reports/sheepit-hub.md` | `b4e179cc-105d-490b-a4f2-7ec8d22ad9f3` |
| SheepIt app: status and how to install, for testers | https://spacesheep.dev/@yaroslavvb/sheepit-app | `~/git0/gyroscope/reports/sheepit-app.md` | `16e782ec-c7b9-43bf-b316-f8fd87a86075` |

**The rule.** Every change that ships adds one entry at the top of this week's Log in the hub, in the same session:
a release, a Play or App Store upload, a new or changed page, a fix people will notice, a PR to the spacesheep team.
A release also updates the app page: the versions in its Status table, the APK named under *Way 2*, and the
TestFlight link once there is one. The hub's other tabs (Status, Pages, Builds, iPhone) change when their facts do.

**A Log entry** goes under its week's heading, `### Week WW · D–D Mon YYYY` (the ISO week; a new week gets its
heading at the top of the Log), newest entry first:

    - **Fri 23 Oct, 09:16 · Release** **[What was added](link)** (public): one sentence on what it gives him.

Kind is one word (App, Release, Fix, Page, Tool, Build, Speed). The pages speak to Yaroslav as "you". Say who can open
each linked page: (public), (signed-in: why), (private: why). Times are Pacific.

**Refresh, from the M5:**

1. Edit the `.md`, then put the Log in order:
   `~/git0/flush-util/hub_log_by_week ~/git0/gyroscope/reports/sheepit-hub.md --reorder --write`.
2. Render: `~/git0/flush-util/md2report ~/git0/gyroscope/reports/sheepit-hub.md --eyebrow "SheepIt Hub"` must exit 0
   with no ⚠️; the app page is `~/git0/flush-util/md2report ~/git0/gyroscope/reports/sheepit-app.md --eyebrow "SheepIt"`.
3. Make the spacesheep copy:
   `~/git0/flush-util/sheep_copy ~/git0/gyroscope/reports/sheepit-hub.md --out ~/drive.unsynced/artifacts/sheepit-hub --eyebrow "SheepIt Hub"`
   (the app page: `sheepit-app.md`, `--out ~/drive.unsynced/artifacts/sheepit-app --eyebrow "SheepIt"`).
4. Deploy onto the same space, never a new one:
   `spacesheep deploy ~/drive.unsynced/artifacts/sheepit-hub/sheepit-hub.html --space b4e179cc-105d-490b-a4f2-7ec8d22ad9f3 -m "<what changed>"`
   (the app page: `~/drive.unsynced/artifacts/sheepit-app/sheepit-app.html --space 16e782ec-c7b9-43bf-b316-f8fd87a86075`).
   Then delete the `.spacesheep.json` the CLI leaves in that folder.
5. `spacesheep list` must still show both pages as public. Append one line per deploy to
   `~/git0/gyroscope/dashboards/spacesheep-ledger.jsonl`:
   `{"path": "reports/sheepit-hub.html", "uuid": "…", "url": "…", "sha": "<the deploy's sha>", "visibility": "public", "deployed_at": "<ISO time>", "via": "M5"}`.
6. Commit from the Intel, the Mac that commits gyroscope, once Dropbox has carried the edit there (the `.md`'s
   `shasum` agrees on both Macs):
   `ssh intel 'cd ~/git0/gyroscope && git add reports/sheepit-hub.md reports/sheepit-hub.html reports/sheepit-app.md reports/sheepit-app.html && git commit -m "SheepIt Hub: <what changed>, <Ddd D Mon YYYY> (week WW)" && git push'`.

**Both pages are public (anyone with the link, unlisted).** Never put testers' addresses, keys, tokens, passwords,
money or the spacesheep team's private code on them; link a private page only with its reason beside the link.

## Changelog

- **2026-10-23 (Fri, week 43)** — Created: what the repo is, that it is public, where to start, and the rule that
  every change that ships updates the SheepIt Hub and the SheepIt app page on spacesheep.dev, with the Log entry's
  format and the refresh steps. *Why:* preference — Yaroslav's ask, Fri 23 Oct 2026: "Create a hub on Spacesheep
  called SheepIt Hub … Maybe update the directory to instruct agents to update this hub (managed by M5)."
