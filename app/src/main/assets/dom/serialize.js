(function() {
  try {
    var href = String(location.href || "");
    if (!href || href === "about:blank" || href.indexOf("chrome-error:") === 0 || href.indexOf("webkit-error:") === 0) {
      return JSON.stringify({ ok: false, error: "error_page" });
    }
    if (document.querySelector("#main-frame-error, .neterror")) {
      return JSON.stringify({ ok: false, error: "neterror" });
    }
    if (document.title === "Just a moment..." || document.querySelector("#challenge-running, #challenge-stage, #cf-challenge-running")) {
      return JSON.stringify({ ok: false, error: "cloudflare_challenge" });
    }
    var d = document.doctype;
    var dt = d ? "<!DOCTYPE " + d.name + (d.publicId ? ' PUBLIC "' + d.publicId + '"' : "") + (d.systemId ? ' "' + d.systemId + '"' : "") + ">" : "<!DOCTYPE html>";
    var root = document.documentElement.cloneNode(true);
    // Record computed hidden state even when no scrolling was needed. Raw SSR
    // inline styles alone cannot prove that an empty picture is intentionally hidden.
    var originalPictures = document.querySelectorAll("picture");
    var clonedPictures = root.querySelectorAll("picture");
    for (var hp = 0; hp < originalPictures.length; hp++) {
      if (originalPictures[hp].querySelector("img, source")) continue;
      for (var parent = originalPictures[hp]; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).display === "none") {
          clonedPictures[hp].setAttribute("data-sheepit-hidden-picture", "");
          clonedPictures[hp].style.setProperty("display", "none", "important");
          break;
        }
      }
    }
    if (window.__sheepitSnapshotScroll && document.body) {
      // Responsive SSR may leave alternate layouts as skeletons. Since the
      // saved copy has no scripts to hydrate another layout, keep the selected
      // display modes at every width. Dimensions and typography stay responsive.
      var clonedBody = root.querySelector("body");
      if (clonedBody) {
        var originalBodyNodes = document.body.querySelectorAll("*");
        var clonedBodyNodes = clonedBody.querySelectorAll("*");
        for (var bd = 0; bd < originalBodyNodes.length && bd < clonedBodyNodes.length; bd++) {
          if (clonedBodyNodes[bd].style) {
            var display = getComputedStyle(originalBodyNodes[bd]).display;
            clonedBodyNodes[bd].style.setProperty("display", display, "important");
          }
        }
      }
    }
    var origAll = document.querySelectorAll("*");
    var cloneAll = root.querySelectorAll("*");
    for (var shIdx = 0; shIdx < origAll.length && shIdx < cloneAll.length; shIdx++) {
      try {
        var oEl = origAll[shIdx], cEl = cloneAll[shIdx];
        if (oEl.tagName === cEl.tagName && oEl.shadowRoot && !cEl.querySelector("template[shadowrootmode]")) {
          var tpl = document.createElement("template");
          tpl.setAttribute("shadowrootmode", "open");
          var shCss = "";
          if (oEl.shadowRoot.adoptedStyleSheets && oEl.shadowRoot.adoptedStyleSheets.length > 0) {
            for (var sa = 0; sa < oEl.shadowRoot.adoptedStyleSheets.length; sa++) {
              try {
                var shSheet = oEl.shadowRoot.adoptedStyleSheets[sa];
                if (shSheet && shSheet.cssRules) {
                  var sRules = [];
                  for (var sr = 0; sr < shSheet.cssRules.length; sr++) sRules.push(shSheet.cssRules[sr].cssText);
                  if (sRules.length) shCss += "<style>" + sRules.join("\n") + "</style>";
                }
              } catch (e) {}
            }
          }
          tpl.innerHTML = shCss + oEl.shadowRoot.innerHTML;
          cEl.insertBefore(tpl, cEl.firstChild);
        }
      } catch (e) {}
    }
    var origCanvases = document.querySelectorAll("canvas");
    var cloneCanvases = root.querySelectorAll("canvas");
    for (var i = 0; i < origCanvases.length && i < cloneCanvases.length; i++) {
      try {
        var c = origCanvases[i];
        if (c.width > 0 && c.height > 0) {
          var dataUrl = c.toDataURL("image/png");
          if (dataUrl && dataUrl.length > 64) {
            var img = document.createElement("img");
            img.setAttribute("src", dataUrl);
            if (c.getAttribute("id")) img.setAttribute("id", c.getAttribute("id"));
            if (c.getAttribute("class")) img.setAttribute("class", c.getAttribute("class"));
            if (c.getAttribute("style")) img.setAttribute("style", c.getAttribute("style"));
            var cw = c.clientWidth || c.width, ch = c.clientHeight || c.height;
            if (cw > 0 && ch > 0) { img.setAttribute("width", String(cw)); img.setAttribute("height", String(ch)); }
            cloneCanvases[i].replaceWith(img);
          }
        }
      } catch (e) {}
    }
    var origStyles = document.querySelectorAll("style");
    var cloneStyles = root.querySelectorAll("style");
    for (var sIdx = 0; sIdx < origStyles.length && sIdx < cloneStyles.length; sIdx++) {
      try {
        var origS = origStyles[sIdx], cloneS = cloneStyles[sIdx];
        var rawCss = (origS.textContent || "").replace(/<!--[\s\S]*?-->/g, "");
        var sheetCss = "";
        if (origS.sheet && origS.sheet.cssRules) {
          var rules = [];
          for (var rIdx = 0; rIdx < origS.sheet.cssRules.length; rIdx++) {
            rules.push(origS.sheet.cssRules[rIdx].cssText);
          }
          sheetCss = rules.join("\n");
        }
        cloneS.textContent = (rawCss.trim().length === 0 && sheetCss.length > 0) ? sheetCss : (sheetCss.length > rawCss.length ? sheetCss : rawCss);
      } catch (e) {}
    }
    if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0) {
      var headEl = root.querySelector("head") || root;
      for (var aIdx = 0; aIdx < document.adoptedStyleSheets.length; aIdx++) {
        try {
          var aSheet = document.adoptedStyleSheets[aIdx];
          if (aSheet && aSheet.cssRules && aSheet.cssRules.length > 0) {
            var aRules = [];
            for (var ar = 0; ar < aSheet.cssRules.length; ar++) aRules.push(aSheet.cssRules[ar].cssText);
            var aStyle = document.createElement("style");
            aStyle.setAttribute("data-adopted-ss", String(aIdx));
            aStyle.textContent = aRules.join("\n");
            headEl.appendChild(aStyle);
          }
        } catch (e) {}
      }
    }
    var origImgs = document.querySelectorAll("img");
    var cloneImgs = root.querySelectorAll("img");
    for (var mIdx = 0; mIdx < origImgs.length && mIdx < cloneImgs.length; mIdx++) {
      try {
        var oImg = origImgs[mIdx], cImg = cloneImgs[mIdx];
        cImg.removeAttribute("loading");
        cImg.removeAttribute("decoding");
        var curSrc = cImg.getAttribute("src") || "";
        var lazySrc = cImg.getAttribute("data-src") || cImg.getAttribute("data-lazy-src") || cImg.getAttribute("data-original") || cImg.getAttribute("data-actualsrc") || "";
        if (lazySrc && (!curSrc || curSrc.indexOf("data:") === 0 || curSrc === "about:blank")) {
          cImg.setAttribute("src", lazySrc);
        } else if ((!curSrc || curSrc.indexOf("data:") === 0) && oImg.currentSrc && /^https?:/i.test(oImg.currentSrc)) {
          cImg.setAttribute("src", oImg.currentSrc);
        }
        var lazySrcset = cImg.getAttribute("data-srcset") || cImg.getAttribute("data-lazy-srcset") || "";
        if (lazySrcset && !cImg.getAttribute("srcset")) {
          cImg.setAttribute("srcset", lazySrcset);
        }
        if (cImg.style && cImg.style.opacity === "0") cImg.style.opacity = "";
      } catch (e) {}
    }
    var cloneSources = root.querySelectorAll("source[data-srcset], source[data-lazy-srcset]");
    for (var csIdx = 0; csIdx < cloneSources.length; csIdx++) {
      var cs = cloneSources[csIdx];
      var lss = cs.getAttribute("data-srcset") || cs.getAttribute("data-lazy-srcset") || "";
      if (lss && !cs.getAttribute("srcset")) cs.setAttribute("srcset", lss);
    }
    var overlays = root.querySelectorAll('.osano-cm-window, #onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, .qc-cmp2-container, .fc-consent-root, #truste-consent-track, #didomi-host, #usercentrics-root, .cky-consent-container, .cc-window, .cc-revoke, #cookie-law-info-bar, #cookie-notice, #iubenda-cs-banner, [id^="sp_message_container"], .cmplz-cookiebanner-container, #BorlabsCookieBox, #gdpr-cookie-message, .mw-notification-area, .postedit-container, [role="dialog"][aria-label*="Subscribe" i], [class*="subscribeDialog"], noscript');
    for (var oIdx = 0; oIdx < overlays.length; oIdx++) overlays[oIdx].remove();
    var bodyEl = root.querySelector("body");
    if (bodyEl && bodyEl.style && bodyEl.style.overflow === "hidden") bodyEl.style.overflow = "";
    if (root.style && root.style.overflow === "hidden") root.style.overflow = "";
    var scripts = root.querySelectorAll("script");
    for (var j = 0; j < scripts.length; j++) {
      var s = scripts[j];
      var t = (s.getAttribute("type") || "").trim().toLowerCase();
      if (!t || t === "module" || /(java|ecma)script/.test(t)) s.remove();
    }
    var links = root.querySelectorAll('link[rel~="modulepreload" i], link[rel~="preload" i][as="script" i]');
    for (var k = 0; k < links.length; k++) links[k].remove();
    return JSON.stringify({ ok: true, html: dt + "\n" + root.outerHTML, title: document.title || "", finalUrl: href });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err) });
  }
})()
