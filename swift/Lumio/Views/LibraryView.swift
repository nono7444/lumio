import SwiftUI

/// Bibliothèques Jellyfin en grandes cartes.
struct LibraryView: View {
    @Environment(AppSession.self) private var session
    @State private var views: [JfItem] = []
    @State private var error: String?

    private let columns = [GridItem(.adaptive(minimum: 300), spacing: 14)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(views) { v in
                    NavigationLink(value: Route.library(v)) {
                        ZStack(alignment: .bottomLeading) {
                            AsyncImage(url: session.jellyfin.thumbURL(v, width: 800)) { phase in
                                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Theme.surfaceHigh }
                            }
                            .frame(height: 170)
                            .frame(maxWidth: .infinity)
                            .clipped()
                            LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                            Text(v.name).font(.title2.bold()).padding()
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
            if let error { ErrorBox(message: error) { Task { await load() } } }
        }
        .background(Color.black)
        .navigationTitle("Bibliothèque")
        .appDestinations()
        .task { if views.isEmpty { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            views = try await session.jellyfin.views()
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// Contenu d'une bibliothèque : grille d'affiches, du plus récent au plus ancien, chargée par pages.
struct LibraryGridView: View {
    @Environment(AppSession.self) private var session
    let view: JfItem
    @State private var items: [JfItem] = []
    @State private var total = Int.max
    @State private var loading = false
    @State private var error: String?

    private let columns = [GridItem(.adaptive(minimum: 120, maximum: 170), spacing: 14)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
                ForEach(items) { i in
                    NavigationLink(value: Route.jellyfin(i)) { PosterCard(item: i, width: 120) }
                        .buttonStyle(.plain)
                        .onAppear { if i.Id == items.last?.Id { Task { await more() } } }
                }
            }
            .padding()
            if loading { ProgressView().padding() }
            if let error { ErrorBox(message: error) { Task { await more() } } }
        }
        .background(Color.black)
        .navigationTitle(view.name)
        .task { if items.isEmpty { await more() } }
    }

    private func more() async {
        guard !loading, items.count < total else { return }
        loading = true
        do {
            let r = try await session.jellyfin.items(parentId: view.Id, start: items.count)
            items += r.Items
            total = r.TotalRecordCount ?? items.count
            error = nil
        } catch { self.error = error.localizedDescription }
        loading = false
    }
}

struct SearchView: View {
    @Environment(AppSession.self) private var session
    @State private var query = ""
    @State private var local: [JfItem] = []
    @State private var tmdb: [TmdbItem] = []
    @State private var searching = false
    @State private var error: String?

    private let columns = [GridItem(.adaptive(minimum: 120, maximum: 170), spacing: 14)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if query.trimmingCharacters(in: .whitespaces).count < 2 {
                    VStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").font(.largeTitle).foregroundStyle(Theme.dim)
                        Text("Cherche un film ou une série : sur ton serveur, ou à demander.").foregroundStyle(Theme.dim).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity).padding(50)
                }
                if !local.isEmpty {
                    ShelfRow(title: "Sur ton serveur") {
                        ForEach(local) { i in NavigationLink(value: Route.jellyfin(i)) { PosterCard(item: i, width: 110) }.buttonStyle(.plain) }
                    }
                }
                if !tmdb.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Tous les films et séries").font(.title3.bold()).padding(.horizontal)
                        LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
                            ForEach(tmdb) { t in
                                TmdbLink(type: t.kind, id: t.id) {
                                    TmdbPosterCard(id: t.id, type: t.kind, title: t.displayTitle,
                                                   subtitle: "\(t.kind == "tv" ? "Série" : "Film")\(t.year.isEmpty ? "" : " · \(t.year)")",
                                                   poster: t.poster, width: 120)
                                }
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.orange).padding(.horizontal) }
                if searching { ProgressView().frame(maxWidth: .infinity) }
            }
            .padding(.vertical)
        }
        .background(Color.black)
        .navigationTitle("Recherche")
        .searchable(text: $query, prompt: "Films et séries")
        .appDestinations()
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { local = []; tmdb = []; return }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            searching = true
            async let l = session.jellyfin.search(q)
            if session.hasTmdb {
                do { tmdb = try await session.tmdb.search(q); error = nil } catch { self.error = error.localizedDescription }
            } else {
                error = "Ajoute ta clé TMDB (Profil) pour chercher les titres à demander."
            }
            local = (try? await l) ?? []
            searching = false
        }
    }
}
