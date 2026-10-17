import Foundation

// ——— TMDB : recherche, fiches, tendances, calendrier ———

struct TmdbItem: Codable, Identifiable, Hashable {
    let id: Int
    var media_type: String?
    var title: String?
    var name: String?
    var poster_path: String?
    var backdrop_path: String?
    var overview: String?
    var release_date: String?
    var first_air_date: String?
    var vote_average: Double?

    var displayTitle: String { title ?? name ?? "" }
    var year: String { String((release_date ?? first_air_date ?? "").prefix(4)) }
    var kind: String { media_type ?? (title != nil ? "movie" : "tv") }
    var poster: URL? { TMDB.img(poster_path, "w342") }
}

struct TmdbGenre: Codable, Hashable { let id: Int; let name: String }
struct TmdbSeason: Codable, Hashable, Identifiable {
    let season_number: Int
    var name: String?
    var episode_count: Int?
    var air_date: String?
    var poster_path: String?
    var id: Int { season_number }
}
struct TmdbCast: Codable, Hashable, Identifiable {
    let id: Int
    let name: String
    var character: String?
    var profile_path: String?
}
struct TmdbCredits: Codable, Hashable { var cast: [TmdbCast]? }
struct TmdbExternalIds: Codable, Hashable { var tvdb_id: Int?; var imdb_id: String? }
struct TmdbLogo: Codable, Hashable { let file_path: String; var iso_639_1: String? }
struct TmdbImages: Codable, Hashable { var logos: [TmdbLogo]? }

struct TmdbDetails: Codable, Hashable {
    let id: Int
    var title: String?
    var name: String?
    var overview: String?
    var poster_path: String?
    var backdrop_path: String?
    var release_date: String?
    var first_air_date: String?
    var runtime: Int?
    var episode_run_time: [Int]?
    var vote_average: Double?
    var genres: [TmdbGenre]?
    var seasons: [TmdbSeason]?
    var original_language: String?
    var origin_country: [String]?
    var imdb_id: String?
    var external_ids: TmdbExternalIds?
    var credits: TmdbCredits?
    var images: TmdbImages?

    var displayTitle: String { title ?? name ?? "" }
    var year: String { String((release_date ?? first_air_date ?? "").prefix(4)) }

    /// Dossier conseillé : anime (animation japonaise), enfants (animation / famille), ou normal.
    var flavor: String? {
        let g = Set((genres ?? []).map(\.id))
        let jp = original_language == "ja" || (origin_country ?? []).contains("JP")
        if g.contains(16) && jp { return "anime" }
        if g.contains(10762) || g.contains(10751) || g.contains(16) { return "kids" }
        return nil
    }
}

struct TmdbPage<T: Codable>: Codable { var results: [T]; var total_pages: Int? }

struct TMDB {
    let key: String

    static func img(_ path: String?, _ size: String = "w342") -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/\(size)\(path)")
    }

    func call<T: Decodable>(_ path: String, _ params: [String: String] = [:], as type: T.Type = T.self) async throws -> T {
        let k = key.trimmingCharacters(in: .whitespaces)
        guard !k.isEmpty else { throw APIError(message: "Clé TMDB manquante (Profil → TMDB)") }
        var c = URLComponents(string: "https://api.themoviedb.org/3\(path)")!
        var q = [URLQueryItem(name: "language", value: "fr-FR")]
        for (a, b) in params { q.append(URLQueryItem(name: a, value: b)) }
        let v4 = k.hasPrefix("eyJ")
        if !v4 { q.append(URLQueryItem(name: "api_key", value: k)) }
        c.queryItems = q
        var req = URLRequest(url: c.url!)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if v4 { req.setValue("Bearer \(k)", forHTTPHeaderField: "Authorization") }
        let (data, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw APIError(message: "TMDB : erreur \(code)") }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func search(_ query: String) async throws -> [TmdbItem] {
        try await call("/search/multi", ["query": query, "include_adult": "false"], as: TmdbPage<TmdbItem>.self)
            .results.filter { $0.media_type == "movie" || $0.media_type == "tv" }
    }

    func trending() async throws -> [TmdbItem] {
        try await call("/trending/all/week", as: TmdbPage<TmdbItem>.self).results.filter { $0.media_type == "movie" || $0.media_type == "tv" }
    }

    func details(_ type: String, _ id: Int) async throws -> TmdbDetails {
        try await call("/\(type)/\(id)", [
            "append_to_response": "credits,external_ids,images",
            "include_image_language": "fr,en,null",
        ])
    }
}

