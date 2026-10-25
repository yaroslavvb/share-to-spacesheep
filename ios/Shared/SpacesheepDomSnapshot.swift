import UIKit
import WebKit

extension SpacesheepBridgeViewController {

    private static let webglHookJs = loadWebAssetScript("webgl-hook")
    private static let checkReadyJs = loadWebAssetScript("check-ready")
    private static let serializeJs = loadWebAssetScript("serialize")
    private static let fetchAssetJs = loadWebAssetScript("fetch-asset")

    func performRenderPageSnapshot(snapId: Int, urlStr: String, timeoutMs: Int) {
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
        if !Self.webglHookJs.isEmpty {
            let webglScript = WKUserScript(
                source: Self.webglHookJs,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false
            )
            config.userContentController.addUserScript(webglScript)
        }
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

    func performFetchSnapshotAsset(assetId: Int, urlStr: String, maxBytes: Int) {
        guard let capWebView = self.captureWebView else {
            let errJson = Self.jsonString(["id": assetId, "ok": false, "error": "no_snapshot_webview"])
            mainWebView.evaluateJavaScript("window.__onSnapshotAssetResponse && window.__onSnapshotAssetResponse(\(errJson));", completionHandler: nil)
            return
        }
        let jsBody = "return await (\(Self.fetchAssetJs))(u, maxBytes);"
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

    func performResetSnapshotWebView() {
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

    func scheduleCheckOrExtract(delaySec: Double) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delaySec) { [weak self] in
            guard let self = self, let capWebView = self.captureWebView, self.pendingSnapshotId != 0 else { return }
            capWebView.evaluateJavaScript(Self.checkReadyJs) { [weak self] val, _ in
                guard let self = self, self.pendingSnapshotId != 0 else { return }
                let status = val as? String ?? "ready"
                if status == "challenge" {
                    self.scheduleCheckOrExtract(delaySec: 0.6)
                } else if status == "wait" {
                    self.scheduleCheckOrExtract(delaySec: 0.16)
                } else {
                    self.finishSnapshotFromCaptureWebView()
                }
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

    func failCurrentSnapshot() {
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

    func finishSnapshotFromCaptureWebView() {
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

        capWebView.evaluateJavaScript(Self.serializeJs) { [weak self] result, _ in
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
}
