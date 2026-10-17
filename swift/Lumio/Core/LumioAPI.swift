import Foundation

// ——— Serveur Lumio : demandes, chat, notes, idées & signalements, admin ———

struct Person: Codable, Hashable { let id: String; let name: String }

struct LumioRequest: Codable, Identifiable, Hashable {
    struct Download: Codable, Hashable {
        var state: String
        var progress: Double?
        var message: String?
    }
    struct SeasonStatus: Codable, Hashable { let seasonNumber: Int; let status: Int }
    let id: String
    let type: String
    let tmdbId: Int
    var tvdbId: Int?
    var title: String
    var year: String?
    var poster: String?
    var seasons: [Int]?
    var status: Int
    var requestedBy: Person
    var createdAt: String
    var modifiedBy: Person?
    var reason: String?
    var error: String?
    var mediaStatus: Int?
    var download: Download?

    var statusLabel: (String, String) {
        switch status {
        case 1: return ("En attente", "#FF9F0A")
        case 2: return ("Approuvée", "#3D8BFF")
        case 3: return ("Refusée", "#FF453A")
        case 4: return ("Échec", "#FF453A")
        case 5: return ("Disponible", "#30D158")
        default: return ("—", "#8E8E93")
        }
    }
}

struct LumioRequestList: Codable {
    struct Counts: Codable { var pending: Int? }
    var total: Int?
    var counts: Counts?
    var results: [LumioRequest]
}

struct MediaInfo: Codable {
    struct Season: Codable, Hashable { let seasonNumber: Int; let status: Int }
    var status: Int
    var seasons: [Season]
    var requests: [LumioRequest]
}

struct LumioMe: Codable {
    struct Quota: Codable { var limit: Int; var days: Int; var used: Int; var remaining: Int? }
    struct Quotas: Codable { var movie: Quota; var tv: Quota }
    let id: String
    let name: String
    let admin: Bool
    var quota: Quotas?
}

struct ServerFolder: Codable, Hashable, Identifiable {
    let path: String
    var freeSpace: Double?
    var id: String { path }
    var name: String { path.split(separator: "/").last.map(String.init) ?? path }
}

struct ArrOptions: Codable {
    struct Profile: Codable, Hashable { let id: Int; let name: String }
    var folders: [ServerFolder]
    var `default`: String?
    var profiles: [Profile]?
    var defaultProfile: Int?
    var lockedProfile: Profile?
}

struct ChatMedia: Codable, Hashable { let type: String; let tmdbId: Int; let title: String; var year: String?; var poster: String? }
struct ChatMessage: Codable, Identifiable, Hashable {
    let id: String
    var kind: String?
    let userId: String
    let userName: String
    var admin: Bool?
    var text: String
    var media: ChatMedia?
    let createdAt: String
}
struct ChatMe: Codable { let id: String; let name: String; let admin: Bool }
struct ChatList: Codable { var me: ChatMe; var messages: [ChatMessage] }
struct ChatLatest: Codable { var id: String?; var at: String?; var from: String? }

struct RatingInfo: Codable {
    struct Mine: Codable { var stars: Int; var comment: String }
    struct Vote: Codable, Hashable { let name: String; let stars: Int; var comment: String?; let at: String; let mine: Bool }
    var avg: Double?
    var count: Int
    var mine: Mine?
    var list: [Vote]
}
struct RatingSummary: Codable, Hashable { let avg: Double; let count: Int }
struct TopRated: Codable, Identifiable, Hashable {
    let type: String; let tmdbId: Int; var title: String?; var poster: String?; let count: Int; let avg: Double
    var id: String { "\(type):\(tmdbId)" }
}

struct Idea: Codable, Identifiable, Hashable {
    struct Media: Codable, Hashable { let type: String; let tmdbId: Int; let title: String; var poster: String? }
    let id: String
    let kind: String
    var title: String
    var details: String
    var status: String
    var note: String?
    var createdBy: Person
    var createdAt: String
    var votes: Int
    var voted: Bool
    var mine: Bool
    var media: Media?
    var category: String?

    static let statuses: [(String, String, String)] = [
        ("new", "Nouvelle", "#64D2FF"), ("planned", "Prévue", "#FFB340"), ("sent", "Chez Claude", "#D97757"),
        ("done", "Faite", "#30D158"), ("rejected", "Écartée", "#8E8E93"),
    ]
    var statusInfo: (String, String) {
        let s = Idea.statuses.first { $0.0 == status } ?? ("", status, "#8E8E93")
        return (s.1, s.2)
    }
}

struct AdminUser: Codable, Identifiable, Hashable {
    struct Perms: Codable, Hashable { var autoApprove: Bool; var movieQuotaLimit: Int; var movieQuotaDays: Int; var tvQuotaLimit: Int; var tvQuotaDays: Int }
    let id: String
    let name: String
    let admin: Bool
    var permissions: Perms
    var requestCount: Int
}
struct AdminUsers: Codable { var users: [AdminUser] }

struct LumioAPI {
    let base: String
    let token: String

    @MainActor
    init(session: AppSession) {
        base = JellyfinAPI.normalize(session.lumioURL)
        token = session.token
    }

