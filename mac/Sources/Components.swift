// Briques communes : affiches, vignettes « à reprendre », rangées.
import SwiftUI

struct RemoteImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
            switch phase {
            case .success(let img): img.resizable().aspectRatio(contentMode: contentMode)
            default: Rectangle().fill(Theme.surfaceHigh)
            }
        }
    }
}

/// Affiche verticale (2:3) avec titre dessous ; un clic ouvre la fiche.
struct PosterCard: View {
    @EnvironmentObject var session: Session
    let item: JFItem
    var width: CGFloat = 150
    @State private var hover = false

    var body: some View {
        NavigationLink(value: item) {
            VStack(alignment: .leading, spacing: 6) {
                RemoteImage(url: session.client?.imageURL(item, width: 360))
                    .frame(width: width, height: width * 1.5)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(alignment: .bottom) { ProgressLine(value: item.progress) }
                    .overlay(alignment: .topTrailing) {
                        if item.UserData?.Played == true {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.white, Theme.accent)
                                .padding(6)
                        }
                    }
                    .shadow(color: .black.opacity(hover ? 0.6 : 0), radius: 12, y: 6)
                    .scaleEffect(hover ? 1.04 : 1)
                Text(item.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                Text(item.subtitle).font(.system(size: 11)).foregroundStyle(Theme.dim).lineLimit(1)
            }
            .frame(width: width)
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(.easeOut(duration: 0.15)) { hover = h } }
    }
}

/// Vignette horizontale (16:9) pour « Reprendre » et « À suivre » : un clic lance la lecture.
struct ResumeCard: View {
    @EnvironmentObject var session: Session
    let item: JFItem
    @State private var hover = false

    var body: some View {
        Button { session.play(item) } label: {
            VStack(alignment: .leading, spacing: 6) {
                ZStack {
                    RemoteImage(url: session.client?.imageURL(item, kind: "Backdrop", width: 640) ?? session.client?.imageURL(item, width: 640))
                    LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                    Image(systemName: "play.fill")
                        .font(.system(size: 22, weight: .bold))
                        .padding(14)
                        .background(.ultraThinMaterial, in: Circle())
                        .opacity(hover ? 1 : 0)
                }
                .frame(width: 280, height: 158)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(alignment: .bottom) { ProgressLine(value: item.progress).padding(.horizontal, 10).padding(.bottom, 8) }
                Text(item.isEpisode ? (item.SeriesName ?? item.title) : item.title)
                    .font(.system(size: 13, weight: .semibold)).lineLimit(1)
                Text(item.isEpisode ? "\(item.subtitle.components(separatedBy: " · ").last ?? "") · \(item.title)" : item.subtitle)
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).lineLimit(1)
            }
            .frame(width: 280)
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(.easeOut(duration: 0.15)) { hover = h } }
    }
}

struct ProgressLine: View {
    let value: Double?
    var body: some View {
        if let v = value, v > 0.01 {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.25))
                    Capsule().fill(Theme.accent).frame(width: g.size.width * v)
                }
            }
            .frame(height: 4)
            .padding(6)
        }
    }
}

/// Rangée horizontale avec titre.
struct Row<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 20, weight: .bold)).padding(.horizontal, 28)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 16) { content() }
                    .padding(.horizontal, 28)
                    .padding(.vertical, 4)
            }
        }
    }
}

struct LoadingView: View {
    var body: some View { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
}

struct MessageView: View {
    let icon: String
    let text: String
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 34)).foregroundStyle(Theme.faint)
            Text(text).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
    }
}
