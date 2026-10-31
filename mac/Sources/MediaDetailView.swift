// Fiche TMDB : lecture si le titre est sur le serveur, sinon « Demander » (Radarr / Sonarr via Lumio), À voir, bande-annonce.
import SwiftUI

struct MediaDetailView: View {
    @EnvironmentObject var session: Session
    @Environment(\.openURL) private var openURL
    let ref: MediaRef
    @State private var detail: TmdbDetail?
    @State private var info: MediaInfo?
    @State private var jfItem: JFItem?
    @State private var inWatchlist = false
    @State private var chooseSeasons = false
    @State private var message: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            if let d = detail {
                VStack(alignment: .leading, spacing: 0) {
                    header(d)
                    VStack(alignment: .leading, spacing: 22) {
                        if let t = d.tagline, !t.isEmpty { Text(t).italic().foregroundStyle(Theme.dim) }
                        if let o = d.overview, !o.isEmpty {
                            Text(o).font(.system(size: 14)).foregroundStyle(.white.opacity(0.85)).frame(maxWidth: 760, alignment: .leading)
                        }
                        if let info, ref.type == "tv", !info.seasons.isEmpty { seasonsStatus(info) }
                        if let cast = d.credits?.cast.prefix(15), !cast.isEmpty {
                            Text("Distribution").font(.system(size: 18, weight: .bold))
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(alignment: .top, spacing: 14) {
                                    ForEach(Array(cast), id: \.self) { c in
                                        VStack(spacing: 6) {
                                            RemoteImage(url: Tmdb.image(c.profile_path, "w185"))
                                                .frame(width: 84, height: 84).clipShape(Circle())
                                            Text(c.name).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                                            Text(c.character ?? "").font(.system(size: 11)).foregroundStyle(Theme.dim).lineLimit(1)
                                        }
                                        .frame(width: 96)
                                    }
                                }
                            }
                        }
                    }
                    .padding(28)
                }
            } else {
                LoadingView().frame(height: 400)
            }
        }
        .ignoresSafeArea(edges: .top)
        .task { await load() }
        .sheet(isPresented: $chooseSeasons) {
            if let d = detail { SeasonPicker(detail: d, info: info) { seasons in Task { await request(seasons: seasons) } } }
        }
        .overlay(alignment: .bottom) {
            if let message {
                Text(message)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(24)
                    .onTapGesture { self.message = nil }
            }
        }
    }

    private func header(_ d: TmdbDetail) -> some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: Tmdb.image(d.backdrop_path, "w1280")).frame(height: 480).clipped()
            LinearGradient(colors: [.black.opacity(0.3), .clear, .black.opacity(0.6), .black], startPoint: .top, endPoint: .bottom)
            HStack(alignment: .bottom, spacing: 24) {
                RemoteImage(url: Tmdb.image(d.poster_path, "w500"))
                    .frame(width: 170, height: 255)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .shadow(radius: 20)
                VStack(alignment: .leading, spacing: 10) {
                    if let s = MediaStatus.label(info?.status) {
                        Text(s.uppercased()).font(.system(size: 11, weight: .heavy))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(info?.status == MediaStatus.available ? Color.green.opacity(0.85) : Theme.accent.opacity(0.85), in: Capsule())
                    }
                    Text(d.displayTitle).font(.system(size: 38, weight: .heavy)).lineLimit(2)
                    HStack(spacing: 10) {
                        Text(ref.type == "tv" ? "Série" : "Film")
                        if let y = d.year { Text(y) }
                        if let r = d.runtime, r > 0 { Text(r >= 60 ? "\(r / 60) h \(String(format: "%02d", r % 60))" : "\(r) min") }
                        if let n = d.number_of_seasons { Text("\(n) saison\(n > 1 ? "s" : "")") }
                        if let v = d.vote_average, v > 0 { Label(String(format: "%.1f", v), systemImage: "star.fill") }
                    }
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.dim)
                    if let g = d.genres, !g.isEmpty {
                        Text(g.prefix(4).map(\.name).joined(separator: " · ")).font(.system(size: 13)).foregroundStyle(Theme.dim)
                    }
                    actions(d).padding(.top, 6)
                }
            }
            .padding(28)
        }
        .frame(height: 480)
    }

    @ViewBuilder private func actions(_ d: TmdbDetail) -> some View {
        HStack(spacing: 10) {
            if let jf = jfItem {
                if jf.isSeries {
                    NavigationLink(value: jf) {
                        Label("Voir les épisodes", systemImage: "play.rectangle.fill")
                            .fontWeight(.semibold).padding(.horizontal, 18).padding(.vertical, 10)
                            .background(.white, in: Capsule()).foregroundStyle(.black)
                    }
                    .buttonStyle(.plain)
                } else {
                    PillButton(title: jf.progress != nil ? "Reprendre" : "Lecture", icon: "play.fill") { session.play(jf) }
                }
            }
            let status = info?.status ?? MediaStatus.unknown
            if status != MediaStatus.available && session.lumio != nil {
                if status == MediaStatus.pending || status == MediaStatus.processing {
                    if ref.type == "tv" {
                        PillButton(title: "Demander d’autres saisons", icon: "plus", primary: jfItem == nil) { chooseSeasons = true }
                    } else {
                        Label("Déjà demandé", systemImage: "clock").foregroundStyle(Theme.dim)
                    }
                } else {
                    PillButton(title: busy ? "Envoi…" : "Demander", icon: "arrow.down.circle.fill", primary: jfItem == nil) {
                        if ref.type == "tv" { chooseSeasons = true } else { Task { await request(seasons: nil) } }
                    }
                    .disabled(busy)
                }
            }
            PillButton(title: inWatchlist ? "Dans À voir" : "À voir", icon: inWatchlist ? "bookmark.fill" : "bookmark", primary: false) {
                Task { await toggleWatch(d) }
            }
            if let t = d.trailer {
                PillButton(title: "Bande-annonce", icon: "play.tv", primary: false) { openURL(t) }
            }
        }
    }

    private func seasonsStatus(_ info: MediaInfo) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Saisons").font(.system(size: 18, weight: .bold))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(info.seasons.filter { $0.seasonNumber > 0 }, id: \.self) { s in
                        VStack(spacing: 2) {
                            Text("Saison \(s.seasonNumber)").font(.system(size: 13, weight: .semibold))
                            Text(MediaStatus.label(s.status) ?? "Absente").font(.system(size: 11)).foregroundStyle(s.status == MediaStatus.available ? .green : Theme.dim)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
        }
    }

    private func load() async {
        guard let t = session.tmdb else {
            await session.prepare()
            if session.tmdb == nil { message = "TMDB indisponible : vérifie le serveur Lumio."; return }
            return await load()
        }
        detail = try? await t.detail(type: ref.type, id: ref.tmdbId)
        if let l = session.lumio {
            info = try? await l.media(type: ref.type, tmdbId: ref.tmdbId)
            inWatchlist = ((try? await l.watchlist()) ?? []).contains { $0.type == ref.type && $0.tmdbId == ref.tmdbId }
        }
        if let id = await session.jellyfinId(type: ref.type, tmdbId: ref.tmdbId) {
            jfItem = try? await session.client?.item(id)
        }
    }

    private func request(seasons: [Int]?) async {
        guard let l = session.lumio, let d = detail else { return }
        busy = true
        do {
            try await l.request(type: ref.type, tmdbId: ref.tmdbId, title: d.displayTitle, year: d.year,
                                poster: Tmdb.image(d.poster_path, "w500")?.absoluteString,
                                backdrop: Tmdb.image(d.backdrop_path, "w1280")?.absoluteString, seasons: seasons)
            message = "Demande envoyée"
            info = try? await l.media(type: ref.type, tmdbId: ref.tmdbId)
        } catch {
            message = error.localizedDescription
        }
        busy = false
    }

    private func toggleWatch(_ d: TmdbDetail) async {
        guard let l = session.lumio else { return }
        do {
            if inWatchlist {
                try await l.removeWatch(type: ref.type, tmdbId: ref.tmdbId)
            } else {
                try await l.addWatch(type: ref.type, tmdbId: ref.tmdbId, title: d.displayTitle, year: d.year,
                                     poster: Tmdb.image(d.poster_path, "w500")?.absoluteString,
                                     backdrop: Tmdb.image(d.backdrop_path, "w1280")?.absoluteString)
            }
            inWatchlist.toggle()
        } catch {
            message = error.localizedDescription
        }
    }
}

