import Foundation

// Objets renvoyés par Jellyfin (noms de champs identiques à l'API, en PascalCase).

struct JfUserData: Codable, Hashable {
    var Played: Bool?
    var PlaybackPositionTicks: Int64?
    var PlayedPercentage: Double?
    var IsFavorite: Bool?
    var UnplayedItemCount: Int?
}

struct JfItem: Codable, Identifiable, Hashable {
    let Id: String
    var Name: String?
    var `Type`: String?
    var CollectionType: String?
    var ProductionYear: Int?
    var PremiereDate: String?
    var Overview: String?
    var RunTimeTicks: Int64?
    var CommunityRating: Double?
    var OfficialRating: String?
    var Genres: [String]?
    var SeriesName: String?
    var SeriesId: String?
    var SeasonId: String?
    var ParentIndexNumber: Int?
    var IndexNumber: Int?
    var ChildCount: Int?
    var ImageTags: [String: String]?
    var BackdropImageTags: [String]?
    var ParentBackdropItemId: String?
    var ParentBackdropImageTags: [String]?
    var UserData: JfUserData?
    var ProviderIds: [String: String]?

    var id: String { Id }
    var name: String { Name ?? "" }
    var kind: String { self.`Type` ?? "" }
    var isSeries: Bool { kind == "Series" }
    var isEpisode: Bool { kind == "Episode" }
    var isFolder: Bool { kind == "CollectionFolder" || kind == "BoxSet" || kind == "Folder" }
    var played: Bool { UserData?.Played ?? false }
    var favorite: Bool { UserData?.IsFavorite ?? false }
    var progress: Double { (UserData?.PlayedPercentage ?? 0) / 100 }
    var resumeSeconds: Double { Double(UserData?.PlaybackPositionTicks ?? 0) / 10_000_000 }
    var tmdbId: Int? { ProviderIds?["Tmdb"].flatMap { Int($0) } }

    var episodeLabel: String {
        "S\(ParentIndexNumber ?? 0)E\(IndexNumber ?? 0)"
    }

    var runtimeText: String? {
        guard let t = RunTimeTicks, t > 0 else { return nil }
        let min = Int(Double(t) / 10_000_000 / 60)
        return min >= 60 ? "\(min / 60) h \(String(format: "%02d", min % 60))" : "\(min) min"
    }
}

struct JfItemsResponse: Codable {
    var Items: [JfItem]
    var TotalRecordCount: Int?
}

struct JfUserPolicy: Codable { var IsAdministrator: Bool? }

struct JfAuthUser: Codable {
    let Id: String
    let Name: String
    var Policy: JfUserPolicy?
}

struct JfAuthResponse: Codable {
    let User: JfAuthUser
    let AccessToken: String
}

struct JfMediaSource: Codable {
    let Id: String
    var Container: String?
    var SupportsDirectPlay: Bool?
    var SupportsDirectStream: Bool?
    var TranscodingUrl: String?
}

struct JfPlaybackInfo: Codable {
    var MediaSources: [JfMediaSource]?
    var PlaySessionId: String?
}

// ——— Serveur Lumio (demandes) ———

struct LumioRequest: Codable, Identifiable, Hashable {
    struct Person: Codable, Hashable { let id: String; let name: String }
    struct Download: Codable, Hashable {
        var state: String
        var progress: Double?
        var message: String?
    }
    let id: String
    let type: String
    let tmdbId: Int
    var title: String
    var year: String?
    var poster: String?
    var status: Int
    var requestedBy: Person
    var createdAt: String
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
    var total: Int?
    var results: [LumioRequest]
}
