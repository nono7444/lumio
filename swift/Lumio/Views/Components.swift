import SwiftUI

/// Affiche (2:3) avec coche « vu », progression et nombre d'épisodes non vus.
struct PosterCard: View {
    @Environment(AppSession.self) private var session
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
                .overlay(alignment: .bottom) {
                    if item.progress > 0, item.progress < 1 {
                        ProgressBar(value: item.progress).padding(6)
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
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.title3.bold()).padding(.horizontal)
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
    @State private var playing = false

    var body: some View {
        if item.isEpisode {
            Button { playing = true } label: { label() }
                .buttonStyle(.plain)
                .playerCover(isPresented: $playing, item: item)
        } else {
            NavigationLink(value: item) { label() }.buttonStyle(.plain)
        }
    }
}
