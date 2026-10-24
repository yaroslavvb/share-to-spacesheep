import Foundation

extension SpacesheepBridgeViewController {

    static let appGroupSuite = "group.com.yaroslavvb.sheepit"
    static let storageDictKey = "spacesheep_storage_dict_v1"

    var prefs: UserDefaults {
        UserDefaults(suiteName: Self.appGroupSuite) ?? UserDefaults.standard
    }

    func loadStorageDict() -> [String: Any] {
        if let raw = prefs.string(forKey: Self.storageDictKey) ?? UserDefaults.standard.string(forKey: Self.storageDictKey),
           let data = raw.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return dict
        }
        return [:]
    }

    func saveStorageDict(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let raw = String(data: data, encoding: .utf8) else { return }
        prefs.set(raw, forKey: Self.storageDictKey)
        UserDefaults.standard.set(raw, forKey: Self.storageDictKey)
    }

    func seedDefaultKeyIfNeeded() {
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

    static func loadWebAssetScript(_ name: String, subdirectory: String = "WebAssets/dom") -> String {
        if let url = Bundle.main.url(forResource: name, withExtension: "js", subdirectory: subdirectory),
           let str = try? String(contentsOf: url, encoding: .utf8) {
            return str
        }
        return ""
    }

    static func jsonString(_ dict: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let str = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return str
    }
}
