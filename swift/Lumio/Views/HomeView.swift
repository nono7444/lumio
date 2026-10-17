import SwiftUI

/// Rangées de l'accueil (ordre et visibilité personnalisables).
enum HomeRow: String, CaseIterable, Identifiable {
    case hero, movieNight, familyTop, resume, nextUp, latest, favorites, trending
    var id: String { rawValue }
    var label: String {
        switch self {
        case .hero: return "À la une"
        case .movieNight: return "🍿 Prochaine soirée cinéma"
        case .familyTop: return "⭐ Coups de cœur de la famille"
        case .resume: return "Reprendre"
        case .nextUp: return "À suivre"
        case .latest: return "Derniers ajouts"
        case .favorites: return "Favoris"
        case .trending: return "Tendances de la semaine"
        }
    }
    static let defaultOrder: [HomeRow] = [.hero, .resume, .nextUp, .movieNight, .familyTop, .latest, .trending, .favorites]
    static let hiddenByDefault: Set<HomeRow> = [.favorites]
}

@MainActor
@Observable
final class HomeLayout {
    var order: [HomeRow]
    var hidden: Set<HomeRow>

    init() {
        let d = UserDefaults.standard
        let saved = (d.stringArray(forKey: "home.order") ?? []).compactMap(HomeRow.init(rawValue:))
        order = saved + HomeRow.defaultOrder.filter { !saved.contains($0) }
        hidden = Set((d.stringArray(forKey: "home.hidden") ?? HomeRow.hiddenByDefault.map(\.rawValue)).compactMap(HomeRow.init(rawValue:)))
    }

    func save() {
        UserDefaults.standard.set(order.map(\.rawValue), forKey: "home.order")
        UserDefaults.standard.set(hidden.map(\.rawValue), forKey: "home.hidden")
    }
}

