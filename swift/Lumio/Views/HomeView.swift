import SwiftUI

struct HomeView: View {
    @Environment(AppSession.self) private var session
    @State private var resume: [JfItem] = []
    @State private var nextUp: [JfItem] = []
    @State private var latest: [LatestShelf] = []
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if let hero = latest.first?.items.first {
                    HeroBanner(item: hero)
                }
                if !resume.isEmpty {
                    ShelfRow(title: "Reprendre") {
                        ForEach(resume) { i in ItemLink(item: i) { WideCard(item: i) } }
                    }
                }
                if !nextUp.isEmpty {
                    ShelfRow(title: "À suivre") {
                        ForEach(nextUp) { i in ItemLink(item: i) { WideCard(item: i) } }
                    }
                }
                ForEach(latest) { shelf in
                    if !shelf.items.isEmpty {
                        ShelfRow(title: "Derniers ajouts · \(shelf.view.name)") {
                            ForEach(shelf.items) { i in ItemLink(item: i) { PosterCard(item: i) } }
                        }
                    }
                }
                if let error { ErrorBox(message: error) { Task { await load() } } }
                if !loaded { ProgressView().frame(maxWidth: .infinity).padding(40) }
            }
            .padding(.bottom, 30)
        }
        .background(Color.black)
        .navigationTitle("Lumio")
        .itemDestinations()
        .refreshable { await load() }
        .task { if !loaded { await load() } }
    }

    private func load() async {
        let api = session.jellyfin
        do {
            async let r = api.resume()
            async let n = api.nextUp()
            let views = try await api.views()
            var out: [LatestShelf] = []
            for v in views where v.CollectionType == "movies" || v.CollectionType == "tvshows" {
                out.append(LatestShelf(view: v, items: (try? await api.latest(parentId: v.Id)) ?? []))
            }
            resume = (try? await r) ?? []
            nextUp = (try? await n) ?? []
            latest = out
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

/// Grande image du dernier ajout, en haut de l'accueil.
struct LatestShelf: Identifiable {
    let view: JfItem
    let items: [JfItem]
    var id: String { view.Id }
}

struct HeroBanner: View {
    @Environment(AppSession.self) private var session
    let item: JfItem

    var body: some View {
        NavigationLink(value: item) {
            ZStack(alignment: .bottomLeading) {
                AsyncImage(url: session.jellyfin.backdropURL(item)) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() } else { Theme.surfaceHigh }
                }
                .frame(height: 300)
                .frame(maxWidth: .infinity)
                .clipped()
                LinearGradient(colors: [.clear, .black], startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Nouveau").font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 3).glassCard(cornerRadius: 8)
                    Text(item.name).font(.largeTitle.bold()).lineLimit(2)
                    if let y = item.ProductionYear { Text(String(y)).foregroundStyle(Theme.dim) }
                }
                .padding()
            }
        }
        .buttonStyle(.plain)
    }
}

extension View {
    /// Destinations de navigation communes : fiche d'un titre, contenu d'une bibliothèque.
    func itemDestinations() -> some View {
        navigationDestination(for: JfItem.self) { item in
            if item.isFolder || item.CollectionType != nil {
                LibraryGridView(view: item)
            } else {
                ItemDetailView(item: item)
            }
        }
    }
}
