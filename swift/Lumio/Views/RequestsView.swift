import SwiftUI

/// Demandes de la famille (serveur Lumio) : filtres, suivi des téléchargements, actions de l'admin.
struct RequestsView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state
    @State private var requests: [LumioRequest] = []
    @State private var filter = "all"
    @State private var error: String?
    @State private var loaded = false
    @State private var declining: LumioRequest?
    @State private var reason = ""
    @State private var open: Route?

    static let filters: [(String, String)] = [
        ("all", "Toutes"), ("pending", "En attente"), ("processing", "En cours"), ("available", "Disponibles"),
        ("declined", "Refusées"), ("failed", "Échecs"),
    ]

    var body: some View {
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(RequestsView.filters, id: \.0) { f in
                            Chip(label: f.0 == "pending" && state.pendingRequests > 0 ? "\(f.1) · \(state.pendingRequests)" : f.1, on: filter == f.0) { filter = f.0 }
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
            if let error {
                ErrorBox(message: error) { Task { await load() } }.listRowBackground(Color.clear)
            }
            ForEach(requests) { r in
                row(r)
                    .contentShape(Rectangle())
                    .onTapGesture { open = .tmdb(type: r.type, id: r.tmdbId) }
                    .listRowBackground(Theme.surface)
                    .swipeActions(edge: .trailing) {
                        if session.isAdmin {
                            Button(role: .destructive) { act(r, "delete") } label: { Label("Supprimer", systemImage: "trash") }
                            if r.status == 1 { Button { declining = r } label: { Label("Refuser", systemImage: "xmark") }.tint(.orange) }
                        } else if r.requestedBy.id == session.userId && r.status == 1 {
                            Button(role: .destructive) { act(r, "delete") } label: { Label("Annuler", systemImage: "xmark") }
                        }
                    }
                    .swipeActions(edge: .leading) {
                        if session.isAdmin && (r.status == 1 || r.status == 4) {
                            Button { act(r, r.status == 4 ? "retry" : "approve") } label: { Label(r.status == 4 ? "Réessayer" : "Approuver", systemImage: "checkmark") }.tint(.green)
                        }
                    }
            }
            if loaded && requests.isEmpty && error == nil {
                Text("Aucune demande").foregroundStyle(Theme.dim).listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.black)
        .navigationTitle("Demandes")
        .appDestinations()
        .navigationDestination(item: $open) { RouteView(route: $0) }
        .refreshable { await load() }
        .task(id: filter) {
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(8))
                await load()
            }
        }
        .alert("Refuser la demande", isPresented: Binding(get: { declining != nil }, set: { if !$0 { declining = nil } })) {
            TextField("Raison (facultatif)", text: $reason)
            Button("Annuler", role: .cancel) { declining = nil }
            Button("Refuser", role: .destructive) {
                if let r = declining { act(r, "decline", reason: reason) }
                reason = ""
                declining = nil
            }
        }
    }

    private func row(_ r: LumioRequest) -> some View {
        HStack(spacing: 12) {
            AsyncImage(url: r.poster.flatMap(URL.init(string:))) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Theme.surfaceHigh }
            }
            .frame(width: 54, height: 81)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 5) {
                Text(r.title).font(.headline).lineLimit(2)
                Text("\(r.type == "tv" ? "Série" : "Film")\(r.year.map { " · \($0)" } ?? "") · \(r.requestedBy.name) · \(timeAgo(r.createdAt))")
                    .font(.caption).foregroundStyle(Theme.dim)
                if let s = r.seasons, !s.isEmpty {
                    Text("Saison\(s.count > 1 ? "s" : "") \(s.map { String($0) }.joined(separator: ", "))").font(.caption).foregroundStyle(Theme.dim)
                }
                let st = r.statusLabel
                Text(st.0)
                    .font(.caption.bold())
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color(hex: st.1).opacity(0.18), in: Capsule())
                    .foregroundStyle(Color(hex: st.1))
                if let d = r.download { downloadLine(d) }
                if let reason = r.reason { Text("Raison : \(reason)").font(.caption).foregroundStyle(Theme.dim) }
                if let e = r.error { Text(e).font(.caption).foregroundStyle(.red).lineLimit(2) }
                if session.isAdmin && (r.status == 1 || r.status == 4) {
                    HStack {
                        Button(r.status == 4 ? "Réessayer" : "Approuver") { act(r, r.status == 4 ? "retry" : "approve") }
                            .buttonStyle(.borderedProminent).controlSize(.small)
                        if r.status == 1 { Button("Refuser") { declining = r }.buttonStyle(.bordered).controlSize(.small) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func downloadLine(_ d: LumioRequest.Download) -> some View {
        switch d.state {
        case "downloading":
            VStack(alignment: .leading, spacing: 3) {
                Text("Téléchargement \(Int(d.progress ?? 0)) %").font(.caption).foregroundStyle(Theme.accent)
                ProgressBar(value: (d.progress ?? 0) / 100).frame(maxWidth: 220)
            }
        case "searching": Text("Recherche d'une source…").font(.caption).foregroundStyle(Theme.dim)
        case "importing": Text("Import dans Jellyfin…").font(.caption).foregroundStyle(Theme.dim)
        case "warning": Text("⚠️ \(d.message ?? "À vérifier")").font(.caption).foregroundStyle(.orange).lineLimit(2)
        default: EmptyView()
        }
    }

    private func load() async {
        do {
            requests = try await session.lumio.requests(filter: filter).results
            error = nil
        } catch {
            if requests.isEmpty { self.error = error.localizedDescription }
        }
        loaded = true
    }

    private func act(_ r: LumioRequest, _ kind: String, reason: String? = nil) {
        Task {
            do {
                let api = session.lumio
                switch kind {
                case "approve": try await api.approve(r.id)
                case "retry": try await api.retry(r.id)
                case "decline": try await api.decline(r.id, reason: reason)
                default: try await api.remove(r.id)
                }
                Toast.shared.show(kind == "approve" || kind == "retry" ? "Demande approuvée : téléchargement lancé." : kind == "decline" ? "Demande refusée." : "Demande supprimée.")
                await load()
                await state.refresh(session)
            } catch {
                Toast.shared.show(error.localizedDescription, error: true)
            }
        }
    }
}
