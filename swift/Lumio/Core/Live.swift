import Foundation

// ——— Live TV : listes IPTV (M3U / Xtream Codes) et addons Stremio (même logique que src/lib/live.ts) ———

struct Channel: Codable, Identifiable, Hashable {
    let key: String
    let sourceId: String
    var name: String
    var logo: String?
    var group: String?
    var url: String?
    var headers: [String: String]?
    var stremioBase: String?
    var stremioType: String?
    var stremioId: String?
    var id: String { key }
}

struct LiveStream: Hashable {
    let url: URL
    var headers: [String: String]?
    var label: String?
}

enum Live {
    static let iptvUA = "VLC/3.0.20 LibVLC/3.0.20"

    static func newSourceId() -> String { "src-" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36) }

    static func xtreamM3u(server: String, user: String, pass: String) -> String {
        var base = server.trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        if !base.lowercased().hasPrefix("http") { base = "http://" + base }
        let u = user.trimmingCharacters(in: .whitespaces).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? user
        let p = pass.trimmingCharacters(in: .whitespaces).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? pass
        return "\(base)/get.php?username=\(u)&password=\(p)&type=m3u_plus&output=ts"
    }

    private static func attr(_ line: String, _ name: String) -> String? {
        guard let r = line.range(of: "\(name)=\"([^\"]*)\"", options: [.regularExpression, .caseInsensitive]) else { return nil }
        let s = line[r]
        guard let q1 = s.firstIndex(of: "\"") else { return nil }
        let v = s[s.index(after: q1)...].dropLast()
        let out = String(v).trimmingCharacters(in: .whitespaces)
        return out.isEmpty ? nil : out
    }

    static func parseM3u(_ text: String, sourceId: String) -> [Channel] {
        var out: [Channel] = []
        var used = Set<String>()
        var info: (name: String, logo: String?, group: String?)?
        var headers: [String: String] = [:]
        for raw in text.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.hasPrefix("#EXTINF") {
                var name = ""
                if let comma = line.lastIndex(of: ",") { name = String(line[line.index(after: comma)...]).trimmingCharacters(in: .whitespaces) }
                if name.isEmpty { name = attr(line, "tvg-name") ?? "Chaîne" }
                info = (name, attr(line, "tvg-logo"), attr(line, "group-title"))
                headers = [:]
            } else if line.hasPrefix("#EXTVLCOPT:") {
                let kv = line.dropFirst(11).split(separator: "=", maxSplits: 1).map(String.init)
                if kv.count == 2 {
                    if kv[0].lowercased().contains("http-user-agent") { headers["User-Agent"] = kv[1] }
                    if kv[0].lowercased().contains("http-refer") { headers["Referer"] = kv[1] }
                }
            } else if line.hasPrefix("#EXTGRP:"), info != nil, info?.group == nil {
                info?.group = String(line.dropFirst(8)).trimmingCharacters(in: .whitespaces)
            } else if !line.hasPrefix("#") {
                if let i = info {
                    // Listes Xtream « m3u_plus » : seulement le direct (pas les films / séries à la demande)
                    if line.range(of: "/(movie|series)/", options: [.regularExpression, .caseInsensitive]) == nil {
                        var key = "\(sourceId):\(i.group ?? ""):\(i.name)"
                        var n = 2
                        while used.contains(key) { key = "\(sourceId):\(i.group ?? ""):\(i.name)#\(n)"; n += 1 }
                        used.insert(key)
                        out.append(Channel(key: key, sourceId: sourceId, name: i.name, logo: i.logo, group: i.group, url: line,
                                           headers: headers.isEmpty ? nil : headers))
                    }
                }
                info = nil
                headers = [:]
            }
        }
        return out
    }

    private static func fetchData(_ url: URL, timeout: TimeInterval = 45, headers: [String: String] = [:]) async throws -> Data {
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        let (data, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw APIError(message: "HTTP \(code)") }
        return data
    }

    private struct XCat: Codable { let category_id: String?; let category_name: String? }
    private struct XStream: Codable {
        let name: String?
        let stream_id: Int?
        let stream_icon: String?
        let category_id: String?
    }

    /// Compte Xtream : l'API ne renvoie que les chaînes en direct, avec leurs catégories (flux HLS pour AVPlayer).
    private static func loadXtream(_ src: LiveSource) async throws -> [Channel]? {
        guard let c = URLComponents(string: src.url), c.path.lowercased().hasSuffix("get.php"),
              let user = c.queryItems?.first(where: { $0.name == "username" })?.value,
              let pass = c.queryItems?.first(where: { $0.name == "password" })?.value,
              let scheme = c.scheme, let host = c.host else { return nil }
        let server = "\(scheme)://\(host)\(c.port.map { ":\($0)" } ?? "")"
        let enc = { (s: String) in s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s }
        let api = "\(server)/player_api.php?username=\(enc(user))&password=\(enc(pass))"
        let ua = ["User-Agent": iptvUA]
        async let catsData = fetchData(URL(string: api + "&action=get_live_categories")!, headers: ua)
        async let streamsData = fetchData(URL(string: api + "&action=get_live_streams")!, headers: ua)
        let cats = (try? JSONDecoder().decode([XCat].self, from: try await catsData)) ?? []
        guard let streams = try? JSONDecoder().decode([XStream].self, from: try await streamsData) else {
            throw APIError(message: "Identifiants IPTV refusés (ou abonnement expiré)")
        }
        var catName: [String: String] = [:]
        for c in cats { if let id = c.category_id, let n = c.category_name { catName[id] = n } }
        var used = Set<String>()
        return streams.compactMap { st in
            guard let sid = st.stream_id else { return nil }
            let name = (st.name ?? "").trimmingCharacters(in: .whitespaces)
            let group = st.category_id.flatMap { catName[$0] }
            var key = "\(src.id):\(group ?? ""):\(name)"
            var n = 2
            while used.contains(key) { key = "\(src.id):\(group ?? ""):\(name)#\(n)"; n += 1 }
            used.insert(key)
            return Channel(key: key, sourceId: src.id, name: name.isEmpty ? "Chaîne" : name, logo: st.stream_icon, group: group,
                           url: "\(server)/live/\(enc(user))/\(enc(pass))/\(sid).m3u8")
        }
    }

    struct Manifest: Codable {
        struct Catalog: Codable {
            struct Extra: Codable { var name: String?; var isRequired: Bool? }
            let type: String
            let id: String
            var name: String?
            var extra: [Extra]?
            var extraRequired: [String]?
        }
        var id: String?
        var name: String?
        var catalogs: [Catalog]?
    }

    static func addonCandidates(_ input: String) -> [String] {
        var url = input.trimmingCharacters(in: CharacterSet(charactersIn: " \"'<>\n"))
        if let r = url.range(of: "[?&]addon=([^&#]+)", options: .regularExpression) {
            let v = url[r].split(separator: "=", maxSplits: 1).last.map(String.init) ?? ""
            url = v.removingPercentEncoding ?? v
        }
        if url.hasPrefix("stremio://") { url = "https://" + url.dropFirst("stremio://".count) }
        if !url.lowercased().hasPrefix("http") { url = "https://" + url }
        var out: [String] = []
        func push(_ u: String) {
            var c = u
            while c.hasSuffix("/") { c.removeLast() }
            if !c.isEmpty && !out.contains(c) { out.append(c) }
        }
        let noManifest = url.replacingOccurrences(of: "/manifest\\.json(\\?.*)?(#.*)?$", with: "", options: [.regularExpression, .caseInsensitive])
        let noConfigure = noManifest.replacingOccurrences(of: "/configure/?(\\?.*)?(#.*)?$", with: "", options: [.regularExpression, .caseInsensitive])
        push(noConfigure)
        push(noManifest)
        return out
    }

    static func resolveAddon(_ input: String) async throws -> (String, Manifest) {
        var last = "addon introuvable"
        for base in addonCandidates(input) {
            do {
                let m = try JSONDecoder().decode(Manifest.self, from: try await fetchData(URL(string: "\(base)/manifest.json")!, timeout: 20))
                if m.id != nil || m.name != nil { return (base, m) }
            } catch { last = error.localizedDescription }
        }
        throw APIError(message: "Addon Stremio : \(last)")
    }

    private struct Meta: Codable { let id: String?; let name: String?; var poster: String?; var logo: String?; var genres: [String]? }
    private struct Metas: Codable { var metas: [Meta]? }

    private static func loadStremio(_ src: LiveSource) async throws -> [Channel] {
        let (base, manifest) = try await resolveAddon(src.url)
        let cats = (manifest.catalogs ?? []).filter {
            ($0.type == "tv" || $0.type == "channel") && !($0.extra ?? []).contains { $0.isRequired == true } && ($0.extraRequired ?? []).isEmpty
        }
        if cats.isEmpty { throw APIError(message: "\(manifest.name ?? "Addon") : aucun catalogue de chaînes") }
        var out: [Channel] = []
        var seen = Set<String>()
        for c in cats {
            let enc = c.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? c.id
            guard let url = URL(string: "\(base)/catalog/\(c.type)/\(enc).json"),
                  let data = try? await fetchData(url, timeout: 30),
                  let r = try? JSONDecoder().decode(Metas.self, from: data) else { continue }
            for m in r.metas ?? [] {
                guard let id = m.id, !seen.contains(id) else { continue }
                seen.insert(id)
                out.append(Channel(key: "\(src.id):\(id)", sourceId: src.id, name: m.name ?? id, logo: m.logo ?? m.poster,
                                   group: m.genres?.first ?? c.name ?? manifest.name,
                                   stremioBase: base, stremioType: c.type, stremioId: id))
            }
        }
        return out
    }

    /// Hachage stable (le hashValue de Swift change à chaque lancement).
    static func stableHash(_ s: String) -> String {
        var h: UInt64 = 5381
        for b in s.utf8 { h = (h &<< 5) &+ h &+ UInt64(b) }
        return String(h, radix: 36)
    }

    private static var memory: [String: (Date, [Channel])] = [:]

    /// Chaînes d'une source (en cache 6 h sur l'appareil).
    static func channels(_ src: LiveSource, force: Bool = false) async throws -> [Channel] {
        let key = "live:\(src.id):\(src.url)"
        let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("live-\(stableHash(key)).json")
        if !force {
            if let m = memory[key], Date().timeIntervalSince(m.0) < 6 * 3600 { return m.1 }
            if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
               let d = attrs[.modificationDate] as? Date, Date().timeIntervalSince(d) < 6 * 3600,
               let data = try? Data(contentsOf: file), let list = try? JSONDecoder().decode([Channel].self, from: data) {
                memory[key] = (d, list)
                return list
            }
        }
        var list: [Channel]
        if src.kind == "stremio" {
            list = try await loadStremio(src)
        } else if let x = try? await loadXtream(src), !x.isEmpty {
            list = x
        } else {
            guard let url = URL(string: src.url) else { throw APIError(message: "Lien de liste invalide") }
            let text = String(decoding: try await fetchData(url), as: UTF8.self)
            guard text.contains("#EXTINF") else { throw APIError(message: "Ce lien ne renvoie pas une liste M3U") }
            list = parseM3u(text, sourceId: src.id)
        }
        memory[key] = (Date(), list)
        if let data = try? JSONEncoder().encode(list) { try? data.write(to: file) }
        return list
    }

    private struct StreamsResp: Codable {
        struct S: Codable {
            struct Hints: Codable { struct PH: Codable { var request: [String: String]? }; var proxyHeaders: PH? }
            var url: String?
            var name: String?
            var title: String?
            var behaviorHints: Hints?
        }
        var streams: [S]?
    }

    private static func withUA(_ h: [String: String]?) -> [String: String] {
        var out = h ?? [:]
        if !out.keys.contains(where: { $0.lowercased() == "user-agent" }) { out["User-Agent"] = iptvUA }
        return out
    }

    /// Liens de lecture d'une chaîne, du meilleur au moins bon (le lecteur passe au suivant en cas d'échec).
    static func streams(_ ch: Channel) async throws -> [LiveStream] {
        if let u = ch.url, let url = URL(string: u) {
            var out = [LiveStream(url: url, headers: withUA(ch.headers))]
            // AVPlayer ne lit pas le MPEG-TS brut : on essaie aussi la version HLS
            if u.hasSuffix(".ts"), let hls = URL(string: String(u.dropLast(3)) + ".m3u8") {
                out.insert(LiveStream(url: hls, headers: withUA(ch.headers), label: "HLS"), at: 0)
            }
            return out
        }
        guard let base = ch.stremioBase, let type = ch.stremioType, let id = ch.stremioId else { throw APIError(message: "Chaîne sans lien") }
        let encId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        var r: StreamsResp?
        for path in ["\(base)/stream/\(type)/\(encId).json", "\(base)/stream/\(type)/\(id).json"] {
            guard let url = URL(string: path) else { continue }
            if let d = try? await fetchData(url, timeout: 20), let v = try? JSONDecoder().decode(StreamsResp.self, from: d), !(v.streams ?? []).isEmpty {
                r = v
                break
            }
        }
        var seen = Set<String>()
        var out: [LiveStream] = []
        for s in r?.streams ?? [] {
            guard let u = s.url, u.lowercased().hasPrefix("http"), !seen.contains(u), let url = URL(string: u) else { continue }
            seen.insert(u)
            let h = s.behaviorHints?.proxyHeaders?.request
            let label = [s.name, s.title].compactMap { $0 }.joined(separator: " · ")
            out.append(LiveStream(url: url, headers: withUA(h), label: label.isEmpty ? nil : String(label.prefix(80))))
        }
        if out.isEmpty { throw APIError(message: "Aucun flux disponible pour cette chaîne") }
        return out
    }

    // ——— Classement : pays / langue et thème ———

    static let countries: [(String, String, String)] = [
        ("FR", "France", "🇫🇷"), ("BE", "Belgique", "🇧🇪"), ("CH", "Suisse", "🇨🇭"), ("CA", "Canada", "🇨🇦"), ("AF", "Afrique", "🌍"),
        ("UK", "Royaume-Uni", "🇬🇧"), ("US", "États-Unis", "🇺🇸"), ("DE", "Allemagne", "🇩🇪"), ("ES", "Espagne", "🇪🇸"),
        ("IT", "Italie", "🇮🇹"), ("PT", "Portugal", "🇵🇹"), ("NL", "Pays-Bas", "🇳🇱"), ("TR", "Turquie", "🇹🇷"),
        ("AR", "Arabe", "🌙"), ("MA", "Maghreb", "🌙"), ("PL", "Pologne", "🇵🇱"), ("RO", "Roumanie", "🇷🇴"),
        ("IN", "Inde", "🇮🇳"), ("LAT", "Amérique latine", "🌎"),
    ]
    static let french: Set<String> = ["FR", "BE", "CH", "CA", "AF"]

    static let aliases: [String: String] = [
        "FR": "FR", "FRA": "FR", "FRANCE": "FR", "VF": "FR", "VOSTFR": "FR", "FRENCH": "FR",
        "BE": "BE", "BEL": "BE", "BELGIQUE": "BE", "BELGIUM": "BE",
        "CH": "CH", "SUI": "CH", "SUISSE": "CH", "SWISS": "CH",
        "CA": "CA", "CAN": "CA", "CANADA": "CA", "QC": "CA", "QUEBEC": "CA", "QUÉBEC": "CA",
        "AF": "AF", "AFR": "AF", "AFRIQUE": "AF", "AFRICA": "AF",
        "UK": "UK", "GB": "UK", "ENGLAND": "UK", "EN": "UK", "US": "US", "USA": "US",
        "DE": "DE", "GER": "DE", "GERMANY": "DE", "DEUTSCHLAND": "DE", "ALLEMAGNE": "DE",
        "ES": "ES", "SPA": "ES", "SPAIN": "ES", "ESPANA": "ES", "ESPAÑA": "ES", "ESPAGNE": "ES",
        "IT": "IT", "ITA": "IT", "ITALY": "IT", "ITALIA": "IT", "ITALIE": "IT",
        "PT": "PT", "POR": "PT", "PORTUGAL": "PT", "BR": "PT", "BRASIL": "PT", "BRAZIL": "PT",
        "NL": "NL", "NETHERLANDS": "NL", "HOLLAND": "NL", "TR": "TR", "TUR": "TR", "TURKEY": "TR", "TURKIYE": "TR",
        "AR": "AR", "ARAB": "AR", "ARABIC": "AR", "ARABE": "AR",
        "MA": "MA", "MAROC": "MA", "MAGHREB": "MA", "DZ": "MA", "ALGERIE": "MA", "TN": "MA", "TUNISIE": "MA",
        "PL": "PL", "POLAND": "PL", "RO": "RO", "ROMANIA": "RO", "IN": "IN", "INDIA": "IN",
        "LATINO": "LAT", "LATAM": "LAT", "MX": "LAT", "MEXICO": "LAT",
    ]

    static func country(_ ch: Channel) -> String? {
        for text in [ch.group, ch.name].compactMap({ $0 }) {
            let up = text.uppercased()
            if let r = up.range(of: "^[\\s|\\[(*#]*([A-ZÉÑ]{2,10})\\s*[|\\])\\]:\\-–]", options: .regularExpression) {
                let code = up[r].filter { $0.isLetter }
                if let c = aliases[String(code)] { return c }
            }
            let words = up.split(whereSeparator: { !($0.isLetter) }).map(String.init)
            if let first = words.first, first.count <= 3, let c = aliases[first] { return c }
            for w in words where w.count >= 3 { if let c = aliases[w] { return c } }
        }
        return nil
    }

    static let themes: [(String, String, String)] = [
        ("sport", "Sport", "sportscourt"), ("info", "Info", "newspaper"), ("cinema", "Cinéma & séries", "film"),
        ("kids", "Enfants", "face.smiling"), ("docs", "Documentaires", "globe.europe.africa"), ("music", "Musique", "music.note"),
        ("general", "Généralistes", "tv"),
    ]

    private static let themeRules: [(String, String)] = [
        ("general", "g[eé]n[eé]ral|nationales?|\\btnt\\b|hertzien|chaines? fran"),
        ("sport", "sport|foot|soccer|bein|rmc ?sport|eurosport|dazn|espn|sky ?sport|golf|tennis|nba|nfl|nhl|\\bf1\\b|formula|moto ?gp|ufc|boxe|boxing|rugby|ligue ?1|ligue des champions|premier league|equipe|l'équipe|infosport|canal\\+ ?(foot|sport)|automoto|ppv|wwe|cyclisme|handball|basket|match"),
        ("info", "\\binfo|news|bfm|cnews|lci|euronews|france ?24|tv5|al ?jazeera|cnn|bbc news|sky news|public sénat|lcp|actualit"),
        ("kids", "enfant|kids|jeunesse|junior|disney|cartoon|nick|gulli|boomerang|tiji|piwi|canal ?j|baby|toon|teletoon|mangas|manga|anime"),
        ("docs", "docu|discovery|national geographic|nat ?geo|histoire|history|ushua|planete|planète|animaux|animal|science|voyage|travel|seasons|chasse|pêche|museum|toute l'histoire|rmc d[eé]couverte|investigation|crime"),
        ("music", "musi|mtv|mezzo|trace|m6 music|nrj ?hits|mcm|clubbing|radio|melody"),
        ("cinema", "cin[eé]|film|movie|ocs|paramount|tcm|action|polar|thriller|s[eé]ries?|novela|hbo|warner|sundance|frisson|comedie|com[eé]die|tf1 s[eé]ries|syfy|13e ?rue|ab ?1|rtl ?9|serie club|netflix|prime|ciné\\+"),
    ]

    static func theme(_ ch: Channel) -> String {
        for text in [ch.group, ch.name].compactMap({ $0 }) {
            for (t, re) in themeRules where text.range(of: re, options: [.regularExpression, .caseInsensitive]) != nil { return t }
        }
        return "general"
    }
}
