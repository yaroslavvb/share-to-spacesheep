import Foundation
import WebKit

extension SpacesheepBridgeViewController {

    static let mobileSafariUserAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1"

    static let fastSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.httpMaximumConnectionsPerHost = 24
        cfg.timeoutIntervalForRequest = 15
        cfg.timeoutIntervalForResource = 30
        return URLSession(configuration: cfg)
    }()

    func performHttpRequestAsync(reqId: Int, urlStr: String, method: String, headersStr: String, bodyStr: String, isBase64: Bool) {
        guard let url = URL(string: urlStr) else {
            let errJson = Self.jsonString(["id": reqId, "error": "Invalid URL"])
            mainWebView.evaluateJavaScript("window.__onHttpResponse && window.__onHttpResponse(\(errJson));", completionHandler: nil)
            return
        }
        var req = URLRequest(url: url, timeoutInterval: 45)
        req.httpMethod = method
        req.setValue(Self.mobileSafariUserAgent, forHTTPHeaderField: "User-Agent")

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

    func performFetchBinaryAsync(binId: Int, urlStr: String, maxBytes: Int) {
        guard let url = URL(string: urlStr) else {
            let errJson = Self.jsonString(["id": binId, "ok": false, "status": 0, "error": "Invalid URL"])
            mainWebView.evaluateJavaScript("window.__onBinaryResponse && window.__onBinaryResponse(\(errJson));", completionHandler: nil)
            return
        }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.setValue(Self.mobileSafariUserAgent, forHTTPHeaderField: "User-Agent")
        Self.fastSession.dataTask(with: req) { [weak self] data, resp, err in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard let data = data, err == nil else {
                    let errJson = Self.jsonString(["id": binId, "ok": false, "status": 0, "error": err?.localizedDescription ?? "Fetch failed"])
                    self.mainWebView.evaluateJavaScript("window.__onBinaryResponse && window.__onBinaryResponse(\(errJson));", completionHandler: nil)
                    return
                }
                let http = resp as? HTTPURLResponse
                let status = http?.statusCode ?? 200
                if data.count > maxBytes {
                    let errJson = Self.jsonString(["id": binId, "ok": false, "status": status, "error": "too_big"])
                    self.mainWebView.evaluateJavaScript("window.__onBinaryResponse && window.__onBinaryResponse(\(errJson));", completionHandler: nil)
                    return
                }
                let ctype = http?.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
                let outJson = Self.jsonString([
                    "id": binId,
                    "ok": (200...299).contains(status),
                    "status": status,
                    "finalUrl": http?.url?.absoluteString ?? urlStr,
                    "contentType": ctype,
                    "size": data.count,
                    "b64": data.base64EncodedString()
                ])
                self.mainWebView.evaluateJavaScript("window.__onBinaryResponse && window.__onBinaryResponse(\(outJson));", completionHandler: nil)
            }
        }.resume()
    }
}
