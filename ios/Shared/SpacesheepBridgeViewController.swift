import UIKit
import WebKit
import UniformTypeIdentifiers

@objc public class SpacesheepBridgeViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, UIDocumentPickerDelegate {

    public var isShareExtension: Bool = false
    private var mainWebView: WKWebView!
    private var captureWebView: WKWebView?
    private var sharedPayloadJson: String = "{\"mode\":\"launcher\"}"
    private var pendingSnapshotId: Int = 0
    private var captureTimeoutWorkItem: DispatchWorkItem?

    private static let appGroupSuite = "group.com.yaroslavvb.sheepit"
    private static let storageDictKey = "spacesheep_storage_dict_v1"

    private var prefs: UserDefaults {
        return UserDefaults(suiteName: Self.appGroupSuite) ?? UserDefaults.standard
    }

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
          fetchBinaryBase64: function(url, maxBytes) {
            return this._call("fetchBinaryBase64", [String(url), Number(maxBytes || 26214400)]);
          },
          renderPageSnapshot: function(id, url, timeoutMs) {
            return this._call("renderPageSnapshot", [Number(id), String(url), Number(timeoutMs || 5500)]);
          },
          fetchSnapshotAsset: function(id, url, maxBytes) {
            return this._call("fetchSnapshotAsset", [Number(id), String(url), Number(maxBytes || 26214400)]);
          },
          resetSnapshotWebView: function() {
            return this._call("resetSnapshotWebView", []);
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
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    public func handleIncomingUrl(_ url: URL) {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        if comps.scheme == "spacesheepshare" {
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
                if let data = try? JSONSerialization.data(withJSONObject: dict),
                   let str = String(data: data, encoding: .utf8) {
                    sharedPayloadJson = str
                    if mainWebView != nil {
                        mainWebView.evaluateJavaScript("window.__handleIncomingShare && window.__handleIncomingShare(\(str));", completionHandler: nil)
                    }
                }
            }
        }
    }

    private func checkProcessArgumentsForIntent() {
        let args = ProcessInfo.processInfo.arguments
        if let idx = args.firstIndex(of: "--share-url"), idx + 1 < args.count {
            let url = args[idx + 1]
            var dict: [String: Any] = [
                "mode": "url",
                "url": url,
                "title": "",
                "autoPublish": true
            ]
            if let sIdx = args.firstIndex(of: "--space-uuid"), sIdx + 1 < args.count {
                dict["spaceUuid"] = args[sIdx + 1]
            }
            if let vIdx = args.firstIndex(of: "--visibility"), vIdx + 1 < args.count {
                dict["visibility"] = args[vIdx + 1]
            }
            if let data = try? JSONSerialization.data(withJSONObject: dict),
               let str = String(data: data, encoding: .utf8) {
                sharedPayloadJson = str
            }
        }
    }

    // MARK: - Storage Management

