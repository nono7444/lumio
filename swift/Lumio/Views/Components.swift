import SwiftUI

/// Pastille « ★ 4,5 » : moyenne des notes de la famille.
struct StarBadge: View {
    let value: Double
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "star.fill").font(.system(size: 9)).foregroundStyle(Theme.gold)
            Text(value.formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier: "fr_FR"))))
                .font(.system(size: 11, weight: .heavy))
        }
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// Affiche Jellyfin (2:3) avec coche « vu », progression, épisodes non vus et note de la famille.
struct PosterCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state
    let item: JfItem
    var width: CGFloat = 130

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topTrailing) {
                AsyncImage(url: session.jellyfin.posterURL(item, height: Int(width * 3))) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    default:
                        ZStack {
                            Theme.surfaceHigh
                            Text(item.name).font(.caption).foregroundStyle(Theme.dim).multilineTextAlignment(.center).padding(6)
                        }
                    }
                }
                .frame(width: width, height: width * 1.5)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .bottomLeading) {
                    if item.progress > 0, item.progress < 1 {
                        ProgressBar(value: item.progress).padding(6)
                    } else if !item.isEpisode, let r = state.rating(item.isSeries ? "tv" : "movie", item.tmdbId) {
                        StarBadge(value: r.avg).padding(6)
                    }
                }

                if item.played {
                    Image(systemName: "checkmark")
                        .font(.caption2.bold())
                        .padding(5)
                        .background(Theme.accent, in: Circle())
                        .padding(6)
                } else if let n = item.UserData?.UnplayedItemCount, n > 0 {
                    Text("\(n)")
                        .font(.caption2.bold())
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Theme.accent, in: Capsule())
                        .padding(6)
                }
            }
            Text(item.isEpisode ? (item.SeriesName ?? item.name) : item.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Text(item.isEpisode ? "\(item.episodeLabel) · \(item.name)" : item.ProductionYear.map { String($0) } ?? " ")
                .font(.caption)
                .foregroundStyle(Theme.dim)
                .lineLimit(1)
        }
        .frame(width: width)
    }
}

/// Affiche d'un titre TMDB, avec son statut sur le serveur (disponible, en cours, en attente).
struct TmdbPosterCard: View {
    @Environment(AppState.self) private var state
    let id: Int
    let type: String
    let title: String
    var subtitle: String?
    var poster: URL?
    var width: CGFloat = 130

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncImage(url: poster) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else {
                    ZStack { Theme.surfaceHigh; Text(title).font(.caption).foregroundStyle(Theme.dim).multilineTextAlignment(.center).padding(6) }
                }
            }
            .frame(width: width, height: width * 1.5)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .topTrailing) {
                if let st = state.status(type, id), let b = StatusBadge.of(st) {
                    Image(systemName: b.0)
                        .font(.caption2.bold())
                        .foregroundStyle(b.1)
                        .padding(5)
                        .background(.black.opacity(0.75), in: Circle())
                        .padding(6)
                }
            }
            .overlay(alignment: .bottomLeading) {
                if let r = state.rating(type, id) { StarBadge(value: r.avg).padding(6) }
            }
            Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
            Text(subtitle ?? " ").font(.caption).foregroundStyle(Theme.dim).lineLimit(1)
        }
        .frame(width: width)
    }
}

enum StatusBadge {
    static func of(_ st: Int) -> (String, Color)? {
        switch st {
        case 5: return ("checkmark", .white)
        case 4: return ("minus", .white)
        case 3: return ("clock", .orange)
        case 2: return ("hourglass", .orange)
        default: return nil
        }
    }
}

/// Grande vignette 16:9 (reprendre la lecture).
struct WideCard: View {
    @Environment(AppSession.self) private var session
    let item: JfItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncImage(url: session.jellyfin.thumbURL(item)) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Theme.surfaceHigh }
            }
            .frame(width: 260, height: 146)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(alignment: .bottom) {
                if item.progress > 0 { ProgressBar(value: item.progress).padding(8) }
            }
            .overlay {
                Image(systemName: "play.fill")
                    .font(.title3)
                    .padding(12)
                    .background(.ultraThinMaterial, in: Circle())
            }
            Text(item.isEpisode ? (item.SeriesName ?? item.name) : item.name)
                .font(.subheadline.weight(.semibold)).lineLimit(1)
            if item.isEpisode {
                Text("\(item.episodeLabel) · \(item.name)").font(.caption).foregroundStyle(Theme.dim).lineLimit(1)
            }
        }
        .frame(width: 260)
    }
}

struct ProgressBar: View {
    let value: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.25))
                Capsule().fill(Theme.accent).frame(width: g.size.width * min(max(value, 0), 1))
            }
        }
        .frame(height: 4)
    }
}

/// Rangée horizontale avec titre.
struct ShelfRow<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.title3.bold())
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(Theme.dim) }
            }
            .padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 14) { content() }
                    .padding(.horizontal)
            }
            .scrollClipDisabled()
        }
    }
}

struct ErrorBox: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle").font(.title).foregroundStyle(.orange)
            Text(message).multilineTextAlignment(.center).foregroundStyle(Theme.dim)
            if let retry { Button("Réessayer", action: retry).buttonStyle(.bordered) }
        }
        .padding(30)
        .frame(maxWidth: .infinity)
    }
}

/// Lien vers la fiche d'un élément (épisode : lecture directe).
struct ItemLink<Label: View>: View {
    let item: JfItem
    @ViewBuilder var label: () -> Label
    @State private var playing: JfItem?

    var body: some View {
        if item.isEpisode {
            Button { playing = item } label: { label() }
                .buttonStyle(.plain)
                .playerCover(item: $playing)
        } else {
            NavigationLink(value: Route.jellyfin(item)) { label() }.buttonStyle(.plain)
        }
    }
}

struct Chip: View {
    let label: String
    var icon: String?
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let icon { Image(systemName: icon).font(.caption) }
                Text(label).font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(on ? Color.white : Theme.surfaceHigh, in: Capsule())
            .foregroundStyle(on ? Color.black : Color.white)
        }
        .buttonStyle(.plain)
    }
}

// ——— Navigation ———

enum Route: Hashable {
    case jellyfin(JfItem)
    case library(JfItem)
    case tmdb(type: String, id: Int)
    case calendar
    case chat
    case profile
    case ideas(problems: Bool)
    case sessions
    case users
    case liveSources
}

/// Écran correspondant à une destination.
struct RouteView: View {
    let route: Route
    var body: some View {
        switch route {
        case .jellyfin(let item): ItemDetailView(item: item)
        case .library(let view): LibraryGridView(view: view)
        case .tmdb(let type, let id): TmdbDetailView(type: type, tmdbId: id)
        case .calendar: CalendarView()
        case .chat: ChatView()
        case .profile: ProfileView()
        case .ideas(let problems): IdeasView(problemsOnly: problems)
        case .sessions: SessionsView()
        case .users: UsersView()
        case .liveSources: LiveSourcesView()
        }
    }
}

extension View {
    /// Destinations de navigation communes à tous les onglets.
    func appDestinations() -> some View {
        navigationDestination(for: Route.self) { RouteView(route: $0) }
    }
}

/// Ouvre la bonne fiche pour un titre TMDB : Jellyfin s'il est sur le serveur, sinon la fiche TMDB.
struct TmdbLink<Label: View>: View {
    let type: String
    let id: Int
    @ViewBuilder var label: () -> Label
    var body: some View {
        NavigationLink(value: Route.tmdb(type: type, id: id)) { label() }.buttonStyle(.plain)
    }
}
