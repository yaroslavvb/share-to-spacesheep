import UIKit
import UniformTypeIdentifiers

extension SpacesheepBridgeViewController {

    static let maxSharedFileBytes = 25 * 1024 * 1024

    static func readSecurityScopedData(from url: URL) -> Data? {
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        if let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
           size > maxSharedFileBytes {
            return nil
        }
        guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]),
              data.count <= maxSharedFileBytes else {
            return nil
        }
        return data
    }

    func extractShareExtensionItems(from context: NSExtensionContext, completion: @escaping (String) -> Void) {
        guard let items = context.inputItems as? [NSExtensionItem], !items.isEmpty else {
            completion("{\"mode\":\"launcher\"}")
            return
        }

        var foundUrl: String?
        var foundTitle: String = ""
        var fileObjects: [[String: Any]] = []
        let lock = NSLock()
        let group = DispatchGroup()

        for item in items {
            if let attrTitle = item.attributedContentText?.string, !attrTitle.isEmpty {
                lock.lock()
                if foundTitle.isEmpty { foundTitle = attrTitle }
                lock.unlock()
            }
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier, options: nil) { data, _ in
                        defer { group.leave() }
                        if let dict = data as? NSDictionary,
                           let results = dict[NSExtensionJavaScriptPreprocessingResultsKey] as? NSDictionary {
                            lock.lock()
                            if let u = results["URL"] as? String ?? results["baseURI"] as? String, !u.isEmpty, foundUrl == nil {
                                foundUrl = u
                            }
                            if let t = results["title"] as? String, !t.isEmpty, foundTitle.isEmpty {
                                foundTitle = t
                            }
                            lock.unlock()
                        }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
                        defer { group.leave() }
                        if let url = data as? URL {
                            if url.isFileURL {
                                if let fileData = Self.readSecurityScopedData(from: url) {
                                    lock.lock()
                                    fileObjects.append([
                                        "name": url.lastPathComponent,
                                        "type": Self.mimeType(for: url.pathExtension),
                                        "size": fileData.count,
                                        "base64": fileData.base64EncodedString()
                                    ])
                                    lock.unlock()
                                }
                            } else {
                                lock.lock()
                                foundUrl = url.absoluteString
                                lock.unlock()
                            }
                        } else if let str = data as? String, let url = Self.extractFirstHttpUrl(from: str) {
                            lock.lock()
                            foundUrl = url
                            lock.unlock()
                        }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
                        defer { group.leave() }
                        if let str = data as? String {
                            if let url = Self.extractFirstHttpUrl(from: str) {
                                lock.lock()
                                if foundUrl == nil { foundUrl = url }
                                lock.unlock()
                            } else if let textData = str.data(using: .utf8), textData.count <= Self.maxSharedFileBytes {
                                lock.lock()
                                fileObjects.append([
                                    "name": "shared-note.txt",
                                    "type": "text/plain",
                                    "size": textData.count,
                                    "base64": textData.base64EncodedString()
                                ])
                                lock.unlock()
                            }
                        }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
                            || provider.hasItemConformingToTypeIdentifier(UTType.image.identifier)
                            || provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
                    let typeId = provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
                    group.enter()
                    provider.loadItem(forTypeIdentifier: typeId, options: nil) { data, _ in
                        defer { group.leave() }
                        if let url = data as? URL, let fileData = Self.readSecurityScopedData(from: url) {
                            lock.lock()
                            fileObjects.append([
                                "name": url.lastPathComponent,
                                "type": Self.mimeType(for: url.pathExtension),
                                "size": fileData.count,
                                "base64": fileData.base64EncodedString()
                            ])
                            lock.unlock()
                        } else if let image = data as? UIImage, let pngData = image.pngData(), pngData.count <= Self.maxSharedFileBytes {
                            lock.lock()
                            fileObjects.append([
                                "name": "shared-image.png",
                                "type": "image/png",
                                "size": pngData.count,
                                "base64": pngData.base64EncodedString()
                            ])
                            lock.unlock()
                        }
                    }
                }
            }
        }

        group.notify(queue: .main) {
            if let url = foundUrl {
                completion(Self.jsonString([
                    "mode": "url",
                    "url": url,
                    "title": foundTitle,
                    "autoPublish": true
                ]))
            } else if !fileObjects.isEmpty {
                completion(Self.jsonString([
                    "mode": "files",
                    "title": foundTitle,
                    "files": fileObjects,
                    "autoPublish": true
                ]))
            } else {
                completion("{\"mode\":\"launcher\"}")
            }
        }
    }

    static func extractFirstHttpUrl(from text: String) -> String? {
        let pattern = "https?://[^\\s\"'<>]+"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return nil }
        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: nsRange),
              let range = Range(match.range, in: text) else { return nil }
        var u = String(text[range])
        while let last = u.last, [".", ",", ")", ";"].contains(String(last)) {
            u.removeLast()
        }
        return u.isEmpty ? nil : u
    }

    static func mimeType(for ext: String) -> String {
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
}
