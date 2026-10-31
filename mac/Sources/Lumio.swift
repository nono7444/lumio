// Serveur Lumio (demandes, À voir, chat, collections, plateformes, rangs) et TMDB (fiches, recherche, agenda).
import Foundation

// ——— Modèles du serveur Lumio ———

enum MediaStatus {
    static let unknown = 1, pending = 2, processing = 3, partial = 4, available = 5
    static func label(_ s: Int?) -> String? {
        switch s {
        case available: return "Disponible"
        case partial: return "En partie disponible"
        case processing: return "En cours"
        case pending: return "Demandé"
        default: return nil
        }
    }
}

struct LumioUser: Codable, Hashable { let id: String; let name: String }

struct ReqDownload: Codable, Hashable {
    let state: String?
    let progress: Double?
    let via: String?
    let message: String?
}

struct LumioRequest: Codable, Identifiable, Hashable {
    let id: String
    let type: String
    let tmdbId: Int
    let title: String
    let year: String?
    let poster: String?
    let backdrop: String?
    let seasons: [Int]?
    let status: Int
    let requestedBy: LumioUser
    let createdAt: String
    let reason: String?
    let error: String?
    let mediaStatus: Int?
    let download: ReqDownload?

    var statusLabel: String {
        if mediaStatus == MediaStatus.available { return "Disponible" }
        if let d = download {
            switch d.state {
            case "downloading": return d.progress.map { "Téléchargement \(Int($0 * 100)) %" } ?? "Téléchargement"
            case "importing": return "Import"
            case "searching": return "Recherche"
            case "warning": return d.message ?? "Problème"
            case "partial": return "En partie disponible"
            default: break
            }
        }
        switch status {
        case 1: return "En attente"
        case 2: return "Approuvée"
        case 3: return "Refusée"
        case 4: return "Échec"
        case 5: return "Terminée"
        default: return "—"
        }
    }
}

struct RequestList: Codable { let total: Int; let results: [LumioRequest] }

struct MediaInfo: Codable {
    struct SeasonState: Codable, Hashable { let seasonNumber: Int; let status: Int; let have: Int?; let total: Int? }
    let status: Int
    let seasons: [SeasonState]
    let requests: [LumioRequest]
}

struct LumioMe: Codable {
    struct Quota: Codable { let limit: Int; let days: Int; let used: Int; let remaining: Int? }
    struct Quotas: Codable { let movie: Quota; let tv: Quota }
    let id: String
    let name: String
    let admin: Bool
    let quota: Quotas?
}

struct WatchItem: Codable, Identifiable, Hashable {
    let type: String
    let tmdbId: Int
    let title: String
    let year: String?
    let poster: String?
    let backdrop: String?
    let addedAt: String?
    let status: Int?
    let digital: String?
    var id: String { "\(type):\(tmdbId)" }
}

struct ChatMessage: Codable, Identifiable, Hashable {
    let id: String
    let kind: String?
    let userId: String
    let userName: String
    let admin: Bool?
    let text: String
    let createdAt: String
}

struct LumioCollection: Codable, Identifiable, Hashable {
    struct Entry: Codable, Hashable { let jfId: String; let tmdbId: Int; let title: String; let year: Int? }
    let id: Int
    let name: String
    let overview: String?
    let poster: String?
    let backdrop: String?
    let total: Int
    let items: [Entry]
}

struct PlatformInfo: Codable, Identifiable, Hashable { let id: String; let name: String; let logo: String? }

struct PlatformTitle: Codable, Identifiable, Hashable {
    let type: String
    let tmdbId: Int
    let title: String
    let year: String?
    let date: String?
    let poster: String?
    let available: Bool
    var id: String { "\(type):\(tmdbId)" }
}

struct PlatformPage: Codable {
    let id: String
    let name: String
    let logo: String?
    let items: [PlatformTitle]?
    let library: [PlatformTitle]
    let latest: [PlatformTitle]
}

struct Grade: Codable, Hashable {
    struct Bonus: Codable, Hashable { let movies: Int; let seasons: Int }
    let name: String
    let emoji: String?
    let min: Int
    let tier: Int?
    let bonus: Bonus?
}

struct RankRow: Codable, Identifiable, Hashable {
    struct Badge: Codable, Hashable { let id: String; let emoji: String; let name: String; let desc: String }
    let id: String
    let name: String
    let hours: Int
    let movies: Int
    let episodes: Int
    let likes: Int
    let ratings: Int
    let requests: Int
    let messages: Int
    let watchlist: Int
    let points: Int
    let rank: Int
    let grade: Grade
    let next: Grade?
    let badges: [Badge]?
}

struct RewardsBoard: Codable { let users: [RankRow]; let grades: [Grade]; let me: String }

// ——— Client du serveur Lumio ———

final class LumioServer {
    let base: URL
    let jellyfin: JellyfinClient

    init(base: URL, jellyfin: JellyfinClient) {
        self.base = base
        self.jellyfin = jellyfin
    }

    struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }
    struct Nothing: Decodable {}

    func call<T: Decodable>(_ path: String, method: String = "GET", body: Any? = nil, as type: T.Type = T.self) async throws -> T {
        guard let url = URL(string: base.absoluteString + path) else { throw Failure(message: "Adresse invalide") }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.timeoutInterval = 30
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue(jellyfin.token ?? "", forHTTPHeaderField: "X-Jellyfin-Token")
        r.setValue(jellyfin.base.absoluteString, forHTTPHeaderField: "X-Jellyfin-Url")
        if let body {
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, resp) = try await URLSession.shared.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Failure(message: msg ?? "Serveur Lumio : HTTP \(code)")
        }
        if T.self == Nothing.self || data.isEmpty { return Nothing() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func me() async throws -> LumioMe { try await call("/api/me") }
    func tmdbKey() async throws -> String? {
        struct K: Decodable { let key: String? }
        return try await call("/api/config/tmdb", as: K.self).key
    }
    func media(type: String, tmdbId: Int) async throws -> MediaInfo { try await call("/api/media?type=\(type)&tmdbId=\(tmdbId)") }
    func library() async throws -> (movies: [String: Int], series: [String: Int]) {
        struct L: Decodable { let movies: [String: Int]; let series: [String: Int] }
        let l = try await call("/api/library", as: L.self)
        return (l.movies, l.series)
    }
    func requests(filter: String, mine: Bool) async throws -> RequestList {
        try await call("/api/requests?filter=\(filter)&take=60&skip=0&sort=added\(mine ? "&mine=1" : "")")
    }
    func request(type: String, tmdbId: Int, title: String, year: String?, poster: String?, backdrop: String?, seasons: [Int]?) async throws {
        var b: [String: Any] = ["type": type, "tmdbId": tmdbId, "title": title]
        if let year { b["year"] = year }
        if let poster { b["poster"] = poster }
        if let backdrop { b["backdrop"] = backdrop }
        if let seasons { b["seasons"] = seasons }
        _ = try await call("/api/requests", method: "POST", body: b, as: Nothing.self)
    }
    func act(_ id: String, _ action: String, body: [String: Any] = [:]) async throws {
        _ = try await call("/api/requests/\(id)/\(action)", method: "POST", body: body, as: Nothing.self)
    }
    func deleteRequest(_ id: String) async throws {
        _ = try await call("/api/requests/\(id)", method: "DELETE", as: Nothing.self)
    }
    func watchlist() async throws -> [WatchItem] {
        struct W: Decodable { let items: [WatchItem] }
        return try await call("/api/watchlist", as: W.self).items
    }
    func addWatch(type: String, tmdbId: Int, title: String, year: String?, poster: String?, backdrop: String?) async throws {
        var b: [String: Any] = ["type": type, "tmdbId": tmdbId, "title": title, "addedAt": ISO8601DateFormatter().string(from: Date())]
        if let year { b["year"] = year }
        if let poster { b["poster"] = poster }
        if let backdrop { b["backdrop"] = backdrop }
        _ = try await call("/api/watchlist", method: "POST", body: b, as: Nothing.self)
    }
    func removeWatch(type: String, tmdbId: Int) async throws {
        _ = try await call("/api/watchlist?type=\(type)&tmdbId=\(tmdbId)", method: "DELETE", as: Nothing.self)
    }
    func messages() async throws -> [ChatMessage] {
        struct M: Decodable { let messages: [ChatMessage] }
        return try await call("/api/messages", as: M.self).messages
    }
    func send(_ text: String) async throws {
        _ = try await call("/api/messages", method: "POST", body: ["text": text], as: Nothing.self)
    }
    func collections() async throws -> [LumioCollection] {
        struct C: Decodable { let collections: [LumioCollection] }
        return try await call("/api/collections", as: C.self).collections
    }
    func platforms() async throws -> [PlatformInfo] {
        struct P: Decodable { let platforms: [PlatformInfo] }
        return try await call("/api/platforms", as: P.self).platforms
    }
    func platform(_ id: String, sort: String) async throws -> PlatformPage { try await call("/api/platforms/\(id)?sort=\(sort)") }
    func rewards() async throws -> RewardsBoard { try await call("/api/rewards") }
}

// ——— TMDB (clé partagée par le serveur Lumio) ———

struct TmdbItem: Codable, Identifiable, Hashable {
    let id: Int
    let media_type: String?
    let title: String?
    let name: String?
    let poster_path: String?
    let backdrop_path: String?
    let release_date: String?
    let first_air_date: String?
    let overview: String?
    let vote_average: Double?

    var displayTitle: String { title ?? name ?? "" }
    var year: String? { (release_date ?? first_air_date).flatMap { $0.count >= 4 ? String($0.prefix(4)) : nil } }
    var poster: URL? { Tmdb.image(poster_path, "w342") }
}