// ——— Calendrier des sorties numériques (même logique que src/lib/releases.ts) ———

struct Platform: Hashable, Identifiable {
    let name: String
    let logo: URL?
    let rent: Bool
    var id: String { name }
}

struct Release: Identifiable, Hashable {
    let id: String
    let tmdbId: Int
    let kind: String // "movie" | "tv"
    let name: String
    let poster: URL?
    let date: Date
    let info: String
    let providers: [Platform]
}

private struct ProviderEntry: Codable { let provider_name: String; var logo_path: String? }
private struct CountryProviders: Codable { var flatrate: [ProviderEntry]?; var rent: [ProviderEntry]?; var buy: [ProviderEntry]? }
private struct Providers: Codable { var results: [String: CountryProviders]? }
private struct ReleaseDate: Codable { let type: Int; let release_date: String }
private struct CountryReleases: Codable { let iso_3166_1: String; let release_dates: [ReleaseDate] }
private struct ReleaseDates: Codable { let results: [CountryReleases] }
private struct MovieRel: Codable {
    let id: Int; let title: String; var poster_path: String?
    var release_dates: ReleaseDates?
    var watchProviders: Providers?
    enum CodingKeys: String, CodingKey { case id, title, poster_path, release_dates; case watchProviders = "watch/providers" }
}
private struct TvRel: Codable {
    let id: Int; let name: String; var poster_path: String?
    var seasons: [TmdbSeason]?
    var watchProviders: Providers?
    enum CodingKeys: String, CodingKey { case id, name, poster_path, seasons; case watchProviders = "watch/providers" }
}
private struct IdOnly: Codable { let id: Int }

enum Releases {
    static let rules: [(String, String)] = [
        ("netflix", "Netflix"), ("amazon|prime video", "Prime Video"), ("disney", "Disney+"),
        ("canal\\+|canal plus|mycanal", "Canal+"), ("apple tv\\b(?! store)", "Apple TV+"), ("^max\\b|hbo", "Max"),
        ("paramount", "Paramount+"), ("crunchyroll", "Crunchyroll"), ("france ?tv|france télévisions", "france.tv"),
        ("tf1", "TF1+"), ("m6|6play", "M6+"), ("arte", "Arte"), ("ocs", "OCS"), ("rakuten", "Rakuten TV"),
        ("google play", "Google Play"), ("itunes|apple tv store", "Apple TV (achat)"),
    ]

    static func platformName(_ raw: String) -> String {
        for (re, name) in rules where raw.range(of: re, options: [.regularExpression, .caseInsensitive]) != nil { return name }
        return raw.replacingOccurrences(of: "\\s+(standard|basic|premium)?\\s*with ads$", with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespaces)
    }

    private static func platforms(_ p: Providers?) -> [Platform] {
        guard let r = p?.results?["FR"] else { return [] }
        var out: [Platform] = []
        func add(_ list: [ProviderEntry]?, rent: Bool) {
            for x in list ?? [] {
                let n = platformName(x.provider_name)
                if !out.contains(where: { $0.name == n }) { out.append(Platform(name: n, logo: TMDB.img(x.logo_path, "w92"), rent: rent)) }
            }
        }
        add(r.flatrate, rent: false)
        add((r.rent ?? []) + (r.buy ?? []), rent: true)
        return out
    }