/// Choix des saisons à demander.
struct SeasonPicker: View {
    @Environment(\.dismiss) private var dismiss
    let detail: TmdbDetail
    let info: MediaInfo?
    let send: ([Int]) -> Void
    @State private var chosen = Set<Int>()

    private var seasons: [TmdbDetail.Season] { (detail.seasons ?? []).filter { $0.season_number > 0 } }
    private func have(_ n: Int) -> Bool {
        let s = info?.seasons.first { $0.seasonNumber == n }?.status ?? MediaStatus.unknown
        return s == MediaStatus.available || s == MediaStatus.processing || s == MediaStatus.pending
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Quelles saisons ?").font(.system(size: 20, weight: .heavy))
            Text(detail.displayTitle).foregroundStyle(Theme.dim)
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(seasons, id: \.self) { s in
                        Toggle(isOn: Binding(get: { chosen.contains(s.season_number) || have(s.season_number) },
                                             set: { on in if on { chosen.insert(s.season_number) } else { chosen.remove(s.season_number) } })) {
                            HStack {
                                Text(s.name ?? "Saison \(s.season_number)")
                                Spacer()
                                if have(s.season_number) { Text("déjà là ou demandée").font(.caption).foregroundStyle(Theme.dim) }
                                else if let e = s.episode_count { Text("\(e) épisodes").font(.caption).foregroundStyle(Theme.dim) }
                            }
                        }
                        .disabled(have(s.season_number))
                    }
                }
            }
            .frame(maxHeight: 320)
            HStack {
                Button("Toutes") { chosen = Set(seasons.map(\.season_number).filter { !have($0) }) }
                Spacer()
                Button("Annuler") { dismiss() }
                Button("Demander") { send(chosen.sorted()); dismiss() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(chosen.isEmpty)
            }
        }
        .padding(24)
        .frame(width: 420)
        .onAppear { if let first = seasons.first(where: { !have($0.season_number) }) { chosen = [first.season_number] } }
    }
}
