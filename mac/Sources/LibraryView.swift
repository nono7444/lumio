// Une bibliothèque (Films, Séries…) en grille, avec tri ; et la recherche.
import SwiftUI

struct LibraryView: View {
    @EnvironmentObject var session: Session
    let parentId: String
    let name: String
    @State private var items: [JFItem] = []
    @State private var total = 0
    @State private var sort = "DateCreated"
    @State private var loading = false

    private let sorts: [(String, String)] = [("DateCreated", "Ajouts récents"), ("SortName", "Titre"), ("PremiereDate", "Date de sortie"), ("CommunityRating", "Note")]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    Text(name).font(.system(size: 30, weight: .heavy))
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
        .task(id: sort) { await reload() }
    }

    private func reload() async {
        items = []
        total = 0
        await more()
    }

    private func more() async {
        guard let c = session.client, !loading, items.isEmpty || items.count < total else { return }
        loading = true
        let order = sort == "SortName" ? "Ascending" : "Descending"
        if let page = try? await c.items(parent: parentId, sort: sort, order: order, start: items.count, limit: 120) {
            items += page.Items
            total = page.TotalRecordCount ?? items.count
        }
        loading = false
    }
}

struct SearchView: View {
    @EnvironmentObject var session: Session
    @State private var query = ""
    @State private var results: [JFItem] = []
    @State private var searching = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.dim)
                TextField("Film ou série", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 20))
                    .focused($focused)
                if searching { ProgressView().controlSize(.small) }
            }
            .padding(14)
            .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 28)
            .padding(.top, 28)

            if results.isEmpty {
                MessageView(icon: "film.stack", text: query.count < 2 ? "Cherche dans tes films et tes séries." : (searching ? "" : "Rien trouvé pour « \(query) »."))
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 170), spacing: 18, alignment: .top)], spacing: 22) {
                        ForEach(results) { PosterCard(item: $0) }
                    }
                    .padding(28)
                }
            }
        }
        .onAppear { focused = true }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { results = []; return }
            try? await Task.sleep(nanoseconds: 300_000_000) // on attend la fin de la frappe
            guard !Task.isCancelled, let c = session.client else { return }
            searching = true
            results = (try? await c.search(q)) ?? []
            searching = false
        }
    }
}