struct HomeView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state
    @State private var layout = HomeLayout()
    @State private var resume: [JfItem] = []
    @State private var nextUp: [JfItem] = []
    @State private var favorites: [JfItem] = []
    @State private var latest: [LatestShelf] = []
    @State private var reco: Recommendation?
    @State private var top: [TopRated] = []
    @State private var trending: [TmdbItem] = []
    @State private var error: String?
    @State private var loaded = false
    @State private var customizing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                ForEach(layout.order.filter { !layout.hidden.contains($0) }) { row in
                    rowView(row)
                }
                if let error { ErrorBox(message: error) { Task { await load() } } }
                if !loaded { ProgressView().frame(maxWidth: .infinity).padding(40) }
            }
            .padding(.bottom, 30)
        }
        .background(Color.black)
        .navigationTitle("Lumio")
        .toolbar { shortcuts }
        .appDestinations()
        .refreshable { await load() }
        .task { if !loaded { await load() } }
        .sheet(isPresented: $customizing) { CustomizeHomeView(layout: layout) }
    }

    @ToolbarContentBuilder
    private var shortcuts: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if session.isAdmin && state.problemCount > 0 {
                NavigationLink(value: Route.ideas(problems: true)) {
                    Label("\(state.problemCount) problème(s) signalé(s)", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
                .badge(state.problemCount)
            }
            NavigationLink(value: Route.calendar) { Label("Calendrier", systemImage: "calendar") }
            NavigationLink(value: Route.chat) {
                Label("Chat", systemImage: state.unreadChat ? "bubble.left.and.bubble.right.fill" : "bubble.left.and.bubble.right")
                    .foregroundStyle(state.unreadChat ? Color.red : Color.primary)
            }
            Menu {
                Button { customizing = true } label: { Label("Personnaliser l'accueil", systemImage: "slider.horizontal.3") }
                NavigationLink(value: Route.profile) { Label("Profil", systemImage: "person.crop.circle") }
            } label: {
                Label("Profil", systemImage: "person.crop.circle")
            }
        }
    }

    @ViewBuilder
    private func rowView(_ row: HomeRow) -> some View {
        switch row {
        case .hero:
            let items = latest.flatMap(\.items).filter { !$0.isEpisode }.prefix(6)
            if !items.isEmpty { HeroCarousel(items: Array(items)) }
        case .movieNight:
            if let reco, !reco.items.isEmpty {
                ShelfRow(title: HomeRow.movieNight.label, subtitle: reco.because.isEmpty ? nil : "Parce que tu aimes : \(reco.because.joined(separator: ", "))") {
                    ForEach(reco.items) { i in ItemLink(item: i) { PosterCard(item: i) } }
                }
            }
        case .familyTop:
            if !top.isEmpty {
                ShelfRow(title: HomeRow.familyTop.label) {
                    ForEach(top) { t in
                        TmdbLink(type: t.type, id: t.tmdbId) {
                            TmdbPosterCard(id: t.tmdbId, type: t.type, title: t.title ?? "", subtitle: "★ \(String(format: "%.1f", t.avg)) · \(t.count) avis",
                                           poster: t.poster.flatMap(URL.init(string:)))
                        }
                    }
                }
            }
        case .resume:
            if !resume.isEmpty {
                ShelfRow(title: "Reprendre") { ForEach(resume) { i in ItemLink(item: i) { WideCard(item: i) } } }
            }
        case .nextUp:
            if !nextUp.isEmpty {
                ShelfRow(title: "À suivre") { ForEach(nextUp) { i in ItemLink(item: i) { WideCard(item: i) } } }
            }
        case .latest:
            ForEach(latest) { shelf in
                if !shelf.items.isEmpty {
                    ShelfRow(title: "Derniers ajouts · \(shelf.view.name)") {
                        ForEach(shelf.items) { i in ItemLink(item: i) { PosterCard(item: i) } }
                    }
                }
            }
        case .favorites:
            if !favorites.isEmpty {
                ShelfRow(title: "Favoris") { ForEach(favorites) { i in ItemLink(item: i) { PosterCard(item: i) } } }
            }
        case .trending:
            if !trending.isEmpty {
                ShelfRow(title: HomeRow.trending.label) {
                    ForEach(trending) { t in
                        TmdbLink(type: t.kind, id: t.id) { TmdbPosterCard(id: t.id, type: t.kind, title: t.displayTitle, subtitle: t.year, poster: t.poster) }
                    }
                }
            }
        }
    }

    private func load() async {
        let api = session.jellyfin
        do {
            async let r = api.resume()
            async let n = api.nextUp()
            async let f = api.favorites()
            let views = try await api.views()
            // Derniers ajouts : seulement les sorties de l'année en cours et suivantes (nouvelles saisons comprises)
            let year = Calendar.current.component(.year, from: Date())
            var out: [LatestShelf] = []
            for v in views where v.CollectionType == "movies" || v.CollectionType == "tvshows" {
                let items = (try? await api.latest(parentId: v.Id, limit: 60)) ?? []
                let recent = items.filter { ($0.ProductionYear ?? 0) >= year || $0.isEpisode }
                out.append(LatestShelf(view: v, items: recent.isEmpty ? Array(items.prefix(20)) : recent))
            }
            latest = out
            resume = (try? await r) ?? []
            nextUp = (try? await n) ?? []
            favorites = (try? await f) ?? []
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
        reco = await Recommendation.nextMovieNight(session)
        top = (try? await session.lumio.topRated()) ?? []
        if session.hasTmdb { trending = (try? await session.tmdb.trending()) ?? [] }
    }
}

struct LatestShelf: Identifiable {
    let view: JfItem
    let items: [JfItem]
    var id: String { view.Id }
}

/// Grand carrousel en haut de l'accueil (derniers ajouts).
struct HeroCarousel: View {
    @Environment(AppSession.self) private var session
    let items: [JfItem]

