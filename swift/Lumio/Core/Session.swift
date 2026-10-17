import Foundation
import Observation
import Security

/// Source de chaînes Live TV (mêmes champs que l'appli Lumio habituelle).
struct LiveSource: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var kind: String // "m3u" | "stremio"
    var url: String
}

/// VPN (Proton VPN…) lancé par des raccourcis iOS autour de la Live TV.
struct LiveVpn: Codable, Hashable {
    var enabled = false
    var auto = false
    var onShortcut = "Lumio VPN On"
    var offShortcut = "Lumio VPN Off"
}

/// Connexion Jellyfin, adresse du serveur Lumio et réglages partagés avec l'appli Lumio habituelle
/// (ils sont enregistrés dans les préférences Jellyfin du compte : clé TMDB, sources Live TV, favoris…).
@MainActor
@Observable
final class AppSession {
    var serverURL: String
    var userId: String
    var userName: String
    var token: String
    var isAdmin: Bool
    var lumioURL: String
    let deviceId: String

    // Réglages partagés
    var tmdbKey = ""
    var liveSources: [LiveSource] = []
    var liveFavorites: [String] = []
    var liveLang = "fr"
    var liveVpn = LiveVpn()
    var quality = "original"
    var cloudLoaded = false

    @ObservationIgnored private var cloudRaw: [String: Any] = [:]

    var isLoggedIn: Bool { !token.isEmpty && !serverURL.isEmpty }
    var hasTmdb: Bool { !tmdbKey.trimmingCharacters(in: .whitespaces).isEmpty }

    private static let store = UserDefaults.standard

    init() {
        let d = AppSession.store
        serverURL = d.string(forKey: "jf.url") ?? ""
        userId = d.string(forKey: "jf.user") ?? ""
        userName = d.string(forKey: "jf.name") ?? ""
        token = Keychain.get("jf.token") ?? ""
        isAdmin = d.bool(forKey: "jf.admin")
        lumioURL = d.string(forKey: "lumio.url") ?? "https://lumio.wawanono.lol"
        if let id = d.string(forKey: "device.id") {
            deviceId = id
        } else {
            let id = UUID().uuidString
            d.set(id, forKey: "device.id")
            deviceId = id
        }
        if let data = d.data(forKey: "cloud.cache"), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            apply(obj)
        }
    }

    var jellyfin: JellyfinAPI { JellyfinAPI(session: self) }
    var lumio: LumioAPI { LumioAPI(session: self) }
    var tmdb: TMDB { TMDB(key: tmdbKey) }

    func login(server: String, user: String, password: String) async throws {
        let url = JellyfinAPI.normalize(server)
        let res = try await JellyfinAPI.authenticate(server: url, user: user, password: password, deviceId: deviceId)
        serverURL = url
        userId = res.User.Id
        userName = res.User.Name
        token = res.AccessToken
        isAdmin = res.User.Policy?.IsAdministrator ?? false
        save()
        await loadCloud()
    }

    func logout() {
        token = ""
        userId = ""
        save()
    }

    func save() {
        let d = AppSession.store
        d.set(serverURL, forKey: "jf.url")
        d.set(userId, forKey: "jf.user")
        d.set(userName, forKey: "jf.name")
        d.set(isAdmin, forKey: "jf.admin")
        d.set(lumioURL, forKey: "lumio.url")
        if token.isEmpty { Keychain.delete("jf.token") } else { Keychain.set(token, for: "jf.token") }
    }

    // ——— Réglages partagés (préférences Jellyfin « lumio ») ———

    private var prefsURL: URL? {
        URL(string: "\(serverURL)/DisplayPreferences/lumio?userId=\(userId)&client=lumio")
    }

    private func prefsRequest(_ method: String = "GET", body: Data? = nil) -> URLRequest? {
        guard let url = prefsURL else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue(JellyfinAPI.authHeader(deviceId: deviceId, token: token), forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = body
        }
        return r
    }

    func loadCloud() async {
        guard isLoggedIn, let req = prefsRequest() else { return }
        // Rôle admin à jour
        if let me = try? await jellyfin.me() { isAdmin = me.Policy?.IsAdministrator ?? isAdmin; save() }
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let prefs = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let custom = prefs["CustomPrefs"] as? [String: Any],
              let raw = custom["settings"] as? String,
              let obj = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any]
        else { cloudLoaded = true; return }
        apply(obj)
        if let data = try? JSONSerialization.data(withJSONObject: obj) { AppSession.store.set(data, forKey: "cloud.cache") }
        cloudLoaded = true
    }

    private func apply(_ obj: [String: Any]) {
        cloudRaw = obj
        tmdbKey = obj["tmdbKey"] as? String ?? tmdbKey
        if let chat = obj["chatUrl"] as? String, !chat.isEmpty { lumioURL = chat }
        liveLang = obj["liveLang"] as? String ?? liveLang
        quality = obj["quality"] as? String ?? quality
        liveFavorites = obj["liveFavorites"] as? [String] ?? liveFavorites
        if let s = obj["liveSources"], let d = try? JSONSerialization.data(withJSONObject: s),
           let v = try? JSONDecoder().decode([LiveSource].self, from: d) { liveSources = v }
        if let s = obj["liveVpn"], let d = try? JSONSerialization.data(withJSONObject: s),
           let v = try? JSONDecoder().decode(LiveVpn.self, from: d) { liveVpn = v }
    }

    /// Renvoie les réglages modifiés dans Jellyfin (l'appli Lumio habituelle les retrouve aussi).
    func saveCloud() {
        var obj = cloudRaw
        obj["tmdbKey"] = tmdbKey
        obj["chatUrl"] = lumioURL
        obj["liveLang"] = liveLang
        obj["quality"] = quality
        obj["liveFavorites"] = liveFavorites
        if let d = try? JSONEncoder().encode(liveSources), let v = try? JSONSerialization.jsonObject(with: d) { obj["liveSources"] = v }
        if let d = try? JSONEncoder().encode(liveVpn), let v = try? JSONSerialization.jsonObject(with: d) { obj["liveVpn"] = v }
        cloudRaw = obj
        save()
        guard let local = try? JSONSerialization.data(withJSONObject: obj) else { return }
        AppSession.store.set(local, forKey: "cloud.cache")
        Task {
            guard let get = prefsRequest() else { return }
            var prefs: [String: Any] = [:]
            if let (data, _) = try? await URLSession.shared.data(for: get),
               let cur = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { prefs = cur }
            var custom = prefs["CustomPrefs"] as? [String: Any] ?? [:]
            custom["settings"] = String(data: local, encoding: .utf8)
            custom["savedAt"] = ISO8601DateFormatter().string(from: Date())
            prefs["CustomPrefs"] = custom
            prefs["Id"] = "lumio"
            prefs["Client"] = "lumio"
            guard let body = try? JSONSerialization.data(withJSONObject: prefs), let post = prefsRequest("POST", body: body) else { return }
            _ = try? await URLSession.shared.data(for: post)
        }
    }
}

/// Petit accès au trousseau (le jeton Jellyfin n'est pas stocké en clair).
enum Keychain {
    private static let service = "lol.wawanono.lumio.swift"

    static func set(_ value: String, for key: String) {
        delete(key)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(q as CFDictionary)
    }
}
