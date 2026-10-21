# Share to spacesheep

An Android application (`dev.spacesheep.share`) and desktop companion CLI that share web pages (including from Chrome's **Share…** menu), images, PDFs, videos, Markdown/CSV/JSON/text files, and multi-file selections directly to [spacesheep.dev](https://spacesheep.dev).

Built on the capture, viewer, plan-checking, and MCP publishing modules from [`spacesheep-dev/spacesheep-extension`](https://github.com/spacesheep-dev/spacesheep-extension).

## How it works on Android

1. Open any webpage in **Chrome** on Android, tap **Share…**, and select **Share to spacesheep**.
2. **Share to spacesheep** receives Chrome's `ACTION_SEND` intent, renders and snapshots the page (or unwraps `<iframe id="content">` when sharing an existing `spacesheep.dev` space), downloads its stylesheets, images, fonts, and SVGs into `_assets/`, rewrites asset references locally, and publishes the space through `https://mcp.spacesheep.dev/mcp`.
3. Once published, the space link (`https://spacesheep.dev/@<handle>/<slug>`) is copied to the clipboard and can be opened in one tap. Sharing the same URL again updates the existing space in place (with an option to publish as a new page instead).
4. Sharing images, PDFs (rendered to WebP pages with extracted text via bundled `pdf.js`), videos, audio, Markdown, CSV, or multiple files from any Android app also builds a viewer space and publishes it.

## Build & Deploy to Phone

```bash
npm run build:android
npm run install:android
```

## Desktop CLI Companion

```bash
./bin/share-to-spacesheep.mjs https://spacesheep.dev/extension
```
