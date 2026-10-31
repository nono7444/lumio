// Accueil : nom + écusson, grande image, plateformes, Reprendre, À suivre, nouveautés de chaque bibliothèque.
import SwiftUI

/// Type d'élément d'une bibliothèque Jellyfin (comme sur l'iPhone : une bibliothèque Films ne montre que des films).
func itemTypes(for collectionType: String?) -> String {
    switch collectionType {
    case "movies": return "Movie"
    case "tvshows": return "Series"
    case "boxsets": return "BoxSet"
    default: return "Movie,Series"
    }
}

struct HomeView: View {
    @EnvironmentObject var session: Session
    @State private var resume: [JFItem] = []
    @State private var nextUp: [JFItem] = []
    @State private var latest: [(JFItem, [JFItem])] = []
    @State private var platforms: [PlatformInfo] = []
    @State private var myRank: RankRow?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        Group {
            if loading && resume.isEmpty && latest.isEmpty {
                LoadingView()
            } else if let error, resume.isEmpty, latest.isEmpty {
                MessageView(icon: "wifi.exclamationmark", text: error)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 34) {
                        ZStack(alignment: .topLeading) {
                            if let hero = (resume.first ?? latest.first?.1.first) { Hero(item: hero) } else { Color.clear.frame(height: 90) }
                            profileBadge.padding(.leading, 28).padding(.top, 38)
                        }
                        if !platforms.isEmpty { platformsRow }
                        if !resume.isEmpty {
                            Row(title: "Reprendre") { ForEach(resume) { ResumeCard(item: $0) } }
                        }
                        if !nextUp.isEmpty {
                            Row(title: "À suivre") { ForEach(nextUp) { ResumeCard(item: $0) } }
                        }
                        ForEach(latest, id: \.0.Id) { row in
                            Row(title: "Nouveautés · \(row.0.title)") { ForEach(row.1) { PosterCard(item: $0) } }
                        }
                    }
                    .padding(.bottom, 40)
                }
                .ignoresSafeArea(edges: .top)
            }
        }
        .task { await load() }
    }

    private var profileBadge: some View {
        HStack(spacing: 10) {
            Text(session.userName).font(.system(size: 22, weight: .heavy))
            if let r = myRank { RankShield(tier: r.grade.tier ?? 0, size: 24) }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
    }

    private var platformsRow: some View {
        Row(title: "Plateformes") {
            ForEach(platforms) { p in
                NavigationLink(value: PlatformRef(id: p.id, name: p.name)) { PlatformTile(platform: p) }
                    .buttonStyle(.plain)
            }
        }
    }

    private func load() async {
        guard let c = session.client else { return }
        loading = true
        do {
            async let r = c.resume()
            async let n = c.nextUp()
            let libs = try await c.views().filter { $0.CollectionType != "boxsets" }
            var rows: [(JFItem, [JFItem])] = []
            for lib in libs {
                if let items = try? await c.latest(parent: lib.Id, types: itemTypes(for: lib.CollectionType)), !items.isEmpty { rows.append((lib, items)) }
            }
            resume = (try? await r) ?? []
            let resumeSeries = Set(resume.compactMap { $0.SeriesId })
            nextUp = ((try? await n) ?? []).filter { !resumeSeries.contains($0.SeriesId ?? "") }
            latest = rows
            error = nil
        } catch {
            self.error = "Jellyfin ne répond pas.\n\(error.localizedDescription)"
        }
        loading = false
        if let l = session.lumio {
            platforms = (try? await l.platforms()) ?? []
            if let b = try? await l.rewards() { myRank = b.users.first { $0.id == b.me } }
        }
    }
}

/// Vignette d'une plateforme : verre noir, logo en blanc (comme sur l'iPhone et la TV).
struct PlatformTile: View {
    let platform: PlatformInfo
    @State private var hover = false

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(white: 0.14), Color(white: 0.02)], startPoint: .top, endPoint: .bottom)
            LinearGradient(colors: [.white.opacity(0.18), .white.opacity(0.03), .clear], startPoint: .top, endPoint: .center)
            if let logo = platform.logo.flatMap(URL.init(string:)) {
                AsyncImage(url: logo) { phase in
                    if let img = phase.image {
                        img.resizable().renderingMode(.template).aspectRatio(contentMode: .fit).foregroundStyle(.white)
                    } else { Text(platform.name).font(.headline) }
                }
                .padding(.horizontal, 26).padding(.vertical, 22)
            } else {
                Text(platform.name).font(.headline)
            }
        }
        .frame(width: 180, height: 100)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(hover ? 0.6 : 0.16), lineWidth: 1))
        .scaleEffect(hover ? 1.04 : 1)
        .onHover { h in withAnimation(.easeOut(duration: 0.15)) { hover = h } }
    }
}

struct Hero: View {
    @EnvironmentObject var session: Session
    let item: JFItem

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: session.client?.imageURL(item, kind: "Backdrop", width: 1920))
                .frame(height: 440)
                .clipped()
            LinearGradient(colors: [.black.opacity(0.35), .clear, .black.opacity(0.4), .black], startPoint: .top, endPoint: .bottom)
            LinearGradient(colors: [.black.opacity(0.7), .clear], startPoint: .leading, endPoint: .center)
            VStack(alignment: .leading, spacing: 10) {
                Text(item.isEpisode ? (item.SeriesName ?? item.title) : item.title)
                    .font(.system(size: 40, weight: .heavy))
                    .lineLimit(2)
                Text(item.isEpisode ? "\(item.subtitle) · \(item.title)" : item.subtitle)
                    .foregroundStyle(Theme.dim)
                if let o = item.Overview, !o.isEmpty {
                    Text(o).lineLimit(3).frame(maxWidth: 560, alignment: .leading).foregroundStyle(.white.opacity(0.85))
                }
                HStack(spacing: 10) {
                    PillButton(title: item.progress != nil ? "Reprendre" : "Lecture", icon: "play.fill") { session.play(item) }
                    NavigationLink(value: item) {
                        Label("Fiche", systemImage: "info.circle")
                            .padding(.horizontal, 18).padding(.vertical, 10)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 4)
            }
            .padding(28)
        }
        .frame(height: 440)
    }
}
