// Fiche d'un film ou d'une série : grande image, résumé, lecture ; saisons et épisodes.
import SwiftUI

struct DetailView: View {
    @EnvironmentObject var session: Session
    let item: JFItem
    @State private var full: JFItem?
    @State private var seasons: [JFItem] = []
    @State private var season: String?
    @State private var episodes: [JFItem] = []

    private var shown: JFItem { full ?? item }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                VStack(alignment: .leading, spacing: 22) {
                    if let o = shown.Overview, !o.isEmpty {
                        Text(o).font(.system(size: 14)).foregroundStyle(.white.opacity(0.85)).frame(maxWidth: 760, alignment: .leading)
                    }
                    if shown.isSeries { seriesSection }
                }
                .padding(28)
            }
        }
        .ignoresSafeArea(edges: .top)
        .task {
            guard let c = session.client else { return }
            full = try? await c.item(item.Id)
            if shown.isSeries {
                seasons = (try? await c.seasons(series: item.Id)) ?? []
                season = seasons.first(where: { ($0.UserData?.Played ?? false) == false })?.Id ?? seasons.first?.Id
            }
        }
        .task(id: season) {
            guard let c = session.client, let s = season else { return }
            episodes = (try? await c.episodes(series: item.Id, season: s)) ?? []
        }
    }

    private var header: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: session.client?.imageURL(shown, kind: "Backdrop", width: 1920))
                .frame(height: 460)
                .clipped()
            LinearGradient(colors: [.clear, .black.opacity(0.5), .black], startPoint: .top, endPoint: .bottom)
            HStack(alignment: .bottom, spacing: 24) {
                RemoteImage(url: session.client?.imageURL(shown, width: 400))
                    .frame(width: 170, height: 255)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .shadow(radius: 20)
                VStack(alignment: .leading, spacing: 10) {
                    Text(shown.title).font(.system(size: 38, weight: .heavy)).lineLimit(2)
                    HStack(spacing: 10) {
                        if let y = shown.ProductionYear { Text(String(y)) }
                        if let d = shown.durationText { Text(d) }
                        if let r = shown.OfficialRating { Text(r).padding(.horizontal, 6).overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.dim)) }
                        if let n = shown.CommunityRating { Label(String(format: "%.1f", n), systemImage: "star.fill") }
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.dim)
                    if let g = shown.Genres, !g.isEmpty {
                        Text(g.prefix(4).joined(separator: " · ")).font(.system(size: 13)).foregroundStyle(Theme.dim)
                    }
                    if !shown.isSeries {
                        HStack(spacing: 10) {
                            playButton(shown.progress != nil ? "Reprendre" : "Lecture") { session.play(shown) }
                            if shown.progress != nil {
                                Button { session.play(shown, fromStart: true) } label: {
                                    Label("Depuis le début", systemImage: "arrow.counterclockwise")
                                        .padding(.horizontal, 16).padding(.vertical, 10)
                                        .background(.ultraThinMaterial, in: Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.top, 6)
                    }
                }
            }
            .padding(28)
        }
        .frame(height: 460)
    }

    private func playButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: "play.fill")
                .fontWeight(.semibold)
                .padding(.horizontal, 22).padding(.vertical, 10)
                .background(.white, in: Capsule())
                .foregroundStyle(.black)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var seriesSection: some View {
        if seasons.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(seasons) { s in
                        Button { season = s.Id } label: {
                            Text(s.title)
                                .font(.system(size: 13, weight: .semibold))
                                .padding(.horizontal, 14).padding(.vertical, 7)
                                .background(season == s.Id ? Color.white : Theme.surfaceHigh, in: Capsule())
                                .foregroundStyle(season == s.Id ? Color.black : Color.white)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        VStack(spacing: 10) {
            ForEach(episodes) { EpisodeRow(episode: $0) }
        }
    }
}

struct EpisodeRow: View {
    @EnvironmentObject var session: Session
    let episode: JFItem
    @State private var hover = false

    var body: some View {
        Button { session.play(episode) } label: {
            HStack(alignment: .top, spacing: 16) {
                ZStack {
                    RemoteImage(url: session.client?.imageURL(episode, width: 480))
                    if hover {
                        Color.black.opacity(0.35)
                        Image(systemName: "play.fill").font(.system(size: 20, weight: .bold))
                    }
                }
                .frame(width: 210, height: 118)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(alignment: .bottom) { ProgressLine(value: episode.progress) }
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text("\(episode.IndexNumber.map { "\($0). " } ?? "")\(episode.title)")
                            .font(.system(size: 15, weight: .semibold)).lineLimit(1)
                        if episode.UserData?.Played == true {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent)
                        }
                        Spacer()
                        if let d = episode.durationText { Text(d).font(.system(size: 12)).foregroundStyle(Theme.dim) }
                    }
                    if let o = episode.Overview {
                        Text(o).font(.system(size: 12.5)).foregroundStyle(Theme.dim).lineLimit(3)
                    }
                }
            }
            .padding(10)
            .background(hover ? Theme.surfaceHigh : Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