    static let dayFmt: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static func day(_ s: String?) -> Date? { s.flatMap { dayFmt.date(from: String($0.prefix(10))) } }

    private static var cache: (Date, [Release])?

    /// Sorties de J-7 à J+45 : films en sortie numérique (France, sinon États-Unis) et nouvelles saisons en streaming.
    static func fetch(_ tmdb: TMDB, force: Bool = false) async throws -> [Release] {
        if !force, let c = cache, Date().timeIntervalSince(c.0) < 3600 { return c.1 }
        let cal = Calendar.current
        let from = cal.date(byAdding: .day, value: -7, to: cal.startOfDay(for: Date()))!
        let to = cal.date(byAdding: .day, value: 52, to: from)!
        let f = dayFmt.string(from: from), t = dayFmt.string(from: to)

        var movieIds: [Int] = []
        for page in 1...4 {
            let r = try? await tmdb.call("/discover/movie", [
                "region": "FR", "with_release_type": "4", "release_date.gte": f, "release_date.lte": t,
                "sort_by": "popularity.desc", "include_adult": "false", "page": String(page),
            ], as: TmdbPage<IdOnly>.self)
            for x in r?.results ?? [] where !movieIds.contains(x.id) { movieIds.append(x.id) }
        }
        var tvIds: [Int] = []
        for page in 1...3 {
            let r = try? await tmdb.call("/discover/tv", [
                "watch_region": "FR", "with_watch_monetization_types": "flatrate", "air_date.gte": f, "air_date.lte": t,
                "without_genres": "10767|10763|10766", "sort_by": "popularity.desc", "page": String(page),
            ], as: TmdbPage<IdOnly>.self)
            for x in r?.results ?? [] where !tvIds.contains(x.id) { tvIds.append(x.id) }
        }

        var out: [Release] = []
        await withTaskGroup(of: [Release].self) { group in
            for id in movieIds.prefix(80) {
                group.addTask {
                    guard let m = try? await tmdb.call("/movie/\(id)", ["append_to_response": "release_dates,watch/providers"], as: MovieRel.self) else { return [] }
                    func pick(_ c: String) -> Date? {
                        m.release_dates?.results.first { $0.iso_3166_1 == c }?.release_dates
                            .filter { $0.type == 4 }.compactMap { day($0.release_date) }.min()
                    }
                    let fr = pick("FR")
                    guard let date = fr ?? pick("US"), date >= from, date <= to else { return [] }
                    let p = platforms(m.watchProviders)
                    let info = (["Sortie numérique", fr == nil ? "date US" : nil] + p.prefix(2).map { Optional($0.name) }).compactMap { $0 }.joined(separator: " · ")
                    return [Release(id: "movie:\(m.id)", tmdbId: m.id, kind: "movie", name: m.title, poster: TMDB.img(m.poster_path), date: date, info: info, providers: p)]
                }
            }
            for id in tvIds.prefix(60) {
                group.addTask {
                    guard let s = try? await tmdb.call("/tv/\(id)", ["append_to_response": "watch/providers"], as: TvRel.self) else { return [] }
                    let p = platforms(s.watchProviders)
                    return (s.seasons ?? []).compactMap { x in
                        guard x.season_number > 0, let d = day(x.air_date), d >= from, d <= to else { return nil }
                        let label = x.season_number == 1 ? "Nouvelle série" : "Saison \(x.season_number)"
                        let info = ([label, "\(x.episode_count ?? 0) ép."] + p.prefix(2).map(\.name)).joined(separator: " · ")
                        return Release(id: "tv:\(s.id):\(x.season_number)", tmdbId: s.id, kind: "tv", name: s.name,
                                       poster: TMDB.img(x.poster_path ?? s.poster_path), date: d, info: info, providers: p)
                    }
                }
            }
            for await r in group { out += r }
        }
        out.sort { $0.date == $1.date ? $0.name < $1.name : $0.date < $1.date }
        cache = (Date(), out)
        return out
    }
}
