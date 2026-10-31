// Accueil : une grande image, puis Reprendre, À suivre et les nouveautés de chaque bibliothèque.
import SwiftUI

struct HomeView: View {
    @EnvironmentObject var session: Session
    @State private var resume: [JFItem] = []
    @State private var nextUp: [JFItem] = []
    @State private var latest: [(JFItem, [JFItem])] = []
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
                        if let hero = (resume.first ?? latest.first?.1.first) { Hero(item: hero) }
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
        .refreshable { await load() }
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
                if let items = try? await c.latest(parent: lib.Id), !items.isEmpty { rows.append((lib, items)) }
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
    }
}

struct Hero: View {
    @EnvironmentObject var session: Session
    let item: JFItem

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: session.client?.imageURL(item, kind: "Backdrop", width: 1920))
                .frame(height: 420)
                .clipped()
            LinearGradient(colors: [.clear, .black.opacity(0.4), .black], startPoint: .top, endPoint: .bottom)
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
                    Button { session.play(item) } label: {
                        Label(item.progress != nil ? "Reprendre" : "Lecture", systemImage: "play.fill")
                            .fontWeight(.semibold)
                            .padding(.horizontal, 20).padding(.vertical, 10)
                            .background(.white, in: Capsule())
                            .foregroundStyle(.black)
                    }
                    .buttonStyle(.plain)
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
        .frame(height: 420)
    }
}
