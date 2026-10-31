// Connexion Jellyfin gardée sur le Mac (le jeton dans le trousseau, le reste dans les réglages).
import Foundation
import Security

@MainActor
final class Session: ObservableObject {
    @Published private(set) var client: JellyfinClient?
    @Published private(set) var userName: String = ""
    @Published var player: PlayRequest?
    @Published var lumioURL: String = UserDefaults.standard.string(forKey: "lumio.serverLumio") ?? "https://lumio.wawanono.lol"
    /// Clé TMDB donnée par le serveur Lumio (jamais écrite dans l'appli)
    @Published private(set) var tmdb: Tmdb?
    @Published var me: LumioMe?

    var lumio: LumioServer? {
        guard let client, let u = URL(string: lumioURL.trimmingCharacters(in: .whitespaces)) else { return nil }
        return LumioServer(base: u, jellyfin: client)
    }

    func setLumioURL(_ s: String) {
        var u = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while u.hasSuffix("/") { u.removeLast() }
        if !u.isEmpty, !u.lowercased().hasPrefix("http") { u = "https://" + u }
        lumioURL = u
        d.set(u, forKey: "lumio.serverLumio")
        tmdb = nil
        Task { await prepare() }
    }

    /// Clé TMDB et profil Lumio, chargés après la connexion
    func prepare() async {
        guard let l = lumio else { return }
        if tmdb == nil, let k = try? await l.tmdbKey(), !k.isEmpty { tmdb = Tmdb(key: k) }
        me = try? await l.me()
    }

    // Index TMDB → Jellyfin (pour « Lire » depuis une fiche TMDB)
    private var index: [String: String]?
    func jellyfinId(type: String, tmdbId: Int) async -> String? {
        if index == nil, let c = client { index = try? await c.providerIndex() }
        return index?["\(type):\(tmdbId)"]
    }
    func resetIndex() { index = nil }

    private let d = UserDefaults.standard

    init() {
        if let s = d.string(forKey: "lumio.server"), let base = URL(string: s),
           let uid = d.string(forKey: "lumio.userId"), let token = Keychain.read("lumio.token") {
            client = JellyfinClient(base: base, token: token, userId: uid)
            userName = d.string(forKey: "lumio.userName") ?? ""
        }
    }

    var lastServer: String { d.string(forKey: "lumio.server") ?? "https://jellyfin.wawanono.lol" }

    func login(server: String, user: String, password: String) async throws {
        var s = server.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        if !s.lowercased().hasPrefix("http") { s = "https://" + s }
        guard let base = URL(string: s) else { throw JFError.badURL }
        let auth = try await JellyfinClient(base: base).login(user: user, password: password)
        d.set(s, forKey: "lumio.server")
        d.set(auth.User.Id, forKey: "lumio.userId")
        d.set(auth.User.Name, forKey: "lumio.userName")
        Keychain.write("lumio.token", auth.AccessToken)
        userName = auth.User.Name
        client = JellyfinClient(base: base, token: auth.AccessToken, userId: auth.User.Id)
    }

    func logout() {
        Keychain.delete("lumio.token")
        d.removeObject(forKey: "lumio.userId")
        client = nil
        player = nil
        tmdb = nil
        me = nil
        index = nil
    }

    func play(_ item: JFItem, fromStart: Bool = false) {
        player = PlayRequest(item: item, fromStart: fromStart)
    }
}

struct PlayRequest: Identifiable, Equatable {
    let id = UUID()
    let item: JFItem
    let fromStart: Bool
}

enum Keychain {
    private static let service = "lol.wawanono.lumio.mac"

    static func read(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ key: String, _ value: String) {
        delete(key)
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: key, kSecValueData as String: Data(value.utf8)]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete(_ key: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: key]
        SecItemDelete(q as CFDictionary)
    }
}
