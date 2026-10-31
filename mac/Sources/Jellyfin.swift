// Client Jellyfin : connexion, bibliothèques, fiches, lecture et suivi de la progression.
import Foundation

struct JFItem: Codable, Identifiable, Hashable {
    let Id: String
    let Name: String?
    let kind: String?
    let Overview: String?
    let ProductionYear: Int?
    let RunTimeTicks: Int64?
    let SeriesId: String?
    let SeriesName: String?
    let SeasonId: String?
    let IndexNumber: Int?
    let ParentIndexNumber: Int?
    let CommunityRating: Double?
    let OfficialRating: String?
    let Genres: [String]?
    let CollectionType: String?
    let ImageTags: [String: String]?
    let BackdropImageTags: [String]?
    let ParentBackdropItemId: String?
    let ParentBackdropImageTags: [String]?
    let UserData: JFUserData?

    enum CodingKeys: String, CodingKey {
        case Id, Name, kind = "Type", Overview, ProductionYear, RunTimeTicks, SeriesId, SeriesName, SeasonId
        case IndexNumber, ParentIndexNumber, CommunityRating, OfficialRating, Genres, CollectionType
        case ImageTags, BackdropImageTags, ParentBackdropItemId, ParentBackdropImageTags, UserData
    }

    var id: String { Id }
    var title: String { Name ?? "Sans titre" }
    var isSeries: Bool { kind == "Series" }
    var isEpisode: Bool { kind == "Episode" }
    var isFolder: Bool { ["Series", "Season", "BoxSet", "Folder", "CollectionFolder"].contains(kind ?? "") }

    /// Pourcentage déjà vu (0…1), ou nil
    var progress: Double? {
        guard let p = UserData?.PlayedPercentage, p > 0 else { return nil }
        return min(1, p / 100)
    }

    var durationText: String? {
        guard let t = RunTimeTicks, t > 0 else { return nil }
        let min = Int(t / 600_000_000)
        return min >= 60 ? "\(min / 60) h \(String(format: "%02d", min % 60))" : "\(min) min"
    }

    var subtitle: String {
        if isEpisode {
            let se = [ParentIndexNumber.map { "S\($0)" }, IndexNumber.map { "É\($0)" }].compactMap { $0 }.joined()
            return [SeriesName, se.isEmpty ? nil : se].compactMap { $0 }.joined(separator: " · ")
        }
        return [ProductionYear.map(String.init), durationText].compactMap { $0 }.joined(separator: " · ")
    }
}

struct JFUserData: Codable, Hashable {
    let PlaybackPositionTicks: Int64?
    let PlayedPercentage: Double?
    let Played: Bool?
    let IsFavorite: Bool?
}

struct JFList: Codable { let Items: [JFItem]; let TotalRecordCount: Int? }

struct JFMediaSource: Codable {
    let Id: String
    let SupportsDirectPlay: Bool?
    let SupportsDirectStream: Bool?
    let TranscodingUrl: String?
    let Container: String?
}
struct JFPlaybackInfo: Codable { let MediaSources: [JFMediaSource]; let PlaySessionId: String? }

struct JFAuth: Codable {
    struct User: Codable { let Id: String; let Name: String }
    let User: User
    let AccessToken: String
}

enum JFError: LocalizedError {
    case http(Int, String)
    case badURL
    var errorDescription: String? {
        switch self {
        case .http(401, _): return "Identifiant ou mot de passe incorrect."
        case .http(let c, let m): return m.isEmpty ? "Le serveur a répondu \(c)." : m
        case .badURL: return "Adresse du serveur invalide."
        }
    }
}

final class JellyfinClient {
    let base: URL
    let token: String?
    let userId: String?
    static let deviceId: String = {
        let k = "lumio.mac.deviceId"
        if let v = UserDefaults.standard.string(forKey: k) { return v }
        let v = UUID().uuidString
        UserDefaults.standard.set(v, forKey: k)
        return v
    }()

    init(base: URL, token: String? = nil, userId: String? = nil) {
        self.base = base
        self.token = token
        self.userId = userId
    }

    private var authHeader: String {
        var h = "MediaBrowser Client=\"Lumio Mac\", Device=\"Mac\", DeviceId=\"\(Self.deviceId)\", Version=\"1.0\""
        if let token { h += ", Token=\"\(token)\"" }
        return h
    }

