// Bibliothèque : grandes cartes (une par bibliothèque Jellyfin + Collections Lumio), puis grille triée.
import SwiftUI

struct LibraryHomeView: View {
    @EnvironmentObject var session: Session
    @State private var libs: [(JFItem, Int?, [JFItem])] = []
    @State private var collections: [LumioCollection] = []
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageTitle(text: "Bibliothèque")
                if loading && libs.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 360, maximum: 520), spacing: 18)], spacing: 18) {
                    ForEach(libs, id: \.0.Id) { lib in
                        NavigationLink(value: LibRef(id: lib.0.Id, name: lib.0.title, collectionType: lib.0.CollectionType)) {
                            LibraryCard(title: lib.0.title, count: lib.1, unit: unit(lib.0.CollectionType), icon: icon(lib.0.CollectionType),
                                        posters: lib.2.prefix(3).compactMap { session.client?.imageURL($0, width: 360) },
                                        backdrop: lib.2.first.flatMap { session.client?.imageURL($0, kind: "Backdrop", width: 1280) },
                                        tint: tint(lib.0.CollectionType))
                        }
                        .buttonStyle(.plain)
                    }
                    if !collections.isEmpty {
                        NavigationLink(value: CollectionsRef()) {
                            LibraryCard(title: "Collections", count: collections.count, unit: ("saga", "sagas"), icon: "square.stack.fill",
                                        posters: collections.prefix(3).compactMap { $0.poster.flatMap(URL.init(string:)) },
                                        backdrop: nil, tint: tint("boxsets"))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(28)
        }
        .task { await load() }
    }

    private func load() async {
        guard let c = session.client else { return }
        let views = ((try? await c.views()) ?? [])
        var out: [(JFItem, Int?, [JFItem])] = []
        for v in views {
            // Les collections Jellyfin (souvent en vrac) sont remplacées par celles de Lumio
            if v.CollectionType == "boxsets" { continue }
            let page = try? await c.items(parent: v.Id, types: itemTypes(for: v.CollectionType), sort: "DateCreated", order: "Descending", start: 0, limit: 6)
            out.append((v, page?.TotalRecordCount, page?.Items ?? []))
        }
        libs = out
        loading = false
        collections = (try? await session.lumio?.collections()) ?? []
    }

    private func unit(_ t: String?) -> (String, String) {
        switch t {
        case "movies": return ("film", "films")
        case "tvshows": return ("série", "séries")
        default: return ("titre", "titres")
        }
    }
    private func icon(_ t: String?) -> String {
        switch t {
        case "movies": return "film.fill"
        case "tvshows": return "tv.fill"
        default: return "folder.fill"
        }
    }
    private func tint(_ t: String?) -> [Color] {
        switch t {
        case "movies": return [Color(red: 0.11, green: 0.16, blue: 0.29), Color(red: 0.04, green: 0.07, blue: 0.13)]
        case "tvshows": return [Color(red: 0.16, green: 0.11, blue: 0.29), Color(red: 0.07, green: 0.04, blue: 0.13)]
        case "boxsets": return [Color(red: 0.23, green: 0.16, blue: 0.07), Color(red: 0.10, green: 0.07, blue: 0.04)]
        default: return [Theme.surfaceHigh, Theme.surface]
        }
    }
}

struct LibraryCard: View {
    let title: String
    let count: Int?
    let unit: (String, String)
    let icon: String
    let posters: [URL]
    let backdrop: URL?
    let tint: [Color]
    @State private var hover = false

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: tint, startPoint: .topLeading, endPoint: .bottomTrailing)
            if let backdrop {
                RemoteImage(url: backdrop).opacity(0.55)
            }
            // Éventail des dernières affiches
            HStack(spacing: -46) {
                ForEach(Array(posters.reversed().enumerated()), id: \.offset) { pair in
                    let i = pair.offset
                    RemoteImage(url: pair.element)
                        .frame(width: 92, height: 138)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .shadow(radius: 8)
                        .rotationEffect(.degrees(Double(i - (posters.count - 1) / 2) * 7))
                        .zIndex(Double(i))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
            .padding(.trailing, 28)
            LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom)
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .frame(width: 34, height: 34)
                    .background(.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 20, weight: .heavy))
                    if let count { Text("\(count) \(count > 1 ? unit.1 : unit.0)").font(.system(size: 13)).foregroundStyle(Theme.dim) }
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.white.opacity(0.7))
            }
            .padding(18)
        }
        .frame(height: 230)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .scaleEffect(hover ? 1.02 : 1)
        .onHover { h in withAnimation(.easeOut(duration: 0.15)) { hover = h } }
    }
}

