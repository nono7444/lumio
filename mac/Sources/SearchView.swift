// Recherche : ta bibliothèque Jellyfin et tout TMDB (avec « Disponible » / « Demandé »), comme sur l'iPhone.
import SwiftUI

struct SearchView: View {
    @EnvironmentObject var session: Session
    @State private var query = ""
    @State private var local: [JFItem] = []
    @State private var tmdbResults: [TmdbItem] = []
    @State private var trending: [TmdbItem] = []
    @State private var status: (movies: [String: Int], series: [String: Int]) = ([:], [:])
    @State private var searching = false
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.dim)
                    TextField("Film, série…", text: $query)
                        .textFieldStyle(.plain)
                        .font(.system(size: 20))
                        .focused($focused)
                    if searching { ProgressView().controlSize(.small) }
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.dim) }.buttonStyle(.plain)
                    }
                }
                .padding(14)
                .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 12))

                if query.trimmingCharacters(in: .whitespaces).count < 2 {
                    if !trending.isEmpty {
                        Text("Tendances de la semaine").font(.system(size: 20, weight: .bold))
                        grid(trending)
                    }
                } else {
                    if !local.isEmpty {
                        Text("Dans ta bibliothèque").font(.system(size: 20, weight: .bold))
                        LazyVGrid(columns: columns, spacing: 22) { ForEach(local) { PosterCard(item: $0) } }
                    }
                    if !tmdbResults.isEmpty {
                        Text("Tous les films et séries").font(.system(size: 20, weight: .bold))
                        grid(tmdbResults)
                    }
                    if local.isEmpty && tmdbResults.isEmpty && !searching {
                        MessageView(icon: "film.stack", text: session.tmdb == nil ? "TMDB n’est pas disponible : vérifie le serveur Lumio dans Profil." : "Rien trouvé pour « \(query) ».")
                    }
                }
            }
            .padding(28)
        }
        .onAppear { focused = true }
        .task {
            if let l = session.lumio, let s = try? await l.library() { status = s }
            if trending.isEmpty, let t = session.tmdb { trending = (try? await t.trending()) ?? [] }
        }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { local = []; tmdbResults = []; return }
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            searching = true
            let c = session.client
            let t = session.tmdb
            async let a = c?.search(q)
            async let b = t?.search(q)
            local = ((try? await a) ?? nil) ?? []
            tmdbResults = ((try? await b) ?? nil) ?? []
            searching = false
        }
    }

    private var columns: [GridItem] { [GridItem(.adaptive(minimum: 150, maximum: 170), spacing: 18, alignment: .top)] }

    private func grid(_ list: [TmdbItem]) -> some View {
        LazyVGrid(columns: columns, spacing: 22) {
            ForEach(list) { i in
                let type = i.media_type == "tv" ? "tv" : "movie"
                let st = (type == "tv" ? status.series : status.movies)[String(i.id)]
                TmdbPosterCard(ref: MediaRef(type: type, tmdbId: i.id), title: i.displayTitle, year: i.year, poster: i.poster,
                               badge: MediaStatus.label(st))
            }
        }
    }
}
