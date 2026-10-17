import Foundation

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Appels à Jellyfin (même logique que l'appli actuelle : src/lib/jellyfin.ts).
struct JellyfinAPI {
    let base: String
    let userId: String
    let token: String
    let deviceId: String

    @MainActor
    init(session: AppSession) {
        base = session.serverURL
        userId = session.userId
        token = session.token
        deviceId = session.deviceId
    }

    static let fields = "PrimaryImageAspectRatio,ProductionYear,Overview,Genres,ProviderIds,CommunityRating,OfficialRating,ChildCount,PremiereDate"

    static var deviceName: String {
        #if os(macOS)
        return "Mac"
        #else
        return "iPhone"
        #endif
    }

    static func normalize(_ raw: String) -> String {
        var u = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while u.hasSuffix("/") { u.removeLast() }
        if !u.isEmpty && !u.lowercased().hasPrefix("http") { u = "https://" + u }
        return u
    }

    static func authHeader(deviceId: String, token: String?) -> String {
        var h = "MediaBrowser Client=\"Lumio Swift\", Device=\"\(deviceName)\", DeviceId=\"\(deviceId)\", Version=\"0.1.0\""
        if let token, !token.isEmpty { h += ", Token=\"\(token)\"" }
        return h
    }

    static let decoder = JSONDecoder()

    static func authenticate(server: String, user: String, password: String, deviceId: String) async throws -> JfAuthResponse {
        guard let url = URL(string: "\(server)/Users/AuthenticateByName") else { throw APIError(message: "Adresse du serveur invalide") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(authHeader(deviceId: deviceId, token: nil), forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["Username": user, "Pw": password])
        let (data, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { throw APIError(message: "Nom d'utilisateur ou mot de passe incorrect") }
        guard (200..<300).contains(code) else { throw APIError(message: "Le serveur a répondu \(code)") }
        return try decoder.decode(JfAuthResponse.self, from: data)
    }

    // ——— Requêtes ———

    private func request(_ path: String, method: String = "GET", body: Any? = nil) async throws -> Data {
        guard let url = URL(string: base + path) else { throw APIError(message: "Adresse invalide") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue(JellyfinAPI.authHeader(deviceId: deviceId, token: token), forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { throw APIError(message: "Session Jellyfin expirée : reconnecte-toi") }
        guard (200..<300).contains(code) else { throw APIError(message: "Jellyfin a répondu \(code)") }
        return data
    }

    private func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try JellyfinAPI.decoder.decode(T.self, from: try await request(path))
    }

    // ——— Bibliothèque ———

    func views() async throws -> [JfItem] {
        try await get("/Users/\(userId)/Views", as: JfItemsResponse.self).Items
            .filter { ["movies", "tvshows", "boxsets", "homevideos", "mixed", nil].contains($0.CollectionType) }
    }

    func latest(parentId: String, limit: Int = 30) async throws -> [JfItem] {
        try await get("/Users/\(userId)/Items/Latest?ParentId=\(parentId)&Limit=\(limit)&Fields=\(JellyfinAPI.fields)&GroupItems=true")
    }

    func resume() async throws -> [JfItem] {
        try await get("/Users/\(userId)/Items/Resume?Limit=20&MediaTypes=Video&Fields=\(JellyfinAPI.fields)", as: JfItemsResponse.self).Items
    }

    func nextUp() async throws -> [JfItem] {
        try await get("/Shows/NextUp?UserId=\(userId)&Limit=20&Fields=\(JellyfinAPI.fields)", as: JfItemsResponse.self).Items
    }

    /// Contenu d'une bibliothèque, du plus récent au plus ancien (date de sortie).
    func items(parentId: String, start: Int = 0, limit: Int = 60) async throws -> JfItemsResponse {
        try await get("/Users/\(userId)/Items?ParentId=\(parentId)&Recursive=true&IncludeItemTypes=Movie,Series,BoxSet&SortBy=PremiereDate,SortName&SortOrder=Descending&StartIndex=\(start)&Limit=\(limit)&Fields=\(JellyfinAPI.fields)")
    }

    func item(_ id: String) async throws -> JfItem {
        try await get("/Users/\(userId)/Items/\(id)?Fields=\(JellyfinAPI.fields)")
    }

    func seasons(seriesId: String) async throws -> [JfItem] {
        try await get("/Shows/\(seriesId)/Seasons?UserId=\(userId)&Fields=\(JellyfinAPI.fields)", as: JfItemsResponse.self).Items
    }

    func episodes(seriesId: String, seasonId: String) async throws -> [JfItem] {
        try await get("/Shows/\(seriesId)/Episodes?UserId=\(userId)&SeasonId=\(seasonId)&Fields=\(JellyfinAPI.fields)", as: JfItemsResponse.self).Items
    }

    func search(_ term: String) async throws -> [JfItem] {
        let q = term.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? term
        return try await get("/Users/\(userId)/Items?SearchTerm=\(q)&Recursive=true&IncludeItemTypes=Movie,Series&Limit=60&Fields=\(JellyfinAPI.fields)", as: JfItemsResponse.self).Items
    }

    func me() async throws -> JfAuthUser {
        try await get("/Users/Me")
    }

    func favorites() async throws -> [JfItem] {
        try await get("/Users/\(userId)/Items?Recursive=true&Filters=IsFavorite&IncludeItemTypes=Movie,Series&Fields=\(JellyfinAPI.fields)", as: JfItemsResponse.self).Items
    }

    /// Requête libre (recommandations) : types, filtres, tri.
    func query(types: String, filters: String? = nil, sort: String, order: String = "Descending", limit: Int) async throws -> [JfItem] {
        var p = "/Users/\(userId)/Items?Recursive=true&IncludeItemTypes=\(types)&SortBy=\(sort)&SortOrder=\(order)&Limit=\(limit)&Fields=\(JellyfinAPI.fields)"
        if let filters { p += "&Filters=\(filters)" }
        return try await get(p, as: JfItemsResponse.self).Items
    }

    /// Titre Jellyfin correspondant à un identifiant TMDB (pour « Lire » depuis une fiche TMDB).
    func findByTmdb(_ tmdbId: Int, type: String) async throws -> JfItem? {
        let t = type == "tv" ? "Series" : "Movie"
        return try await get("/Users/\(userId)/Items?Recursive=true&IncludeItemTypes=\(t)&AnyProviderIdEquals=tmdb.\(tmdbId)&Limit=1&Fields=\(JellyfinAPI.fields)", as: JfItemsResponse.self).Items.first
    }

    /// Épisode suivant d'une série (pour l'enchaînement automatique).
    func episodeAfter(_ ep: JfItem) async -> JfItem? {
        guard let sid = ep.SeriesId else { return nil }
        let all = (try? await get("/Shows/\(sid)/Episodes?UserId=\(userId)&Fields=\(JellyfinAPI.fields)", as: JfItemsResponse.self).Items) ?? []
        guard let i = all.firstIndex(where: { $0.Id == ep.Id }), i + 1 < all.count else { return nil }
        return all[i + 1]
    }

    /// Sessions de lecture actives (admin : qui regarde quoi).
    func sessions() async throws -> [JfSession] {
        try await get("/Sessions?ActiveWithinSeconds=900")
    }

    func setPlayed(_ id: String, _ played: Bool) async throws {
        _ = try await request("/Users/\(userId)/PlayedItems/\(id)", method: played ? "POST" : "DELETE")
    }

    func setFavorite(_ id: String, _ fav: Bool) async throws {
        _ = try await request("/Users/\(userId)/FavoriteItems/\(id)", method: fav ? "POST" : "DELETE")
    }

    // ——— Images ———

    func posterURL(_ item: JfItem, height: Int = 450) -> URL? {
        if let tag = item.ImageTags?["Primary"] {
            return URL(string: "\(base)/Items/\(item.Id)/Images/Primary?maxHeight=\(height)&quality=90&tag=\(tag)")
        }
        if let sid = item.SeriesId { return URL(string: "\(base)/Items/\(sid)/Images/Primary?maxHeight=\(height)&quality=90") }
        return nil
    }

    func backdropURL(_ item: JfItem, width: Int = 1280) -> URL? {
        if let tag = item.BackdropImageTags?.first {
            return URL(string: "\(base)/Items/\(item.Id)/Images/Backdrop/0?maxWidth=\(width)&quality=85&tag=\(tag)")
        }
        if let pid = item.ParentBackdropItemId, let tag = item.ParentBackdropImageTags?.first {
            return URL(string: "\(base)/Items/\(pid)/Images/Backdrop/0?maxWidth=\(width)&quality=85&tag=\(tag)")
        }
        return posterURL(item, height: 900)
    }

    func thumbURL(_ item: JfItem, width: Int = 600) -> URL? {
        if let tag = item.ImageTags?["Primary"], item.isEpisode {
            return URL(string: "\(base)/Items/\(item.Id)/Images/Primary?maxWidth=\(width)&quality=85&tag=\(tag)")
        }
        return backdropURL(item, width: width)
    }

    // ——— Lecture ———

    /// Profil AVPlayer : MP4 / MOV lus directement (H.264, HEVC), le reste converti en HLS par le serveur.
    static let deviceProfile: [String: Any] = [
        "Name": "Lumio Swift",
        "MaxStreamingBitrate": 120_000_000,
        "MaxStaticBitrate": 120_000_000,
        "MusicStreamingTranscodingBitrate": 384_000,
        "DirectPlayProfiles": [
            ["Container": "mp4,m4v,mov", "Type": "Video", "VideoCodec": "h264,hevc", "AudioCodec": "aac,ac3,eac3,mp3,alac,flac"],
        ],
        "TranscodingProfiles": [
            ["Container": "mp4", "Type": "Video", "Protocol": "hls", "VideoCodec": "hevc,h264", "AudioCodec": "aac,ac3,eac3",
             "Context": "Streaming", "MaxAudioChannels": "6", "MinSegments": 1, "BreakOnNonKeyFrames": true],
        ],
        "ContainerProfiles": [] as [Any],
        "CodecProfiles": [] as [Any],
        "SubtitleProfiles": [
            ["Format": "vtt", "Method": "Hls"],
            ["Format": "subrip", "Method": "Hls"],
            ["Format": "ass", "Method": "Encode"],
            ["Format": "ssa", "Method": "Encode"],
            ["Format": "pgssub", "Method": "Encode"],
            ["Format": "dvdsub", "Method": "Encode"],
        ],
    ]

    struct Playback {
        let url: URL
        let itemId: String
        let mediaSourceId: String
        let playSessionId: String?
        let playMethod: String
    }

    func playback(itemId: String, startSeconds: Double, quality: Quality? = nil) async throws -> Playback {
        let ticks = Int64(startSeconds * 10_000_000)
        let forced = quality?.bitrate
        var path = "/Items/\(itemId)/PlaybackInfo?UserId=\(userId)&StartTimeTicks=\(ticks)&AutoOpenLiveStream=true"
        var body: [String: Any] = ["DeviceProfile": JellyfinAPI.deviceProfile, "UserId": userId, "MaxStreamingBitrate": forced ?? 120_000_000]
        if let forced {
            path += "&EnableDirectPlay=false&EnableDirectStream=false&AllowVideoStreamCopy=false&MaxStreamingBitrate=\(forced)"
            body["EnableDirectPlay"] = false
            body["EnableDirectStream"] = false
            body["AllowVideoStreamCopy"] = false
        }
        let data = try await request(path, method: "POST", body: body)
        let info = try JellyfinAPI.decoder.decode(JfPlaybackInfo.self, from: data)
        guard let src = info.MediaSources?.first else { throw APIError(message: "Aucune source vidéo pour cet élément") }

        if forced == nil, src.SupportsDirectPlay == true {
            let ext = (src.Container ?? "mp4").split(separator: ",").first.map { String($0) } ?? "mp4"
            var c = URLComponents(string: "\(base)/Videos/\(itemId)/stream.\(ext)")!
            c.queryItems = [
                URLQueryItem(name: "static", value: "true"),
                URLQueryItem(name: "MediaSourceId", value: src.Id),
                URLQueryItem(name: "DeviceId", value: deviceId),
                URLQueryItem(name: "api_key", value: token),
            ] + (info.PlaySessionId.map { [URLQueryItem(name: "PlaySessionId", value: $0)] } ?? [])
            return Playback(url: c.url!, itemId: itemId, mediaSourceId: src.Id, playSessionId: info.PlaySessionId, playMethod: "DirectPlay")
        }
        if var t = src.TranscodingUrl {
            if !t.lowercased().contains("api_key=") { t += (t.contains("?") ? "&" : "?") + "api_key=\(token)" }
            if let h = quality?.maxHeight { t += "&MaxHeight=\(h)" }
            guard let url = URL(string: base + t) else { throw APIError(message: "Lien de lecture invalide") }
            return Playback(url: url, itemId: itemId, mediaSourceId: src.Id, playSessionId: info.PlaySessionId,
                            playMethod: src.SupportsDirectStream == true ? "DirectStream" : "Transcode")
        }
        throw APIError(message: "Le serveur ne propose ni lecture directe ni conversion")
    }

    func report(_ kind: String, _ p: Playback, position: Double, paused: Bool) async {
        let body: [String: Any] = [
            "ItemId": p.itemId,
            "MediaSourceId": p.mediaSourceId,
            "PlaySessionId": p.playSessionId ?? "",
            "PlayMethod": p.playMethod,
            "PositionTicks": Int64(position * 10_000_000),
            "IsPaused": paused,
            "CanSeek": true,
        ]
        let path = kind == "start" ? "/Sessions/Playing" : kind == "stop" ? "/Sessions/Playing/Stopped" : "/Sessions/Playing/Progress"
        _ = try? await request(path, method: "POST", body: body)
    }
}


/// Qualités proposées dans le lecteur (débit et hauteur max). « Original » = lecture directe.
struct Quality: Identifiable, Hashable {
    let id: String
    let label: String
    var bitrate: Int?
    var maxHeight: Int?

    static let all: [Quality] = [
        Quality(id: "original", label: "Original"),
        Quality(id: "2160", label: "4K · 40 Mb/s", bitrate: 40_000_000, maxHeight: 2160),
        Quality(id: "1080h", label: "1080p · 20 Mb/s", bitrate: 20_000_000, maxHeight: 1080),
        Quality(id: "1080", label: "1080p · 10 Mb/s", bitrate: 10_000_000, maxHeight: 1080),
        Quality(id: "720", label: "720p · 4 Mb/s", bitrate: 4_000_000, maxHeight: 720),
        Quality(id: "480", label: "480p · 1,5 Mb/s", bitrate: 1_500_000, maxHeight: 480),
    ]
    static func of(_ id: String) -> Quality { all.first { $0.id == id } ?? all[0] }
}

struct JfPlayState: Codable, Hashable { var PositionTicks: Int64?; var IsPaused: Bool?; var PlayMethod: String? }
struct JfTranscoding: Codable, Hashable { var VideoCodec: String?; var AudioCodec: String?; var Bitrate: Int?; var IsVideoDirect: Bool? }

struct JfSession: Codable, Identifiable, Hashable {
    let Id: String
    var UserName: String?
    var Client: String?
    var DeviceName: String?
    var NowPlayingItem: JfItem?
    var PlayState: JfPlayState?
    var TranscodingInfo: JfTranscoding?
    var id: String { Id }
}