/// Une bibliothèque en grille, avec tri (seulement les films d'une bibliothèque Films, etc.).
struct LibraryView: View {
    @EnvironmentObject var session: Session
    let lib: LibRef
    @State private var items: [JFItem] = []
    @State private var total = 0
    @State private var sort = "DateCreated"
    @State private var loading = false
    @State private var fetched = 0

    private let sorts: [(String, String)] = [("DateCreated", "Ajouts récents"), ("SortName", "Titre"), ("PremiereDate", "Date de sortie"), ("CommunityRating", "Note")]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    PageTitle(text: lib.name)
                    Text("\(total)").foregroundStyle(Theme.dim)
                    Spacer()
                    Picker("Trier", selection: $sort) {
                        ForEach(sorts, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.menu)
                    .frame(width: 190)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 170), spacing: 18, alignment: .top)], spacing: 22) {
                    ForEach(items) { item in
                        PosterCard(item: item)
                            .onAppear { if item.Id == items.last?.Id { Task { await more() } } }
                    }
                }
                if loading { ProgressView().frame(maxWidth: .infinity) }
            }
            .padding(28)
        }
        .task(id: sort) {
            items = []
            total = 0
            fetched = 0
            await more()
        }
    }

    private func more() async {
        guard let c = session.client, !loading, fetched == 0 || fetched < total else { return }
        loading = true
        let order = sort == "SortName" ? "Ascending" : "Descending"
        let by = sort == "SortName" ? sort : "\(sort),SortName"
        if let page = try? await c.items(parent: lib.id, types: itemTypes(for: lib.collectionType), sort: by, order: order, start: fetched, limit: 120) {
            fetched += page.Items.count
            // Chaque titre une seule fois, même si deux pages se chevauchent
            var seen = Set(items.map(\.Id))
            items += page.Items.filter { seen.insert($0.Id).inserted }
            total = page.TotalRecordCount ?? fetched
        }
        loading = false
    }
}

/// Collections (sagas) rangées par le serveur Lumio.
struct CollectionsView: View {
    @EnvironmentObject var session: Session
    @State private var list: [LumioCollection] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageTitle(text: "Collections")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 170), spacing: 18, alignment: .top)], spacing: 22) {
                    ForEach(list) { c in
                        NavigationLink(value: c) {
                            VStack(alignment: .leading, spacing: 6) {
                                RemoteImage(url: c.poster.flatMap(URL.init(string:)))
                                    .frame(width: 150, height: 225)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                Text(c.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                                Text("\(c.items.count) sur \(c.total)").font(.system(size: 11)).foregroundStyle(Theme.dim)
                            }
                            .frame(width: 150)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(28)
        }
        .task { list = (try? await session.lumio?.collections()) ?? [] }
    }
}

struct CollectionDetailView: View {
    @EnvironmentObject var session: Session
    let collection: LumioCollection
    @State private var items: [JFItem] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ZStack(alignment: .bottomLeading) {
                    RemoteImage(url: collection.backdrop.flatMap(URL.init(string:))).frame(height: 300).clipped()
                    LinearGradient(colors: [.clear, .black], startPoint: .center, endPoint: .bottom)
                    VStack(alignment: .leading, spacing: 6) {
                        PageTitle(text: collection.name)
                        Text("\(collection.items.count) film\(collection.items.count > 1 ? "s" : "") sur \(collection.total)").foregroundStyle(Theme.dim)
                    }
                    .padding(28)
                }
                if let o = collection.overview, !o.isEmpty {
                    Text(o).foregroundStyle(.white.opacity(0.85)).frame(maxWidth: 760, alignment: .leading).padding(.horizontal, 28)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 170), spacing: 18, alignment: .top)], spacing: 22) {
                    ForEach(items) { PosterCard(item: $0) }
                }
                .padding(.horizontal, 28)
            }
            .padding(.bottom, 28)
        }
        .ignoresSafeArea(edges: .top)
        .task { items = (try? await session.client?.itemsByIds(collection.items.map(\.jfId))) ?? [] }
    }
}
