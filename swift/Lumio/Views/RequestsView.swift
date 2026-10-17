import SwiftUI

/// Demandes de la famille (serveur Lumio) : statut et téléchargement en cours.
struct RequestsView: View {
    @Environment(AppSession.self) private var session
    @State private var requests: [LumioRequest] = []
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        List {
            if let error {
                ErrorBox(message: error) { Task { await load() } }.listRowBackground(Color.clear)
            }
            ForEach(requests) { r in
                HStack(spacing: 12) {
                    AsyncImage(url: r.poster.flatMap(URL.init(string:))) { phase in
                        if case .success(let img) = phase { img.resizable().scaledToFill() } else { Theme.surfaceHigh }
                    }
                    .frame(width: 54, height: 81)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(r.title).font(.headline).lineLimit(2)
                        Text("\(r.type == "tv" ? "Série" : "Film")\(r.year.map { " · \($0)" } ?? "") · \(r.requestedBy.name)")
                            .font(.caption).foregroundStyle(Theme.dim)
                        let st = r.statusLabel
                        Text(st.0)
                            .font(.caption.bold())
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color(hex: st.1).opacity(0.18), in: Capsule())
                            .foregroundStyle(Color(hex: st.1))
                        if let d = r.download {
                            downloadLine(d)
                        }
                    }
                }
                .listRowBackground(Theme.surface)
            }
            if loaded && requests.isEmpty && error == nil {
                Text("Aucune demande pour l'instant").foregroundStyle(Theme.dim).listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.black)
        .navigationTitle("Demandes")
        .refreshable { await load() }
        .task {
            await load()
            // Suivi en direct des téléchargements
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(8))
                await load()
            }
        }
    }

    @ViewBuilder
    private func downloadLine(_ d: LumioRequest.Download) -> some View {
        switch d.state {
        case "downloading":
            VStack(alignment: .leading, spacing: 3) {
                Text("Téléchargement \(Int((d.progress ?? 0)))%").font(.caption).foregroundStyle(Theme.accent)
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
            requests = try await session.lumio.requests()
            error = nil
        } catch {
            if requests.isEmpty { self.error = error.localizedDescription }
        }
        loaded = true
    }
}

struct ProfileView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        @Bindable var s = session
        Form {
            Section("Compte Jellyfin") {
                LabeledContent("Utilisateur", value: session.userName)
                LabeledContent("Serveur", value: session.serverURL)
                if session.isAdmin { LabeledContent("Rôle", value: "Administrateur") }
            }
            Section {
                TextField("Adresse", text: $s.lumioURL)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                    .onSubmit { session.save() }
            } header: {
                Text("Serveur Lumio")
            } footer: {
                Text("Pour les demandes. Par défaut : https://lumio.wawanono.lol")
            }
            Section {
                Button("Se déconnecter", role: .destructive) { session.logout() }
            }
            Section {
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                Text("Lumio Swift est une version de test, écrite en SwiftUI pour iPhone et Mac. L'appli Lumio habituelle reste installée à côté.")
                    .font(.footnote)
                    .foregroundStyle(Theme.dim)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.black)
        .navigationTitle("Profil")
        .onDisappear { session.save() }
    }
}
