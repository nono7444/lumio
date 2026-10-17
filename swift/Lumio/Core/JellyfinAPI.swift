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

    func playback(itemId: String, startSeconds: Double) async throws -> Playback {
        let ticks = Int64(startSeconds * 10_000_000)
        let data = try await request(
            "/Items/\(itemId)/PlaybackInfo?UserId=\(userId)&StartTimeTicks=\(ticks)&AutoOpenLiveStream=true",
            method: "POST",
            body: ["DeviceProfile": JellyfinAPI.deviceProfile, "UserId": userId, "MaxStreamingBitrate": 120_000_000]
        )
        let info = try JellyfinAPI.decoder.decode(JfPlaybackInfo.self, from: data)
        guard let src = info.MediaSources?.first else { throw APIError(message: "Aucune source vidéo pour cet élément") }

        if src.SupportsDirectPlay == true {
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

/// Serveur Lumio : demandes de films et séries (authentifié par le jeton Jellyfin).
struct LumioAPI {
    let base: String
    let token: String

    @MainActor
    init(session: AppSession) {
        base = JellyfinAPI.normalize(session.lumioURL)
        token = session.token
    }

    func requests(filter: String = "all") async throws -> [LumioRequest] {
        guard let url = URL(string: "\(base)/api/requests?filter=\(filter)&take=60&skip=0&sort=added") else { throw APIError(message: "Adresse du serveur Lumio invalide") }
        var req = URLRequest(url: url)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(token, forHTTPHeaderField: "X-Jellyfin-Token")
        let (data, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw APIError(message: "Serveur Lumio : erreur \(code)") }
        return try JSONDecoder().decode(LumioRequestList.self, from: data).results
    }
}