    private func call(_ path: String, method: String = "GET", body: Any? = nil) async throws -> Data {
        guard !base.isEmpty, let url = URL(string: base + path) else { throw APIError(message: "Serveur Lumio non configuré (Profil)") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(token, forHTTPHeaderField: "X-Jellyfin-Token")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let e = obj["error"] as? String { throw APIError(message: e) }
            throw APIError(message: "Serveur Lumio : erreur \(code)")
        }
        return data
    }

    private func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await call(path))
    }

    private func send<T: Decodable>(_ path: String, method: String = "POST", body: Any = [String: Any](), as type: T.Type = T.self) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await call(path, method: method, body: body))
    }

    // Demandes
    func me() async throws -> LumioMe { try await get("/api/me") }
    func requests(filter: String = "all", skip: Int = 0) async throws -> LumioRequestList {
        try await get("/api/requests?filter=\(filter)&take=40&skip=\(skip)&sort=added")
    }
    func media(type: String, tmdbId: Int, tvdbId: Int?, seasons: [Int]) async throws -> MediaInfo {
        var p = "/api/media?type=\(type)&tmdbId=\(tmdbId)"
        if let tvdbId { p += "&tvdbId=\(tvdbId)" }
        if !seasons.isEmpty { p += "&seasons=\(seasons.map { String($0) }.joined(separator: ","))" }
        return try await get(p)
    }
    func library() async throws -> [String: [String: Int]] { try await get("/api/library") }
    func options(type: String) async throws -> ArrOptions { try await get("/api/arr/options?type=\(type)") }
    func create(_ body: [String: Any]) async throws -> LumioRequest { try await send("/api/requests", body: body) }
    func approve(_ id: String) async throws { _ = try await call("/api/requests/\(id)/approve", method: "POST", body: [String: Any]()) }
    func retry(_ id: String) async throws { _ = try await call("/api/requests/\(id)/retry", method: "POST", body: [String: Any]()) }
    func decline(_ id: String, reason: String?) async throws {
        _ = try await call("/api/requests/\(id)/decline", method: "POST", body: ["reason": reason ?? ""])
    }
    func remove(_ id: String) async throws { _ = try await call("/api/requests/\(id)", method: "DELETE") }

    // Chat
    func messages(after: String?) async throws -> ChatList {
        try await get("/api/messages" + (after.map { "?after=\($0)" } ?? ""))
    }
    func latest() async throws -> ChatLatest { try await get("/api/latest") }
    func sendMessage(_ text: String, media: ChatMedia? = nil) async throws -> ChatMessage {
        var body: [String: Any] = ["text": text]
        if let media, let d = try? JSONEncoder().encode(media), let o = try? JSONSerialization.jsonObject(with: d) { body["media"] = o }
        return try await send("/api/messages", body: body)
    }
    func deleteMessage(_ id: String) async throws { _ = try await call("/api/messages/\(id)", method: "DELETE") }

    // Notes de la famille
    func rating(type: String, tmdbId: Int) async throws -> RatingInfo { try await get("/api/ratings?type=\(type)&tmdbId=\(tmdbId)") }
    func rate(type: String, tmdbId: Int, stars: Int, comment: String?, title: String, poster: String?) async throws {
        var b: [String: Any] = ["type": type, "tmdbId": tmdbId, "stars": stars, "title": title]
        if let comment { b["comment"] = comment }
        if let poster { b["poster"] = poster }
        _ = try await call("/api/ratings", method: "POST", body: b)
    }
    func ratingSummary() async throws -> [String: RatingSummary] {
        struct R: Codable { var items: [String: RatingSummary] }
        return try await get("/api/ratings/summary", as: R.self).items
    }
    func topRated() async throws -> [TopRated] {
        struct R: Codable { var items: [TopRated] }
        return try await get("/api/ratings/top", as: R.self).items
    }

    // Idées & signalements
    func ideas() async throws -> [Idea] {
        struct R: Codable { var ideas: [Idea] }
        return try await get("/api/ideas", as: R.self).ideas
    }
    func createIdea(kind: String, title: String, details: String, category: String? = nil, media: Idea.Media? = nil) async throws {
        var b: [String: Any] = ["kind": kind, "title": title, "details": details]
        if let category { b["category"] = category }
        if let media { b["media"] = ["type": media.type, "tmdbId": media.tmdbId, "title": media.title, "poster": media.poster ?? ""] }
        _ = try await call("/api/ideas", method: "POST", body: b)
    }
    func vote(_ id: String) async throws { _ = try await call("/api/ideas/\(id)/vote", method: "POST", body: [String: Any]()) }
    func setIdeaStatus(_ id: String, _ status: String) async throws { _ = try await call("/api/ideas/\(id)", method: "PUT", body: ["status": status]) }
    func deleteIdea(_ id: String) async throws { _ = try await call("/api/ideas/\(id)", method: "DELETE") }

    // Admin
    func users() async throws -> [AdminUser] { try await get("/api/admin/users", as: AdminUsers.self).users }
    func updateUser(_ id: String, _ patch: [String: Any]) async throws { _ = try await call("/api/admin/users/\(id)", method: "PUT", body: patch) }
}
