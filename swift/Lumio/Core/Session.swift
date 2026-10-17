import Foundation
import Observation
import Security

/// Connexion Jellyfin + adresse du serveur Lumio, gardées sur l'appareil.
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

    var isLoggedIn: Bool { !token.isEmpty && !serverURL.isEmpty }

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
    }

    var jellyfin: JellyfinAPI { JellyfinAPI(session: self) }
    var lumio: LumioAPI { LumioAPI(session: self) }

    func login(server: String, user: String, password: String) async throws {
        let url = JellyfinAPI.normalize(server)
        let res = try await JellyfinAPI.authenticate(server: url, user: user, password: password, deviceId: deviceId)
        serverURL = url
        userId = res.User.Id
        userName = res.User.Name
        token = res.AccessToken
        isAdmin = res.User.Policy?.IsAdministrator ?? false
        save()
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