    func url(_ path: String, _ query: [String: String] = [:]) -> URL {
        var c = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { c.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        return c.url!
    }

    @discardableResult
    func request<T: Decodable>(_ path: String, query: [String: String] = [:], method: String = "GET", body: Any? = nil, as type: T.Type = T.self) async throws -> T {
        var r = URLRequest(url: url(path, query))
        r.httpMethod = method
        r.timeoutInterval = 30
        r.setValue(authHeader, forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, resp) = try await URLSession.shared.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            throw JFError.http(code, String(data: data, encoding: .utf8)?.prefix(200).description ?? "")
        }
        if T.self == Empty.self { return Empty() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }

    struct Empty: Decodable {}

    func send(_ path: String, body: Any) async {
        _ = try? await request(path, method: "POST", body: body, as: Empty.self)
    }

    // ——— Connexion ———
    func login(user: String, password: String) async throws -> JFAuth {
        try await request("Users/AuthenticateByName", method: "POST", body: ["Username": user, "Pw": password])
    }

    // ——— Listes ———
    private let fields = "Overview,Genres,ProductionYear,CommunityRating,OfficialRating,ParentId"

    func views() async throws -> [JFItem] {
        try await request("Users/\(userId!)/Views", as: JFList.self).Items
            .filter { ["movies", "tvshows", "homevideos", "boxsets"].contains($0.CollectionType ?? "") }
    }

    func resume() async throws -> [JFItem] {
        try await request("Users/\(userId!)/Items/Resume", query: ["Limit": "20", "MediaTypes": "Video", "Fields": fields, "EnableImageTypes": "Primary,Backdrop,Thumb"], as: JFList.self).Items
    }

    func nextUp() async throws -> [JFItem] {
        try await request("Shows/NextUp", query: ["UserId": userId!, "Limit": "20", "Fields": fields], as: JFList.self).Items
    }

    func latest(parent: String, types: String) async throws -> [JFItem] {
        try await request("Users/\(userId!)/Items/Latest", query: ["ParentId": parent, "Limit": "24", "Fields": fields, "IncludeItemTypes": types], as: [JFItem].self)
    }

    /// Titres d'une bibliothèque, du seul type de cette bibliothèque (films OU séries)
    func items(parent: String, types: String, sort: String = "SortName", order: String = "Ascending", start: Int = 0, limit: Int = 120) async throws -> JFList {
        try await request("Users/\(userId!)/Items", query: [
            "ParentId": parent, "Recursive": "true", "IncludeItemTypes": types,
            "SortBy": sort + ",SortName", "SortOrder": order, "StartIndex": String(start), "Limit": String(limit), "Fields": fields,
        ])
    }

    func itemsByIds(_ ids: [String]) async throws -> [JFItem] {
        guard !ids.isEmpty else { return [] }
        return try await request("Users/\(userId!)/Items", query: ["Ids": ids.joined(separator: ","), "Fields": fields, "SortBy": "PremiereDate"], as: JFList.self).Items
    }

    func search(_ term: String) async throws -> [JFItem] {
        try await request("Users/\(userId!)/Items", query: [
            "SearchTerm": term, "Recursive": "true", "IncludeItemTypes": "Movie,Series", "Limit": "60", "Fields": fields,
        ], as: JFList.self).Items
    }

    func item(_ id: String) async throws -> JFItem {
        try await request("Users/\(userId!)/Items/\(id)")
    }

    func seasons(series: String) async throws -> [JFItem] {
        try await request("Shows/\(series)/Seasons", query: ["UserId": userId!], as: JFList.self).Items
    }

    func episodes(series: String, season: String) async throws -> [JFItem] {
        try await request("Shows/\(series)/Episodes", query: ["UserId": userId!, "SeasonId": season, "Fields": "Overview"], as: JFList.self).Items
    }

    /// « movie:603 » / « tv:1399 » → identifiant Jellyfin, pour toute la bibliothèque
    func providerIndex() async throws -> [String: String] {
        struct Light: Decodable {
            let Id: String; let kind: String?; let ProviderIds: [String: String]?
            enum CodingKeys: String, CodingKey { case Id, kind = "Type", ProviderIds }
        }
        struct L: Decodable { let Items: [Light] }
        let all = try await request("Users/\(userId!)/Items", query: [
            "Recursive": "true", "IncludeItemTypes": "Movie,Series", "Fields": "ProviderIds", "EnableImages": "false",
        ], as: L.self).Items
        var out: [String: String] = [:]
        for i in all {
            guard let t = i.ProviderIds?["Tmdb"] ?? i.ProviderIds?["tmdb"] else { continue }
            out["\(i.kind == "Series" ? "tv" : "movie"):\(t)"] = i.Id
        }
        return out
    }

    // ——— Images ———
    func imageURL(_ item: JFItem, kind: String = "Primary", width: Int = 400) -> URL? {
        if kind == "Backdrop" {
            if item.BackdropImageTags?.isEmpty == false { return url("Items/\(item.Id)/Images/Backdrop", ["maxWidth": String(width), "quality": "85"]) }
            if let p = item.ParentBackdropItemId { return url("Items/\(p)/Images/Backdrop", ["maxWidth": String(width), "quality": "85"]) }
            if let s = item.SeriesId { return url("Items/\(s)/Images/Backdrop", ["maxWidth": String(width), "quality": "85"]) }
            return nil
        }
        if item.ImageTags?[kind] != nil { return url("Items/\(item.Id)/Images/\(kind)", ["maxWidth": String(width), "quality": "90"]) }
        if let s = item.SeriesId { return url("Items/\(s)/Images/Primary", ["maxWidth": String(width), "quality": "90"]) }
        return nil
    }

    // ——— Lecture ———
    /// Adresse à lire : le fichier tel quel si le Mac sait le lire, sinon un flux HLS préparé par Jellyfin.
    func playback(itemId: String, startTicks: Int64) async throws -> (url: URL, mediaSourceId: String, session: String?, method: String) {
        let profile: [String: Any] = [
            "MaxStreamingBitrate": 120_000_000,
            "DirectPlayProfiles": [
                ["Container": "mp4,m4v,mov", "Type": "Video", "VideoCodec": "h264,hevc", "AudioCodec": "aac,ac3,eac3,mp3,alac,flac"],
            ],
            "TranscodingProfiles": [
                ["Container": "mp4", "Type": "Video", "Protocol": "hls", "Context": "Streaming",
                 "VideoCodec": "h264,hevc", "AudioCodec": "aac,ac3,eac3", "MaxAudioChannels": "6",
                 "MinSegments": 1, "BreakOnNonKeyFrames": true],
            ],
            "SubtitleProfiles": [["Format": "vtt", "Method": "Hls"]],
            "CodecProfiles": [],
            "ContainerProfiles": [],
        ]
        let info: JFPlaybackInfo = try await request("Items/\(itemId)/PlaybackInfo", query: ["UserId": userId!], method: "POST", body: [
            "UserId": userId!, "DeviceProfile": profile, "StartTimeTicks": startTicks,
            "AutoOpenLiveStream": true, "EnableDirectPlay": true, "EnableDirectStream": true, "EnableTranscoding": true,
            "AllowVideoStreamCopy": true, "AllowAudioStreamCopy": true, "SubtitleStreamIndex": -1,
        ])
        guard let src = info.MediaSources.first else { throw JFError.http(404, "Aucune source vidéo") }
        if src.SupportsDirectPlay == true {
            let u = url("Videos/\(itemId)/stream", ["static": "true", "MediaSourceId": src.Id, "api_key": token ?? "", "DeviceId": Self.deviceId])
            return (u, src.Id, info.PlaySessionId, "DirectPlay")
        }
        guard let t = src.TranscodingUrl, let u = URL(string: t, relativeTo: base) else {
            throw JFError.http(415, "Ce fichier ne peut pas être lu sur le Mac")
        }
        return (u.absoluteURL, src.Id, info.PlaySessionId, "Transcode")
    }

    func reportStart(_ itemId: String, source: String, session: String?, ticks: Int64, method: String) async {
        await send("Sessions/Playing", body: ["ItemId": itemId, "MediaSourceId": source, "PlaySessionId": session ?? "", "PositionTicks": ticks, "PlayMethod": method, "CanSeek": true])
    }
    func reportProgress(_ itemId: String, source: String, session: String?, ticks: Int64, paused: Bool, method: String) async {
        await send("Sessions/Playing/Progress", body: ["ItemId": itemId, "MediaSourceId": source, "PlaySessionId": session ?? "", "PositionTicks": ticks, "IsPaused": paused, "PlayMethod": method, "CanSeek": true])
    }
    func reportStop(_ itemId: String, source: String, session: String?, ticks: Int64) async {
        await send("Sessions/Playing/Stopped", body: ["ItemId": itemId, "MediaSourceId": source, "PlaySessionId": session ?? "", "PositionTicks": ticks])
    }
}
