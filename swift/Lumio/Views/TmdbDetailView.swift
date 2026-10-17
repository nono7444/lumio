import SwiftUI

/// Fiche d'un film ou d'une série vue depuis TMDB (recherche, calendrier, tendances) :
/// Lire si le titre est sur le serveur, sinon Demander (avec suivi du téléchargement).
struct TmdbDetailView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state
    let type: String
    let tmdbId: Int

    @State private var d: TmdbDetails?
    @State private var jfItem: JfItem?
    @State private var error: String?
    @State private var playing: JfItem?
    @State private var proposing = false
    @State private var note = ""

    var body: some View {
        ScrollView {
            if let d {
                VStack(alignment: .leading, spacing: 18) {
                    header(d)
                    VStack(alignment: .leading, spacing: 16) {
                        if let jf = jfItem {
                            HStack(spacing: 10) {
                                Button { playing = jf } label: {
                                    Label("Lire", systemImage: "play.fill").font(.headline)
                                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                                        .background(.white, in: RoundedRectangle(cornerRadius: 14)).foregroundStyle(.black)
                                }
                                .buttonStyle(.plain)
                                NavigationLink(value: Route.jellyfin(jf)) {
                                    Label("Jellyfin", systemImage: "square.stack").font(.subheadline.weight(.semibold))
                                        .frame(maxWidth: .infinity).padding(.vertical, 14).glassCard(cornerRadius: 14)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        RequestSection(
                            target: RequestTarget(type: type, tmdbId: tmdbId, tvdbId: d.external_ids?.tvdb_id, title: d.displayTitle,
                                                  year: d.year, poster: TMDB.img(d.poster_path)?.absoluteString,
                                                  backdrop: TMDB.img(d.backdrop_path, "w780")?.absoluteString,
                                                  seasons: d.seasons ?? [], flavor: d.flavor),
                            inJellyfin: jfItem != nil,
                            onAvailable: { Task { await findInJellyfin() } }
                        )
                        VStack(spacing: 8) {
                            FamilyRatingCard(type: type, tmdbId: tmdbId, title: d.displayTitle, poster: TMDB.img(d.poster_path)?.absoluteString)
                            if jfItem != nil {
                                ReportProblemButton(type: type, tmdbId: tmdbId, title: d.displayTitle, poster: TMDB.img(d.poster_path)?.absoluteString)
                            }
                        }
                        if jfItem == nil {
                            Button { proposing = true } label: {
                                Label("Proposer à la famille", systemImage: "bubble.left.and.bubble.right")
                                    .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                                    .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 14))
                            }
                            .buttonStyle(.plain)
                        }
                        if let o = d.overview, !o.isEmpty { Text(o).foregroundStyle(.white.opacity(0.88)).lineSpacing(3) }
                        if let cast = d.credits?.cast, !cast.isEmpty { castRow(Array(cast.prefix(15))) }
                        if type == "tv", let seasons = d.seasons?.filter({ $0.season_number > 0 }), !seasons.isEmpty {
                            Text("Saisons").font(.title3.bold())
                            ForEach(seasons) { s in
                                HStack {
                                    Text(s.name ?? "Saison \(s.season_number)").font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text("\(s.episode_count ?? 0) ép.\(s.air_date.map { " · \($0.prefix(4))" } ?? "")").font(.caption).foregroundStyle(Theme.dim)
                                }
                                .padding(12).background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.bottom, 40)
            } else if let error {
                ErrorBox(message: error) { Task { await load() } }
            } else {
                ProgressView().padding(60)
            }
        }
        .background(Color.black)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .ignoresSafeArea(edges: .top)
        #endif
        .playerCover(item: $playing)
        .task { await load() }
        .alert("Proposer à la famille", isPresented: $proposing) {
            TextField("Un petit mot (facultatif)", text: $note)
            Button("Annuler", role: .cancel) {}
            Button("Envoyer") { propose() }
        }
    }

    private func header(_ d: TmdbDetails) -> some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: TMDB.img(d.backdrop_path, "w1280")) { p in
                if case .success(let i) = p { i.resizable().scaledToFill() } else { Theme.surfaceHigh }
            }
            .frame(height: 380).frame(maxWidth: .infinity).clipped()
            LinearGradient(colors: [.clear, .black], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 8) {
                if let logo = d.images?.logos?.first(where: { $0.iso_639_1 == "fr" }) ?? d.images?.logos?.first(where: { $0.iso_639_1 == "en" }) ?? d.images?.logos?.first {
                    AsyncImage(url: TMDB.img(logo.file_path, "w500")) { p in
                        if case .success(let i) = p { i.resizable().scaledToFit() } else { Text(d.displayTitle).font(.largeTitle.bold()) }
                    }
                    .frame(maxWidth: 260, maxHeight: 90, alignment: .leading)
                } else {
                    Text(d.displayTitle).font(.largeTitle.bold())
                }
                HStack(spacing: 8) {
                    if !d.year.isEmpty { Text(d.year) }
                    if let r = d.runtime ?? d.episode_run_time?.first, r > 0 { Text("\(r) min") }
                    if let v = d.vote_average, v > 0 { Label(String(format: "%.1f", v), systemImage: "star.fill") }
                    if type == "tv", let n = d.seasons?.filter({ $0.season_number > 0 }).count { Text("\(n) saison\(n > 1 ? "s" : "")") }
                }
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.dim)
                if let g = d.genres, !g.isEmpty { Text(g.prefix(3).map(\.name).joined(separator: "  •  ")).font(.subheadline).foregroundStyle(Theme.dim) }
            }
            .padding()
        }
    }

    private func castRow(_ cast: [TmdbCast]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Casting").font(.title3.bold())
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(cast) { c in
                        VStack(spacing: 4) {
                            AsyncImage(url: TMDB.img(c.profile_path, "w185")) { p in
                                if case .success(let i) = p { i.resizable().scaledToFill() } else { Image(systemName: "person.fill").foregroundStyle(Theme.dim) }
                            }
                            .frame(width: 70, height: 70).background(Theme.surfaceHigh).clipShape(Circle())
                            Text(c.name).font(.caption.weight(.semibold)).lineLimit(1)
                            if let ch = c.character { Text(ch).font(.caption2).foregroundStyle(Theme.dim).lineLimit(1) }
                        }
                        .frame(width: 84)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private func load() async {
        do {
            d = try await session.tmdb.details(type, tmdbId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        await findInJellyfin()
    }

    private func findInJellyfin() async {
        if let it = try? await session.jellyfin.findByTmdb(tmdbId, type: type) { jfItem = it }
    }

    private func propose() {
        guard let d else { return }
        Task {
            do {
                _ = try await session.lumio.sendMessage(note, media: ChatMedia(type: type, tmdbId: tmdbId, title: d.displayTitle, year: d.year,
                                                                               poster: TMDB.img(d.poster_path)?.absoluteString))
                Toast.shared.show("Proposé dans le chat de la famille")
                note = ""
            } catch {
                Toast.shared.show(error.localizedDescription, error: true)
            }
        }
    }
}