    var body: some View {
        TabView {
            ForEach(items) { item in
                NavigationLink(value: Route.jellyfin(item)) {
                    ZStack(alignment: .bottomLeading) {
                        AsyncImage(url: session.jellyfin.backdropURL(item)) { phase in
                            if case .success(let img) = phase { img.resizable().scaledToFill() } else { Theme.surfaceHigh }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                        LinearGradient(colors: [.clear, .black], startPoint: .center, endPoint: .bottom)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Nouveau").font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 3).glassCard(cornerRadius: 8)
                            Text(item.name).font(.largeTitle.bold()).lineLimit(2)
                            HStack {
                                if let y = item.ProductionYear { Text(String(y)) }
                                if let g = item.Genres?.prefix(2), !g.isEmpty { Text(g.joined(separator: " • ")) }
                            }
                            .foregroundStyle(Theme.dim)
                        }
                        .padding()
                        .padding(.bottom, 24)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        #if os(iOS)
        .tabViewStyle(.page)
        #endif
        .frame(height: 340)
    }
}

/// Personnaliser l'accueil : ordre (glisser) et visibilité des rangées.
struct CustomizeHomeView: View {
    @Environment(\.dismiss) private var dismiss
    let layout: HomeLayout

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(layout.order) { row in
                        Toggle(row.label, isOn: Binding(
                            get: { !layout.hidden.contains(row) },
                            set: { on in
                                if on { layout.hidden.remove(row) } else { layout.hidden.insert(row) }
                                layout.save()
                            }
                        ))
                    }
                    .onMove { from, to in
                        layout.order.move(fromOffsets: from, toOffset: to)
                        layout.save()
                    }
                } footer: {
                    Text("Glisse les rangées pour changer leur ordre.")
                }
                Section {
                    Button("Réinitialiser") {
                        layout.order = HomeRow.defaultOrder
                        layout.hidden = HomeRow.hiddenByDefault
                        layout.save()
                    }
                }
            }
            #if os(iOS)
            .environment(\.editMode, .constant(.active))
            #endif
            .navigationTitle("Personnaliser")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { dismiss() } } }
        }
    }
}

// ——— « Prochaine soirée cinéma » : calculée sur l'appareil à partir de ce que tu regardes ———

struct Recommendation {
    let items: [JfItem]
    let because: [String]

    @MainActor
    static func nextMovieNight(_ session: AppSession) async -> Recommendation {
        let api = session.jellyfin
        async let playedQ = api.query(types: "Movie,Series", filters: "IsPlayed", sort: "DatePlayed", limit: 80)
        async let resumeQ = api.resume()
        async let favQ = api.favorites()
        async let candQ = api.query(types: "Movie", filters: "IsUnplayed", sort: "Random", order: "Ascending", limit: 500)
        let played = (try? await playedQ) ?? []
        let resume = (try? await resumeQ) ?? []
        let favs = (try? await favQ) ?? []
        let candidates = (try? await candQ) ?? []

        var taste: [String: Double] = [:]
        for (i, it) in played.enumerated() { for g in it.Genres ?? [] { taste[g, default: 0] += 1 / (1 + Double(i) / 15) } }
        for it in resume { for g in it.Genres ?? [] { taste[g, default: 0] += 0.8 } }
        for it in favs { for g in it.Genres ?? [] { taste[g, default: 0] += 2 } }
        let total = max(taste.values.reduce(0, +), 1)
        let year = Calendar.current.component(.year, from: Date())
        let inProgress = Set(resume.map(\.Id))

        let scored = candidates.filter { !inProgress.contains($0.Id) }.map { c -> (JfItem, Double) in
            let affinity = (c.Genres ?? []).reduce(0) { $0 + (taste[$1] ?? 0) } / total
            let rating = (c.CommunityRating ?? 6) / 10
            let recent = (c.ProductionYear ?? 0) >= year - 3 ? 0.15 : 0
            return (c, affinity * 3 + rating * 0.8 + recent)
        }.sorted { $0.1 > $1.1 }

        // Tirage stable sur la journée : la sélection change chaque jour, pas à chaque ouverture
        var x = UInt64(Date().timeIntervalSince1970 / 86400) % 2147483647
        if x == 0 { x = 1 }
        func rnd() -> Double { x = (x * 48271) % 2147483647; return Double(x) / 2147483647 }
        let items = scored.prefix(40).map { ($0.0, $0.1 + rnd() * 0.35) }.sorted { $0.1 > $1.1 }.prefix(15).map(\.0)
        let because = taste.sorted { $0.value > $1.value }.prefix(3).map(\.key)
        return Recommendation(items: Array(items), because: Array(because))
    }
}