    private func loadStorageDict() -> [String: Any] {
        if let raw = prefs.string(forKey: Self.storageDictKey) ?? UserDefaults.standard.string(forKey: Self.storageDictKey),
           let data = raw.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return dict
        }
        return [:]
    }

    private func saveStorageDict(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let raw = String(data: data, encoding: .utf8) else { return }
        prefs.set(raw, forKey: Self.storageDictKey)
        UserDefaults.standard.set(raw, forKey: Self.storageDictKey)
    }

    private func seedDefaultKeyIfNeeded() {
        var dict = loadStorageDict()
        if dict["auth"] == nil {
            let keyUrl = Bundle.main.url(forResource: "default_key", withExtension: "txt", subdirectory: "WebAssets")
                ?? Bundle.main.url(forResource: "default_key", withExtension: "txt")
            if let bundledKeyUrl = keyUrl,
               let key = try? String(contentsOf: bundledKeyUrl, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
               key.hasPrefix("ss_") {
                dict["auth"] = ["kind": "key", "key": key]
                dict["account"] = ["handle": "yaroslavvb"]
                saveStorageDict(dict)
            }
        }
    }

    private func loadAppIndex() {
        if let indexUrl = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebAssets") {
            let assetsDir = indexUrl.deletingLastPathComponent()
            mainWebView.loadFileURL(indexUrl, allowingReadAccessTo: assetsDir)
        } else if let indexUrl = Bundle.main.url(forResource: "index", withExtension: "html") {
            mainWebView.loadFileURL(indexUrl, allowingReadAccessTo: indexUrl.deletingLastPathComponent())
        }
    }

    // MARK: - Share Extension Input Extraction

    private func extractShareExtensionItems(from context: NSExtensionContext, completion: @escaping (String) -> Void) {
        guard let items = context.inputItems as? [NSExtensionItem], !items.isEmpty else {
            completion("{\"mode\":\"launcher\"}")
            return
        }

        var foundUrl: String?
        var foundTitle: String = ""
        var fileObjects: [[String: Any]] = []
        let group = DispatchGroup()

        for item in items {
            if let attrTitle = item.attributedContentText?.string, !attrTitle.isEmpty, foundTitle.isEmpty {
                foundTitle = attrTitle
            }
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
                        defer { group.leave() }
                        if let url = data as? URL {
                            if url.isFileURL {
                                if let fileData = try? Data(contentsOf: url) {
                                    fileObjects.append([
                                        "name": url.lastPathComponent,
                                        "type": Self.mimeType(for: url.pathExtension),
                                        "size": fileData.count,
                                        "base64": fileData.base64EncodedString()
                                    ])
                                }
                            } else {
                                foundUrl = url.absoluteString
                            }
                        } else if let str = data as? String, let url = Self.extractFirstHttpUrl(from: str) {
                            foundUrl = url
                        }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
                        defer { group.leave() }
                        if let str = data as? String {
                            if let url = Self.extractFirstHttpUrl(from: str) {
                                if foundUrl == nil { foundUrl = url }
                            } else if let textData = str.data(using: .utf8) {
                                fileObjects.append([
                                    "name": "shared-note.txt",
                                    "type": "text/plain",
                                    "size": textData.count,
                                    "base64": textData.base64EncodedString()
                                ])
                            }
                        }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) || provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) || provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
                    let typeId = provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
                    group.enter()
                    provider.loadItem(forTypeIdentifier: typeId, options: nil) { data, _ in
                        defer { group.leave() }
                        if let url = data as? URL, let fileData = try? Data(contentsOf: url) {
                            fileObjects.append([
                                "name": url.lastPathComponent,
                                "type": Self.mimeType(for: url.pathExtension),
                                "size": fileData.count,
                                "base64": fileData.base64EncodedString()
                            ])
                        } else if let image = data as? UIImage, let pngData = image.pngData() {
                            fileObjects.append([
                                "name": "shared-image.png",
                                "type": "image/png",
                                "size": pngData.count,
                                "base64": pngData.base64EncodedString()
                            ])
                        }
                    }
                }
            }
        }

        group.notify(queue: .main) {
            if let url = foundUrl {
                let dict: [String: Any] = [
                    "mode": "url",
                    "url": url,
                    "title": foundTitle,
                    "autoPublish": true
                ]
                if let jsonData = try? JSONSerialization.data(withJSONObject: dict),
                   let str = String(data: jsonData, encoding: .utf8) {
                    completion(str)
                    return
                }
            } else if !fileObjects.isEmpty {
                let dict: [String: Any] = [
                    "mode": "files",
                    "title": foundTitle,
                    "files": fileObjects,
                    "autoPublish": true
                ]
                if let jsonData = try? JSONSerialization.data(withJSONObject: dict),
                   let str = String(data: jsonData, encoding: .utf8) {
                    completion(str)
                    return
                }
            }
            completion("{\"mode\":\"launcher\"}")
        }
    }

    private static func extractFirstHttpUrl(from text: String) -> String? {
        let pattern = "https?://[^\\s\"'<>]+"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return nil }
        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: nsRange),
              let range = Range(match.range, in: text) else { return nil }
        return String(text[range])
    }

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "svg": return "image/svg+xml"
        case "pdf": return "application/pdf"
        case "html", "htm": return "text/html"
        case "css": return "text/css"
        case "js", "mjs": return "text/javascript"
        case "json": return "application/json"
        case "md": return "text/markdown"
        case "csv": return "text/csv"
        case "txt": return "text/plain"
        case "mp4": return "video/mp4"
        case "mp3": return "audio/mpeg"
        default: return "application/octet-stream"
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
            let dict = loadStorageDict()
            completionHandler(Self.jsonString(dict))

        case "storageSet":
            let patchStr = args.first as? String ?? "{}"
            var dict = loadStorageDict()
            if let pData = patchStr.data(using: .utf8),
               let patch = try? JSONSerialization.jsonObject(with: pData) as? [String: Any] {
                for (k, v) in patch {
                    dict[k] = v
                }
                saveStorageDict(dict)
            }
            completionHandler("")

        case "storageRemove":
            let keysStr = args.first as? String ?? "[]"
            var dict = loadStorageDict()
            if let kData = keysStr.data(using: .utf8),
               let keys = try? JSONSerialization.jsonObject(with: kData) as? [String] {
                for k in keys {
                    dict.removeValue(forKey: k)
                }
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

        case "fetchBinaryBase64":
            let urlStr = args.count > 0 ? (args[0] as? String ?? "") : ""
            let maxBytes = args.count > 1 ? ((args[1] as? NSNumber)?.intValue ?? 26214400) : 26214400
            performFetchBinary(urlStr: urlStr, maxBytes: maxBytes, completion: completionHandler)

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

        case "resetSnapshotWebView":
            completionHandler("")
            performResetSnapshotWebView()

        case "copyToClipboard":
            let text = args.first as? String ?? ""
            UIPasteboard.general.string = text
            completionHandler("")

        case "openExternalUrl":
            let urlStr = args.first as? String ?? ""
            if let url = URL(string: urlStr) {
                openUrlExternally(url)
            }
            completionHandler("")

        case "reportStatus":
            let statusJson = args.first as? String ?? "{}"
            NSLog("[ShareToSpacesheepStatus] %@", statusJson)
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

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        var arr: [[String: Any]] = []
        for u in urls {
            if let data = try? Data(contentsOf: u) {
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

    // MARK: - Native HTTP & Binary Fetch

    private static let fastSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.httpMaximumConnectionsPerHost = 24
        cfg.timeoutIntervalForRequest = 15
        cfg.timeoutIntervalForResource = 30
        return URLSession(configuration: cfg)
    }()

    private func performHttpRequestAsync(reqId: Int, urlStr: String, method: String, headersStr: String, bodyStr: String, isBase64: Bool) {
        guard let url = URL(string: urlStr) else {
            let errJson = Self.jsonString(["id": reqId, "error": "Invalid URL"])
            mainWebView.evaluateJavaScript("window.__onHttpResponse && window.__onHttpResponse(\(errJson));", completionHandler: nil)
            return
        }
        var req = URLRequest(url: url, timeoutInterval: 45)
        req.httpMethod = method
        req.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1", forHTTPHeaderField: "User-Agent")

        if let hData = headersStr.data(using: .utf8),
           let hDict = try? JSONSerialization.jsonObject(with: hData) as? [String: Any] {
            for (k, v) in hDict {
                req.setValue("\(v)", forHTTPHeaderField: k)
            }
        }

        if !bodyStr.isEmpty && method.uppercased() != "GET" && method.uppercased() != "HEAD" {
            if isBase64, let decoded = Data(base64Encoded: bodyStr) {
                req.httpBody = decoded
            } else {
                req.httpBody = bodyStr.data(using: .utf8)
            }
        }

        Self.fastSession.dataTask(with: req) { [weak self] data, resp, err in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let err = err {
                    let errJson = Self.jsonString(["id": reqId, "error": err.localizedDescription])
                    self.mainWebView.evaluateJavaScript("window.__onHttpResponse && window.__onHttpResponse(\(errJson));", completionHandler: nil)
                    return
                }
                let http = resp as? HTTPURLResponse
                let status = http?.statusCode ?? 200
                var headersOut: [String: String] = [:]
                if let allHeaders = http?.allHeaderFields {
                    for (k, v) in allHeaders {
                        headersOut["\(k)".lowercased()] = "\(v)"
                    }
                }
                var bodyOut = ""
                if let data = data {
                    if (headersOut["content-type"] ?? "").contains("text/event-stream") {
                        let rawText = String(data: data, encoding: .utf8) ?? ""
                        var lastDataLine = ""
                        for line in rawText.split(separator: "\n") {
                            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                            if trimmed.hasPrefix("data:") {
                                let payload = String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                                if !payload.isEmpty {
                                    lastDataLine = payload
                                }
                            }
                        }
                        bodyOut = lastDataLine.isEmpty ? rawText : lastDataLine
                        headersOut["content-type"] = "application/json"
                    } else {
                        bodyOut = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
                    }
                }
                let resDict: [String: Any] = [
                    "id": reqId,
                    "status": status,
                    "finalUrl": http?.url?.absoluteString ?? urlStr,
                    "headers": headersOut,
                    "body": bodyOut
                ]
                let resJson = Self.jsonString(resDict)
                self.mainWebView.evaluateJavaScript("window.__onHttpResponse && window.__onHttpResponse(\(resJson));", completionHandler: nil)
            }
        }.resume()
    }

    private func performFetchBinaryAsync(binId: Int, urlStr: String, maxBytes: Int) {
        performFetchBinary(urlStr: urlStr, maxBytes: maxBytes) { [weak self] jsonStr in
            guard let self = self else { return }
            if let raw = jsonStr,
               let data = raw.data(using: .utf8),
               var dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                dict["id"] = binId
                if let b64 = dict["base64"] as? String {
                    dict["b64"] = b64
                    dict.removeValue(forKey: "base64")
                }
                let outJson = Self.jsonString(dict)
                self.mainWebView.evaluateJavaScript("window.__onBinaryResponse && window.__onBinaryResponse(\(outJson));", completionHandler: nil)
            } else {
                let errJson = Self.jsonString(["id": binId, "ok": false, "status": 0, "error": "Fetch failed"])
                self.mainWebView.evaluateJavaScript("window.__onBinaryResponse && window.__onBinaryResponse(\(errJson));", completionHandler: nil)
            }
        }
    }

    private func performFetchBinary(urlStr: String, maxBytes: Int, completion: @escaping (String?) -> Void) {
        guard let url = URL(string: urlStr) else {
            completion(Self.jsonString(["ok": false, "status": 0, "error": "Invalid URL"]))
            return
        }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1", forHTTPHeaderField: "User-Agent")
        Self.fastSession.dataTask(with: req) { data, resp, err in
            guard let data = data, err == nil else {
                DispatchQueue.main.async {
                    completion(Self.jsonString(["ok": false, "status": 0, "error": err?.localizedDescription ?? "Fetch failed"]))
                }
                return
            }
            let http = resp as? HTTPURLResponse
            let status = http?.statusCode ?? 200
            if data.count > maxBytes {
                DispatchQueue.main.async {
                    completion(Self.jsonString(["ok": false, "status": status, "error": "too_big"]))
                }
                return
            }
            let ctype = http?.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
            let res: [String: Any] = [
                "ok": (200...299).contains(status),
                "status": status,
                "finalUrl": http?.url?.absoluteString ?? urlStr,
                "contentType": ctype,
                "size": data.count,
                "base64": data.base64EncodedString()
            ]
            DispatchQueue.main.async {
                completion(Self.jsonString(res))
            }
        }.resume()
    }

    // MARK: - Offscreen WKWebView DOM Snapshot

    private func performRenderPageSnapshot(snapId: Int, urlStr: String, timeoutMs: Int) {
        guard let url = URL(string: urlStr) else {
            let errJson = Self.jsonString(["id": snapId, "ok": false])
            mainWebView.evaluateJavaScript("window.__onSnapshotResponse && window.__onSnapshotResponse(\(errJson));", completionHandler: nil)
            return
        }

        captureTimeoutWorkItem?.cancel()
        captureWebView?.stopLoading()
        captureWebView?.removeFromSuperview()

        self.pendingSnapshotId = snapId
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptEnabled = true
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        let defaultAppName = config.applicationNameForUserAgent ?? "Mobile/15E148"
        config.applicationNameForUserAgent = "Version/18.4 \(defaultAppName) Safari/604.1"
        let capWebView = WKWebView(frame: CGRect(x: 32, y: 90, width: 320, height: 340), configuration: config)
        capWebView.alpha = 1.0
        capWebView.isOpaque = false
        capWebView.isUserInteractionEnabled = false
        capWebView.navigationDelegate = self
        capWebView.uiDelegate = self
        self.view.insertSubview(capWebView, belowSubview: self.mainWebView)
        self.captureWebView = capWebView

        let timeoutSec = max(Double(timeoutMs) / 1000.0, 3.0)
        let workItem = DispatchWorkItem { [weak self] in
            self?.finishSnapshotFromCaptureWebView()
        }
        self.captureTimeoutWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSec, execute: workItem)

        let req = URLRequest(url: url, timeoutInterval: timeoutSec + 5.0)
        capWebView.load(req)
        scheduleCheckOrExtract(delaySec: 0.3)
    }

    private func performFetchSnapshotAsset(assetId: Int, urlStr: String, maxBytes: Int) {
        guard let capWebView = self.captureWebView else {
            let errJson = Self.jsonString(["id": assetId, "ok": false, "error": "no_snapshot_webview"])
            mainWebView.evaluateJavaScript("window.__onSnapshotAssetResponse && window.__onSnapshotAssetResponse(\(errJson));", completionHandler: nil)
            return
        }
        let jsBody = """
        try {
          var r;
          try { r = await fetch(u, { credentials: 'same-origin', cache: 'force-cache' }); } catch(e) {}
          if (!r || !r.ok) { try { r = await fetch(u, { credentials: 'same-origin' }); } catch(e) {} }
          if (!r || !r.ok) { try { r = await fetch(u, { credentials: 'include', cache: 'force-cache' }); } catch(e) {} }
          if (!r || !r.ok) r = await fetch(u, { credentials: 'include' });
          if (!r.ok) return JSON.stringify({ ok: false, error: 'HTTP ' + r.status });
          var cl = Number(r.headers.get('content-length') || 0);
          if (cl > maxBytes) return JSON.stringify({ ok: false, error: 'too_big' });
          var blob = await r.blob();
          if (blob.size > maxBytes) return JSON.stringify({ ok: false, error: 'too_big' });
          var b64 = await new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onloadend = function() {
              var res = String(reader.result || '');
              var idx = res.indexOf(',');
              resolve(idx >= 0 ? res.slice(idx + 1) : '');
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          return JSON.stringify({
            ok: true,
            base64: b64,
            contentType: blob.type || r.headers.get('content-type') || '',
            finalUrl: r.url || u
          });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err && err.message || err) });
        }
        """
        capWebView.callAsyncJavaScript(jsBody, arguments: ["u": urlStr, "maxBytes": maxBytes], in: nil, in: .page) { [weak self] result in
            guard let self = self else { return }
            if case .success(let val) = result,
               let jsonStr = val as? String,
               let data = jsonStr.data(using: .utf8),
               var parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                parsed["id"] = assetId
                let outJson = Self.jsonString(parsed)
                self.mainWebView.evaluateJavaScript("window.__onSnapshotAssetResponse && window.__onSnapshotAssetResponse(\(outJson));", completionHandler: nil)
            } else {
                let errJson = Self.jsonString(["id": assetId, "ok": false, "error": "eval_failed"])
                self.mainWebView.evaluateJavaScript("window.__onSnapshotAssetResponse && window.__onSnapshotAssetResponse(\(errJson));", completionHandler: nil)
            }
        }
    }

    private func performResetSnapshotWebView() {
        captureTimeoutWorkItem?.cancel()
        captureTimeoutWorkItem = nil
        pendingSnapshotId = 0
        captureWebView?.stopLoading()
        captureWebView?.removeFromSuperview()
        captureWebView = nil
    }

    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if webView == self.captureWebView {
            let scheme = navigationAction.request.url?.scheme?.lowercased() ?? ""
            if scheme != "http" && scheme != "https" && scheme != "about" && scheme != "data" && scheme != "blob" {
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView == self.captureWebView else { return }
        scheduleCheckOrExtract(delaySec: 0.15)
    }

    private func scheduleCheckOrExtract(delaySec: Double) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delaySec) { [weak self] in
            guard let self = self, let capWebView = self.captureWebView, self.pendingSnapshotId != 0 else { return }
            let checkJs = "(function(){ var href = String(location.href || ''); var t = document.title || ''; var c = !!(t === 'Just a moment...' || t === 'Attention Required! | Cloudflare' || document.querySelector('#challenge-running, #challenge-stage, #cf-challenge-running, iframe[src*=\"challenges.cloudflare.com\"], script[src*=\"challenges.cloudflare.com\"]')); var bLen = document.body ? document.body.innerHTML.trim().length : 0; var katexWait = !!(document.querySelector('script[src*=\"katex\"]') && !document.querySelector('.katex') && document.readyState !== 'complete'); var ready = !c && href !== '' && href !== 'about:blank' && document.readyState !== 'loading' && bLen >= 200 && !katexWait; return JSON.stringify({challenge: c, ready: ready, title: t, url: href, bodyLen: bLen}); })()"
            capWebView.evaluateJavaScript(checkJs) { [weak self] val, _ in
                guard let self = self, self.pendingSnapshotId != 0 else { return }
                if let str = val as? String,
                   let data = str.data(using: .utf8),
                   let info = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    if (info["challenge"] as? Bool) == true {
                        self.scheduleCheckOrExtract(delaySec: 0.6)
                        return
                    }
                    if (info["ready"] as? Bool) != true {
                        self.scheduleCheckOrExtract(delaySec: 0.16)
                        return
                    }
                }
                self.finishSnapshotFromCaptureWebView()
            }
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard webView == self.captureWebView else { return }
        failCurrentSnapshot()
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView == self.captureWebView else { return }
        failCurrentSnapshot()
    }

    private func failCurrentSnapshot() {
        captureTimeoutWorkItem?.cancel()
        captureTimeoutWorkItem = nil
        captureWebView?.removeFromSuperview()
        captureWebView = nil
        let snapId = pendingSnapshotId
        guard snapId != 0 else { return }
        pendingSnapshotId = 0
        let errJson = Self.jsonString(["id": snapId, "ok": false])
        mainWebView.evaluateJavaScript("window.__onSnapshotResponse && window.__onSnapshotResponse(\(errJson));", completionHandler: nil)
    }

    private func finishSnapshotFromCaptureWebView() {
        captureTimeoutWorkItem?.cancel()
        captureTimeoutWorkItem = nil
        guard let capWebView = self.captureWebView, pendingSnapshotId != 0 else { return }
        let snapId = pendingSnapshotId
        pendingSnapshotId = 0

        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            for cookie in cookies {
                HTTPCookieStorage.shared.setCookie(cookie)
            }
        }

        let snapJs = """
        (function() {
          try {
            var title = document.title || '';
            var isChallenge = (title === 'Just a moment...' || title === 'Attention Required! | Cloudflare') || !!document.querySelector('#challenge-running, #challenge-stage, #cf-challenge-running, iframe[src*="challenges.cloudflare.com"]');
            if (isChallenge) {
              return JSON.stringify({ ok: false, challenge: true, title: title });
            }
            var d = document.doctype;
            var dt = d ? '<!DOCTYPE ' + d.name + (d.publicId ? ' PUBLIC "' + d.publicId + '"' : '') + (d.systemId ? ' "' + d.systemId + '"' : '') + '>' : '<!DOCTYPE html>';
            var root = document.documentElement.cloneNode(true);
            var origCanvases = document.querySelectorAll('canvas');
            var cloneCanvases = root.querySelectorAll('canvas');
            for (var i = 0; i < origCanvases.length && i < cloneCanvases.length; i++) {
              try {
                var c = origCanvases[i];
                if (c.width > 0 && c.height > 0) {
                  var dataUrl = c.toDataURL('image/png');
                  if (dataUrl && dataUrl.length > 64) {
                    var img = document.createElement('img');
                    img.setAttribute('src', dataUrl);
                    if (c.getAttribute('class')) img.setAttribute('class', c.getAttribute('class'));
                    if (c.getAttribute('style')) img.setAttribute('style', c.getAttribute('style'));
                    cloneCanvases[i].replaceWith(img);
                  }
                }
              } catch(e) {}
            }
            var origStyles = document.querySelectorAll('style');
            var cloneStyles = root.querySelectorAll('style');
            for (var sIdx = 0; sIdx < origStyles.length && sIdx < cloneStyles.length; sIdx++) {
              try {
                var origS = origStyles[sIdx], cloneS = cloneStyles[sIdx];
                var rawCss = (origS.textContent || '').replace(/<!--[\\s\\S]*?-->/g, '');
                var sheetCss = '';
                if (origS.sheet && origS.sheet.cssRules) {
                  var rules = [];
                  for (var rIdx = 0; rIdx < origS.sheet.cssRules.length; rIdx++) {
                    rules.push(origS.sheet.cssRules[rIdx].cssText);
                  }
                  sheetCss = rules.join('\\n');
                }
                cloneS.textContent = (rawCss.trim().length === 0 && sheetCss.length > 0) ? sheetCss : (sheetCss.length > rawCss.length ? sheetCss : rawCss);
              } catch(e) {}
            }
            var origImgs = document.querySelectorAll('img');
            var cloneImgs = root.querySelectorAll('img');
            for (var mIdx = 0; mIdx < origImgs.length && mIdx < cloneImgs.length; mIdx++) {
              try {
                var oImg = origImgs[mIdx], cImg = cloneImgs[mIdx];
                cImg.removeAttribute('loading');
                cImg.removeAttribute('decoding');
                var curSrc = cImg.getAttribute('src') || '';
                var lazySrc = cImg.getAttribute('data-src') || cImg.getAttribute('data-lazy-src') || cImg.getAttribute('data-original') || '';
                if (lazySrc && (!curSrc || curSrc.indexOf('data:') === 0 || curSrc === 'about:blank')) {
                  cImg.setAttribute('src', lazySrc);
                } else if ((!curSrc || curSrc.indexOf('data:') === 0) && oImg.currentSrc && /^https?:/i.test(oImg.currentSrc)) {
                  cImg.setAttribute('src', oImg.currentSrc);
                }
                var lazySrcset = cImg.getAttribute('data-srcset') || cImg.getAttribute('data-lazy-srcset') || '';
                if (lazySrcset && !cImg.getAttribute('srcset')) {
                  cImg.setAttribute('srcset', lazySrcset);
                }
              } catch(e) {}
            }
            var overlays = root.querySelectorAll('.osano-cm-window, #onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, .qc-cmp2-container, .fc-consent-root, #truste-consent-track, #didomi-host, #usercentrics-root, .cky-consent-container, .cc-window, .cc-revoke, #cookie-law-info-bar, #cookie-notice, #iubenda-cs-banner, [id^=\"sp_message_container\"], .cmplz-cookiebanner-container, #BorlabsCookieBox, #gdpr-cookie-message, .mw-notification-area, .postedit-container, [role=\"dialog\"][aria-label*=\"Subscribe\" i], [class*=\"subscribeDialog\"], noscript');
            for (var oIdx = 0; oIdx < overlays.length; oIdx++) overlays[oIdx].remove();
            var cloneBody = root.querySelector('body');
            for (var rEl of [root, cloneBody]) {
              if (!rEl) continue;
              var st = rEl.getAttribute('style');
              if (st && /overflow\\s*:\\s*hidden/i.test(st)) {
                var cleaned = st.replace(/overflow(-[xy])?\\s*:\\s*hidden\\s*(!important)?\\s*;?/gi, '').replace(/position\\s*:\\s*fixed\\s*(!important)?\\s*;?/gi, '').trim();
                if (cleaned) rEl.setAttribute('style', cleaned);
                else rEl.removeAttribute('style');
              }
            }
            return JSON.stringify({
              ok: true,
              title: title,
              finalUrl: location.href,
              html: dt + "\\n" + root.outerHTML
            });
          } catch(err) {
            return JSON.stringify({ ok: false, error: String(err) });
          }
        })();
        """
        capWebView.evaluateJavaScript(snapJs) { [weak self] result, _ in
            guard let self = self else { return }
            if let jsonStr = result as? String,
               let data = jsonStr.data(using: .utf8),
               var parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if (parsed["ok"] as? Bool) != true {
                    capWebView.removeFromSuperview()
                    self.captureWebView = nil
                }
                parsed["id"] = snapId
                let outJson = Self.jsonString(parsed)
                self.mainWebView.evaluateJavaScript("window.__onSnapshotResponse && window.__onSnapshotResponse(\(outJson));", completionHandler: nil)
            } else {
                capWebView.removeFromSuperview()
                self.captureWebView = nil
                let errJson = Self.jsonString(["id": snapId, "ok": false])
                self.mainWebView.evaluateJavaScript("window.__onSnapshotResponse && window.__onSnapshotResponse(\(errJson));", completionHandler: nil)
            }
        }
    }

    private static func jsonString(_ dict: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let str = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return str
    }
}
