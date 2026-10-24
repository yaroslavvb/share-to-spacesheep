import UIKit
import WebKit
import UniformTypeIdentifiers
import AuthenticationServices

@objc public class SpacesheepBridgeViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, UIDocumentPickerDelegate, ASWebAuthenticationPresentationContextProviding {

    public var isShareExtension: Bool = false
    var mainWebView: WKWebView!
    var captureWebView: WKWebView?
    var sharedPayloadJson: String = "{\"mode\":\"launcher\"}"
    var pendingSnapshotId: Int = 0
    var captureTimeoutWorkItem: DispatchWorkItem?
    var nextOAuthId: Int = 1
    var activeOAuthId: Int = 0
    var authSession: ASWebAuthenticationSession?
    var isBackgroundSyncing: Bool = false
    var pendingDismissExtension: Bool = false
    var bgTaskId: UIBackgroundTaskIdentifier = .invalid

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.96, green: 0.96, blue: 0.95, alpha: 1.0)

        seedDefaultKeyIfNeeded()

        let config = WKWebViewConfiguration()
        config.preferences.javaScriptEnabled = true
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")

        let bridgeJs = """
        window.AndroidBridge = {
          _call: function(method, args) {
            return window.prompt("__ss_bridge__:" + JSON.stringify({ method: method, args: args || [] })) || "";
          },
          getInitialPayload: function() { return this._call("getInitialPayload", []); },
          storageGetAll: function() { return this._call("storageGetAll", []); },
          storageSet: function(patchJson) { return this._call("storageSet", [String(patchJson || "{}")]); },
          storageRemove: function(keysJson) { return this._call("storageRemove", [String(keysJson || "[]")]); },
          httpRequestAsync: function(id, url, method, headersJson, body, isBase64Body) {
            return this._call("httpRequestAsync", [Number(id), String(url), String(method || "GET"), String(headersJson || "{}"), String(body || ""), Boolean(isBase64Body)]);
          },
          fetchBinaryAsync: function(id, url, maxBytes) {
            return this._call("fetchBinaryAsync", [Number(id), String(url), Number(maxBytes || 26214400)]);
          },
          renderPageSnapshot: function(id, url, timeoutMs) {
            return this._call("renderPageSnapshot", [Number(id), String(url), Number(timeoutMs || 5500)]);
          },
          fetchSnapshotAsset: function(id, url, maxBytes) {
            return this._call("fetchSnapshotAsset", [Number(id), String(url), Number(maxBytes || 26214400)]);
          },
          resetPageSnapshot: function() {
            return this._call("resetPageSnapshot", []);
          },
          prepareOAuthLoopback: function() {
            return this._call("prepareOAuthLoopback", []);
          },
          launchOAuthLoopback: function(id, authorizeUrl) {
            return this._call("launchOAuthLoopback", [Number(id), String(authorizeUrl || "")]);
          },
          pickFiles: function() { return this._call("pickFiles", []); },
          copyToClipboard: function(t) { return this._call("copyToClipboard", [String(t || "")]); },
          openExternalUrl: function(u) { return this._call("openExternalUrl", [String(u || "")]); },
          reportStatus: function(j) { return this._call("reportStatus", [String(j || "{}")]); }
        };
        """
        let userScript = WKUserScript(source: bridgeJs, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(userScript)

        mainWebView = WKWebView(frame: .zero, configuration: config)
        mainWebView.translatesAutoresizingMaskIntoConstraints = false
        mainWebView.uiDelegate = self
        mainWebView.navigationDelegate = self
        mainWebView.isOpaque = true
        mainWebView.backgroundColor = UIColor(red: 0.96, green: 0.96, blue: 0.95, alpha: 1.0)
        mainWebView.scrollView.backgroundColor = UIColor(red: 0.96, green: 0.96, blue: 0.95, alpha: 1.0)
        if #available(iOS 16.4, *) {
            mainWebView.isInspectable = true
        }

        if isShareExtension {
            let navBar = UINavigationBar()
            navBar.translatesAutoresizingMaskIntoConstraints = false
            let navItem = UINavigationItem(title: "SheepIt")
            navItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(dismissExtension))
            navBar.items = [navItem]
            view.addSubview(navBar)
            view.addSubview(mainWebView)

            NSLayoutConstraint.activate([
                navBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                navBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                navBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                mainWebView.topAnchor.constraint(equalTo: navBar.bottomAnchor),
                mainWebView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                mainWebView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                mainWebView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
            ])
        } else {
            view.addSubview(mainWebView)
            NSLayoutConstraint.activate([
                mainWebView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                mainWebView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                mainWebView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                mainWebView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
            ])
        }

        if isShareExtension, let extContext = self.extensionContext {
            extractShareExtensionItems(from: extContext) { [weak self] payload in
                DispatchQueue.main.async {
                    self?.sharedPayloadJson = payload
                    self?.loadAppIndex()
                }
            }
        } else {
            checkProcessArgumentsForIntent()
            loadAppIndex()
        }
    }

    @objc private func dismissExtension() {
        if isBackgroundSyncing && !pendingDismissExtension {
            pendingDismissExtension = true
            UIView.animate(withDuration: 0.2) {
                self.view.alpha = 0.0
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) { [weak self] in
                guard let self = self, self.pendingDismissExtension else { return }
                self.pendingDismissExtension = false
                self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            }
            return
        }
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return self.view.window ?? ASPresentationAnchor()
    }

    public func handleIncomingUrl(_ url: URL) {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              comps.scheme == "spacesheepshare" else { return }
        if comps.host == "oauth" || comps.path.contains("callback") || comps.queryItems?.contains(where: { $0.name == "code" || $0.name == "error" }) == true {
            if activeOAuthId != 0, mainWebView != nil {
                let cbId = activeOAuthId
                activeOAuthId = 0
                authSession?.cancel()
                authSession = nil
                let outJson = Self.jsonString(["id": cbId, "url": url.absoluteString])
                mainWebView.evaluateJavaScript("window.__onOAuthCallback && window.__onOAuthCallback(\(outJson));", completionHandler: nil)
            }
            return
        }
        let targetUrl = comps.queryItems?.first(where: { $0.name == "url" })?.value ?? ""
        let title = comps.queryItems?.first(where: { $0.name == "title" })?.value ?? ""
        let spaceUuid = comps.queryItems?.first(where: { $0.name == "space_uuid" })?.value ?? ""
        let visibility = comps.queryItems?.first(where: { $0.name == "visibility" })?.value ?? ""
        if !targetUrl.isEmpty {
            var dict: [String: Any] = [
                "mode": "url",
                "url": targetUrl,
                "title": title,
                "autoPublish": true
            ]
            if !spaceUuid.isEmpty { dict["spaceUuid"] = spaceUuid }
            if !visibility.isEmpty { dict["visibility"] = visibility }
            let str = Self.jsonString(dict)
            sharedPayloadJson = str
            if mainWebView != nil {
                mainWebView.evaluateJavaScript("window.__handleIncomingShare && window.__handleIncomingShare(\(str));", completionHandler: nil)
            }
        }
    }

    private func checkProcessArgumentsForIntent() {
        let args = ProcessInfo.processInfo.arguments
        if let idx = args.firstIndex(of: "--share-url"), idx + 1 < args.count {
            var dict: [String: Any] = [
                "mode": "url",
                "url": args[idx + 1],
                "title": "",
                "autoPublish": true
            ]
            if let sIdx = args.firstIndex(of: "--space-uuid"), sIdx + 1 < args.count {
                dict["spaceUuid"] = args[sIdx + 1]
            }
            if let vIdx = args.firstIndex(of: "--visibility"), vIdx + 1 < args.count {
                dict["visibility"] = args[vIdx + 1]
            }
            sharedPayloadJson = Self.jsonString(dict)
        }
    }

    private func loadAppIndex() {
        if let indexUrl = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebAssets") {
            mainWebView.loadFileURL(indexUrl, allowingReadAccessTo: indexUrl.deletingLastPathComponent())
        } else if let indexUrl = Bundle.main.url(forResource: "index", withExtension: "html") {
            mainWebView.loadFileURL(indexUrl, allowingReadAccessTo: indexUrl.deletingLastPathComponent())
        }
    }

    // MARK: - WKUIDelegate Bridge via prompt()

    public func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard prompt.hasPrefix("__ss_bridge__:") else {
            completionHandler(nil)
            return
        }
        let jsonPart = String(prompt.dropFirst("__ss_bridge__:".count))
        guard let data = jsonPart.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let method = obj["method"] as? String else {
            completionHandler("")
            return
        }
        let args = (obj["args"] as? [Any]) ?? []

        switch method {
        case "getInitialPayload":
            let current = sharedPayloadJson
            sharedPayloadJson = "{\"mode\":\"launcher\"}"
            completionHandler(current)

        case "storageGetAll":
            completionHandler(Self.jsonString(loadStorageDict()))

        case "storageSet":
            let patchStr = args.first as? String ?? "{}"
            var dict = loadStorageDict()
            if let pData = patchStr.data(using: .utf8),
               let patch = try? JSONSerialization.jsonObject(with: pData) as? [String: Any] {
                for (k, v) in patch { dict[k] = v }
                saveStorageDict(dict)
            }
            completionHandler("")

        case "storageRemove":
            let keysStr = args.first as? String ?? "[]"
            var dict = loadStorageDict()
            if let kData = keysStr.data(using: .utf8),
               let keys = try? JSONSerialization.jsonObject(with: kData) as? [String] {
                for k in keys { dict.removeValue(forKey: k) }
                saveStorageDict(dict)
            }
            completionHandler("")

        case "httpRequestAsync":
            let reqId = args.count > 0 ? ((args[0] as? NSNumber)?.intValue ?? 0) : 0
            let urlStr = args.count > 1 ? (args[1] as? String ?? "") : ""
            let httpMethod = args.count > 2 ? (args[2] as? String ?? "GET") : "GET"
            let headersStr = args.count > 3 ? (args[3] as? String ?? "{}") : "{}"
            let bodyStr = args.count > 4 ? (args[4] as? String ?? "") : ""
            let isBase64 = args.count > 5 ? ((args[5] as? Bool) ?? false) : false
            completionHandler("")
            performHttpRequestAsync(reqId: reqId, urlStr: urlStr, method: httpMethod, headersStr: headersStr, bodyStr: bodyStr, isBase64: isBase64)

        case "fetchBinaryAsync":
            let binId = args.count > 0 ? ((args[0] as? NSNumber)?.intValue ?? 0) : 0
            let urlStr = args.count > 1 ? (args[1] as? String ?? "") : ""
            let maxBytes = args.count > 2 ? ((args[2] as? NSNumber)?.intValue ?? 26214400) : 26214400
            completionHandler("")
            performFetchBinaryAsync(binId: binId, urlStr: urlStr, maxBytes: maxBytes)

        case "renderPageSnapshot":
            let snapId = args.count > 0 ? ((args[0] as? NSNumber)?.intValue ?? 0) : 0
            let urlStr = args.count > 1 ? (args[1] as? String ?? "") : ""
            let timeoutMs = args.count > 2 ? ((args[2] as? NSNumber)?.intValue ?? 5500) : 5500
            completionHandler("")
            performRenderPageSnapshot(snapId: snapId, urlStr: urlStr, timeoutMs: timeoutMs)

        case "fetchSnapshotAsset":
            let assetId = args.count > 0 ? ((args[0] as? NSNumber)?.intValue ?? 0) : 0
            let urlStr = args.count > 1 ? (args[1] as? String ?? "") : ""
            let maxBytes = args.count > 2 ? ((args[2] as? NSNumber)?.intValue ?? 26214400) : 26214400
            completionHandler("")
            performFetchSnapshotAsset(assetId: assetId, urlStr: urlStr, maxBytes: maxBytes)

        case "resetPageSnapshot":
            completionHandler("")
            performResetSnapshotWebView()

        case "prepareOAuthLoopback":
            let oauthId = nextOAuthId
            nextOAuthId += 1
            activeOAuthId = oauthId
            completionHandler(Self.jsonString(["id": oauthId, "redirectUri": "spacesheepshare://oauth/callback"]))

        case "launchOAuthLoopback":
            let oauthId = args.count > 0 ? ((args[0] as? NSNumber)?.intValue ?? activeOAuthId) : activeOAuthId
            let authorizeUrlStr = args.count > 1 ? (args[1] as? String ?? "") : ""
            completionHandler("")
            performLaunchOAuth(oauthId: oauthId, authorizeUrlStr: authorizeUrlStr)

        case "copyToClipboard":
            UIPasteboard.general.string = args.first as? String ?? ""
            completionHandler("")

        case "openExternalUrl":
            if let urlStr = args.first as? String, let url = URL(string: urlStr) {
                openUrlExternally(url)
            }
            completionHandler("")

        case "reportStatus":
            let statusJson = args.first as? String ?? "{}"
            NSLog("[ShareToSpacesheepStatus] %@", statusJson)
            if let sData = statusJson.data(using: .utf8),
               let sObj = try? JSONSerialization.jsonObject(with: sData) as? [String: Any] {
                let stage = sObj["stage"] as? String ?? ""
                let bgSync = (sObj["backgroundSyncing"] as? Bool) ?? false
                self.isBackgroundSyncing = bgSync
                if stage == "working" || bgSync {
                    self.beginBackgroundTaskIfNeeded()
                } else if stage == "complete" || stage == "error" || (stage == "done" && !bgSync) {
                    self.endBackgroundTaskIfNeeded()
                    if self.pendingDismissExtension {
                        self.pendingDismissExtension = false
                        self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
                    }
                }
            }
            if let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                let statusFile = docsDir.appendingPathComponent("last_status.json")
                try? statusJson.write(to: statusFile, atomically: true, encoding: .utf8)
            }
            completionHandler("")

        case "pickFiles":
            completionHandler("")
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item, .data, .content, .image, .pdf, .text], asCopy: true)
            picker.allowsMultipleSelection = true
            picker.delegate = self
            present(picker, animated: true)

        default:
            completionHandler("")
        }
    }

    private func performLaunchOAuth(oauthId: Int, authorizeUrlStr: String) {
        guard let url = URL(string: authorizeUrlStr) else {
            let errJson = Self.jsonString(["id": oauthId, "error": "Invalid OAuth authorize URL"])
            mainWebView.evaluateJavaScript("window.__onOAuthCallback && window.__onOAuthCallback(\(errJson));", completionHandler: nil)
            return
        }
        activeOAuthId = oauthId
        authSession?.cancel()
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "spacesheepshare") { [weak self] callbackURL, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.authSession = nil
                guard self.activeOAuthId == oauthId else { return }
                self.activeOAuthId = 0
                if let cb = callbackURL {
                    let outJson = Self.jsonString(["id": oauthId, "url": cb.absoluteString])
                    self.mainWebView.evaluateJavaScript("window.__onOAuthCallback && window.__onOAuthCallback(\(outJson));", completionHandler: nil)
                } else {
                    let errMsg = error?.localizedDescription ?? "Sign-in cancelled"
                    let outJson = Self.jsonString(["id": oauthId, "error": errMsg])
                    self.mainWebView.evaluateJavaScript("window.__onOAuthCallback && window.__onOAuthCallback(\(outJson));", completionHandler: nil)
                }
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.authSession = session
        if !session.start() {
            openUrlExternally(url)
        }
    }

    private func beginBackgroundTaskIfNeeded() {
        guard !isShareExtension, bgTaskId == .invalid else { return }
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                bgTaskId = app.beginBackgroundTask(withName: "SheepItBackgroundSync") { [weak self] in
                    self?.endBackgroundTaskIfNeeded()
                }
                break
            }
            responder = r.next
        }
    }

    private func endBackgroundTaskIfNeeded() {
        guard !isShareExtension, bgTaskId != .invalid else { return }
        let taskToEnd = bgTaskId
        bgTaskId = .invalid
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.endBackgroundTask(taskToEnd)
                break
            }
            responder = r.next
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        var arr: [[String: Any]] = []
        for u in urls {
            if let data = Self.readSecurityScopedData(from: u) {
                arr.append([
                    "name": u.lastPathComponent,
                    "type": Self.mimeType(for: u.pathExtension),
                    "size": data.count,
                    "base64": data.base64EncodedString()
                ])
            }
        }
        if let jsonData = try? JSONSerialization.data(withJSONObject: arr),
           let str = String(data: jsonData, encoding: .utf8) {
            mainWebView.evaluateJavaScript("window.__onFilesPicked && window.__onFilesPicked(\(str));", completionHandler: nil)
        } else {
            mainWebView.evaluateJavaScript("window.__onFilesPicked && window.__onFilesPicked([]);", completionHandler: nil)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        mainWebView.evaluateJavaScript("window.__onFilesPicked && window.__onFilesPicked([]);", completionHandler: nil)
    }

    private func openUrlExternally(_ url: URL) {
        if let extContext = self.extensionContext {
            extContext.open(url, completionHandler: nil)
        }
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                break
            }
            let sel = NSSelectorFromString("openURL:")
            if r.responds(to: sel) {
                r.perform(sel, with: url)
                break
            }
            responder = r.next
        }
    }
}
