import SwiftUI

/// Fiche d'un film ou d'une série : lecture, vu, favori, saisons et épisodes.
struct ItemDetailView: View {
    @Environment(AppSession.self) private var session
    @State var item: JfItem
    @State private var seasons: [JfItem] = []
    @State private var season: JfItem?
    @State private var episodes: [JfItem] = []
    @State private var playItem: JfItem?
    @State private var fromStart = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                VStack(alignment: .leading, spacing: 16) {
                    actions
                    if let tmdb = item.tmdbId {
                        VStack(spacing: 8) {
                            FamilyRatingCard(type: item.isSeries ? "tv" : "movie", tmdbId: tmdb, title: item.name,
                                             poster: session.jellyfin.posterURL(item)?.absoluteString)
                            ReportProblemButton(type: item.isSeries ? "tv" : "movie", tmdbId: tmdb, title: item.name,
                                                poster: session.jellyfin.posterURL(item)?.absoluteString)
                        }
                    }
                    if let o = item.Overview, !o.isEmpty {
                        Text(o).foregroundStyle(.white.opacity(0.88)).lineSpacing(3)
                    }
                    if item.isSeries { seriesSection }
                }
                .padding(.horizontal)
            }
            .padding(.bottom, 40)
        }
        .background(Color.black)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .ignoresSafeArea(edges: .top)
        #endif
        .playerCover(item: $playItem, fromStart: fromStart)
        .task { await reload() }
        .onChange(of: playItem) { _, new in if new == nil { Task { await reload() } } }
    }

    private var header: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: session.jellyfin.backdropURL(item)) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Theme.surfaceHigh }
            }
            .frame(height: 360)
            .frame(maxWidth: .infinity)
            .clipped()
            LinearGradient(colors: [.clear, .black], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 8) {
                Text(item.name).font(.largeTitle.bold()).lineLimit(3)
                HStack(spacing: 8) {
                    if let y = item.ProductionYear { pill(String(y)) }
                    if !item.isSeries, let r = item.runtimeText { pill(r, icon: "clock") }
                    if let o = item.OfficialRating { pill(o) }
                    if let c = item.CommunityRating { pill(String(format: "%.1f", c), icon: "star.fill") }
                    if item.isSeries, let n = item.ChildCount { pill("\(n) saison\(n > 1 ? "s" : "")") }
                }
                if let g = item.Genres, !g.isEmpty {
                    Text(g.prefix(3).joined(separator: "  •  ")).font(.subheadline).foregroundStyle(Theme.dim)
                }
            }
            .padding()
        }
    }

    private func pill(_ text: String, icon: String? = nil) -> some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.caption2) }
            Text(text).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 9).padding(.vertical, 4)
        .glassCard(cornerRadius: 8)
    }

    private var nextEpisode: JfItem? { episodes.first { !$0.played } ?? episodes.first }

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: 10) {
            if item.isSeries {
                if let ep = nextEpisode {
                    playButton("Lire \(ep.episodeLabel)") { fromStart = false; playItem = ep }
                }
            } else {
                playButton(item.resumeSeconds > 30 ? "Reprendre à \(timeText(item.resumeSeconds))" : "Lire") {
                    fromStart = false; playItem = item
                }
            }
            HStack(spacing: 10) {
                if !item.isSeries && item.resumeSeconds > 30 {
                    glassButton("Depuis le début", icon: "arrow.counterclockwise") { fromStart = true; playItem = item }
                }
                glassButton("", icon: item.favorite ? "heart.fill" : "heart") {
                    Task {
                        try? await session.jellyfin.setFavorite(item.Id, !item.favorite)
                        await reload()
                    }
                }
                .frame(width: 56)
                if !item.isSeries {
                    glassButton(item.played ? "Vu" : "Marquer vu", icon: item.played ? "checkmark.circle.fill" : "checkmark.circle") {
                        Task {
                            try? await session.jellyfin.setPlayed(item.Id, !item.played)
                            await reload()
                        }
                    }
                }
            }
        }
    }

    private func playButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: "play.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(.white, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.black)
        }
        .buttonStyle(.plain)
    }

    private func glassButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                if !title.isEmpty { Text(title).font(.subheadline.weight(.semibold)) }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .glassCard(cornerRadius: 14)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var seriesSection: some View {
        if !seasons.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(seasons) { s in
                        Button(s.name) { Task { await select(s) } }
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(season?.Id == s.Id ? Color.white : Theme.surfaceHigh, in: Capsule())
                            .foregroundStyle(season?.Id == s.Id ? Color.black : Color.white)
                            .buttonStyle(.plain)
                    }
                }
            }
        }
        LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(episodes) { e in
                Button { fromStart = false; playItem = e } label: { EpisodeRow(item: e) }
                    .buttonStyle(.plain)
            }
        }
    }

    private func reload() async {
        let api = session.jellyfin
        if let fresh = try? await api.item(item.Id) { item = fresh }
        guard item.isSeries else { return }
        if seasons.isEmpty { seasons = (try? await api.seasons(seriesId: item.Id)) ?? [] }
        let current = season ?? seasons.first { s in !(s.played) } ?? seasons.first
        if let current { await select(current) }
    }

    private func select(_ s: JfItem) async {
        season = s
        episodes = (try? await session.jellyfin.episodes(seriesId: item.Id, seasonId: s.Id)) ?? []
    }
}

struct EpisodeRow: View {
    @Environment(AppSession.self) private var session
    let item: JfItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: session.jellyfin.thumbURL(item, width: 400)) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Theme.surfaceHigh }
            }
            .frame(width: 150, height: 84)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .bottom) { if item.progress > 0 { ProgressBar(value: item.progress).padding(6) } }
            .overlay(alignment: .topTrailing) {
                if item.played {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent).padding(5)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("\(item.IndexNumber ?? 0). \(item.name)").font(.subheadline.weight(.semibold)).lineLimit(2)
                if let r = item.runtimeText { Text(r).font(.caption).foregroundStyle(Theme.dim) }
                if let o = item.Overview { Text(o).font(.caption).foregroundStyle(Theme.dim).lineLimit(2) }
            }
            Spacer(minLength: 0)
        }
    }
}

func timeText(_ sec: Double) -> String {
    let s = Int(sec)
    let h = s / 3600, m = (s % 3600) / 60
    return h > 0 ? "\(h) h \(String(format: "%02d", m))" : "\(m) min"
}