struct TmdbDetail: Codable {
    struct Genre: Codable { let name: String }
    struct Season: Codable, Hashable { let season_number: Int; let name: String?; let episode_count: Int? }
    struct Video: Codable { let key: String; let site: String; let type: String }
    struct Videos: Codable { let results: [Video] }
    struct Credits: Codable { struct Cast: Codable, Hashable { let name: String; let character: String?; let profile_path: String? }; let cast: [Cast] }
    struct ExternalIds: Codable { let tvdb_id: Int?; let imdb_id: String? }
    let id: Int
    let title: String?
    let name: String?
    let overview: String?
    let poster_path: String?
    let backdrop_path: String?
    let release_date: String?
    let first_air_date: String?
    let runtime: Int?
    let episode_run_time: [Int]?
    let vote_average: Double?
    let genres: [Genre]?
    let seasons: [Season]?
    let number_of_seasons: Int?
    let tagline: String?
    let videos: Videos?
    let credits: Credits?
    let external_ids: ExternalIds?
    let imdb_id: String?

    var displayTitle: String { title ?? name ?? "" }
    var year: String? { (release_date ?? first_air_date).flatMap { $0.count >= 4 ? String($0.prefix(4)) : nil } }
    var trailer: URL? {
        guard let v = videos?.results.first(where: { $0.site == "YouTube" && $0.type == "Trailer" }) ?? videos?.results.first(where: { $0.site == "YouTube" }) else { return nil }
        return URL(string: "https://www.youtube.com/watch?v=\(v.key)")
    }
}

struct CalendarEntry: Identifiable, Hashable {
    let id: String
    let tmdbId: Int
    let type: String
    let title: String
    let poster: URL?
    let date: Date
    let info: String
}

final class Tmdb {
    let key: String
    init(key: String) { self.key = key }

    static func image(_ path: String?, _ size: String) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/\(size)\(path)")
    }

    func get<T: Decodable>(_ path: String, _ params: [String: String] = [:], as type: T.Type = T.self) async throws -> T {
        var c = URLComponents(string: "https://api.themoviedb.org/3\(path)")!
        var q = params.merging(["language": "fr-FR"]) { a, _ in a }
        let v4 = key.hasPrefix("eyJ")
        if !v4 { q["api_key"] = key }
        c.queryItems = q.map { URLQueryItem(name: $0.key, value: $0.value) }
        var r = URLRequest(url: c.url!)
        if v4 { r.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        let (data, resp) = try await URLSession.shared.data(for: r)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw LumioServer.Failure(message: "TMDB ne répond pas") }
        return try JSONDecoder().decode(T.self, from: data)
    }

    struct Page: Decodable { let results: [TmdbItem] }

    func search(_ q: String) async throws -> [TmdbItem] {
        try await get("/search/multi", ["query": q, "include_adult": "false"], as: Page.self).results
            .filter { $0.media_type == "movie" || $0.media_type == "tv" }
    }

    func trending() async throws -> [TmdbItem] {
        try await get("/trending/all/week", as: Page.self).results.filter { $0.media_type == "movie" || $0.media_type == "tv" }
    }

    func detail(type: String, id: Int) async throws -> TmdbDetail {
        try await get("/\(type)/\(id)", ["append_to_response": "videos,credits,external_ids", "include_video_language": "fr,en"])
    }

    /// Agenda : films qui sortent en numérique et nouvelles saisons, de J-7 à J+45.
    func calendar() async throws -> [CalendarEntry] {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        let from = Calendar.current.date(byAdding: .day, value: -7, to: Date())!
        let to = Calendar.current.date(byAdding: .day, value: 45, to: Date())!
        var out: [CalendarEntry] = []
        for page in 1...3 {
            let movies = try? await get("/discover/movie", ["region": "FR", "with_release_type": "4", "release_date.gte": f.string(from: from), "release_date.lte": f.string(from: to), "sort_by": "popularity.desc", "page": String(page)], as: Page.self)
            for m in movies?.results ?? [] {
                if let d = m.release_date.flatMap(f.date(from:)) {
                    out.append(CalendarEntry(id: "movie:\(m.id)", tmdbId: m.id, type: "movie", title: m.displayTitle, poster: m.poster, date: d, info: "Sortie numérique"))
                }
            }
        }
        for page in 1...2 {
            let tv = try? await get("/discover/tv", ["air_date.gte": f.string(from: from), "air_date.lte": f.string(from: to), "with_original_language": "en|fr|ja|ko|es", "without_genres": "10767|10763|10766", "sort_by": "popularity.desc", "page": String(page)], as: Page.self)
            for s in tv?.results ?? [] {
                if let d = s.first_air_date.flatMap(f.date(from:)), d >= from {
                    out.append(CalendarEntry(id: "tv:\(s.id)", tmdbId: s.id, type: "tv", title: s.displayTitle, poster: s.poster, date: d, info: "Nouvelle série"))
                }
            }
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0.id).inserted }.sorted { $0.date < $1.date }
    }
}
