import SwiftUI

struct ProfileView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state

    private var inviteURL: URL? {
        var c = URLComponents(string: "\(JellyfinAPI.normalize(session.lumioURL))/invite")
        // Jamais les clés Radarr / Sonarr : seulement les adresses des serveurs et la clé TMDB
        var q = [URLQueryItem(name: "jf", value: session.serverURL), URLQueryItem(name: "chat", value: session.lumioURL)]
        if session.hasTmdb { q.append(URLQueryItem(name: "tmdb", value: session.tmdbKey)) }
        q.append(URLQueryItem(name: "name", value: session.userName))
        c?.queryItems = q
        return c?.url
    }

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
                    .onSubmit { session.saveCloud() }
                LabeledContent("État", value: state.serverOK == true ? "En ligne" : state.serverOK == false ? "Injoignable" : "…")
            } header: { Text("Serveur Lumio") } footer: { Text("Demandes, chat, notes de la famille et signalements.") }
            Section {
                SecureField("Clé API TMDB", text: $s.tmdbKey).onSubmit { session.saveCloud() }
            } header: { Text("TMDB") } footer: { Text("Pour la recherche de titres à demander, les tendances et le calendrier. Partagée avec l'appli Lumio habituelle.") }
            Section("Lecture") {
                Picker("Qualité par défaut", selection: $s.quality) {
                    ForEach(Quality.all) { Text($0.label).tag($0.id) }
                }
                .onChange(of: session.quality) { _, _ in session.saveCloud() }
            }
            Section("Famille") {
                NavigationLink(value: Route.ideas(problems: false)) { Label("Idées & signalements", systemImage: "lightbulb") }
                    .badge(session.isAdmin ? state.problemCount : 0)
                if let inviteURL, session.isAdmin {
                    ShareLink(item: inviteURL, subject: Text("Lumio"),
                              message: Text("Lumio, l'appli de films et séries de la maison 🎬 Ouvre ce lien : il explique comment installer l'appli puis la configure. Connecte-toi ensuite avec ton compte Jellyfin.")) {
                        Label("Inviter quelqu'un", systemImage: "square.and.arrow.up")
                    }
                }
            }
            if session.isAdmin {
                Section("Administration") {
                    NavigationLink(value: Route.sessions) { Label("En cours de lecture", systemImage: "play.tv") }
                    NavigationLink(value: Route.users) { Label("Utilisateurs et quotas", systemImage: "person.2") }
                }
            }
            Section {
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                Text("Lumio Swift est une version de test, écrite en SwiftUI pour iPhone et Mac. L'appli Lumio habituelle reste installée à côté, et les deux partagent les mêmes réglages.")
                    .font(.footnote).foregroundStyle(Theme.dim)
            }
            Section {
                Button("Se déconnecter", role: .destructive) { session.logout() }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Color.black)
        .navigationTitle("Profil")
        .onDisappear { session.saveCloud() }
    }
}

/// Idées & signalements de la famille (l'admin change leur statut).
struct IdeasView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state
    var problemsOnly: Bool
    @State private var ideas: [Idea] = []
    @State private var filter = "open"
    @State private var kind = "feature"
    @State private var title = ""
    @State private var details = ""
    @State private var error: String?

    private static let open: Set<String> = ["new", "planned", "sent"]
    private var shown: [Idea] {
        ideas.filter {
            switch filter {
            case "problems": return $0.kind == "bug" && IdeasView.open.contains($0.status)
            case "open": return IdeasView.open.contains($0.status)
            case "done": return !IdeasView.open.contains($0.status)
            default: return true
            }
        }
        .sorted { $0.votes == $1.votes ? $0.createdAt > $1.createdAt : $0.votes > $1.votes }
    }

    var body: some View {
        List {
            Section("Proposer") {
                Picker("Type", selection: $kind) {
                    Text("💡 Idée").tag("feature")
                    Text("🐞 Bug").tag("bug")
                }
                .pickerStyle(.segmented)
                TextField(kind == "bug" ? "Ce qui ne marche pas" : "Ton idée en une phrase", text: $title)
                TextField(kind == "bug" ? "Où, quand, ce qui se passe…" : "Détails (facultatif)", text: $details, axis: .vertical).lineLimit(2...6)
                Button("Envoyer") { submit() }.disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            Section {
                Picker("Filtre", selection: $filter) {
                    Text("En cours").tag("open")
                    Text("⚠️ Problèmes").tag("problems")
                    Text("Terminées").tag("done")
                    Text("Toutes").tag("all")
                }
                .pickerStyle(.segmented)
                if let error { Text(error).foregroundStyle(.orange) }
                ForEach(shown) { i in ideaRow(i) }
            }
        }
        .navigationTitle("Idées & signalements")
        .task {
            if problemsOnly { filter = "problems" }
            await load()
        }
        .refreshable { await load() }
        .onDisappear { Task { await state.refresh(session) } }
    }

    private func ideaRow(_ i: Idea) -> some View {
        let st = i.statusInfo
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                if let m = i.media {
                    AsyncImage(url: m.poster.flatMap(URL.init(string:))) { p in
                        if case .success(let im) = p { im.resizable().scaledToFill() } else { Theme.surfaceHigh }
                    }
                    .frame(width: 40, height: 60).clipShape(RoundedRectangle(cornerRadius: 6))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(i.kind == "bug" ? "🐞" : "💡") \(i.title)").font(.headline)
                    if !i.details.isEmpty { Text(i.details).font(.subheadline).foregroundStyle(Theme.dim) }
                    Text("\(i.createdBy.name) · \(timeAgo(i.createdAt))").font(.caption).foregroundStyle(Theme.dim)
                }
                Spacer()
                Button { Task { try? await session.lumio.vote(i.id); await load() } } label: {
                    VStack(spacing: 0) {
                        Image(systemName: i.voted ? "hand.thumbsup.fill" : "hand.thumbsup")
                        Text("\(i.votes)").font(.caption)
                    }
                }
                .buttonStyle(.borderless)
            }
            HStack {
                Text(st.0).font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color(hex: st.1).opacity(0.2), in: Capsule()).foregroundStyle(Color(hex: st.1))
                if let n = i.note { Text(n).font(.caption).foregroundStyle(Theme.dim) }
                Spacer()
                if session.isAdmin {
                    Menu("Statut") {
                        ForEach(Idea.statuses, id: \.0) { s in
                            Button(s.1) { Task { try? await session.lumio.setIdeaStatus(i.id, s.0); await load() } }
                        }
                        Divider()
                        Button("Supprimer", role: .destructive) { Task { try? await session.lumio.deleteIdea(i.id); await load() } }
                    }
                    .font(.caption)
                }
            }
        }
    }

    private func load() async {
        do { ideas = try await session.lumio.ideas(); error = nil } catch { self.error = error.localizedDescription }
    }

    private func submit() {
        Task {
            do {
                try await session.lumio.createIdea(kind: kind, title: title.trimmingCharacters(in: .whitespaces), details: details)
                title = ""; details = ""
                Toast.shared.show(session.isAdmin ? "Idée ajoutée" : "Merci ! Idée envoyée à l'admin")
                await load()
            } catch { Toast.shared.show(error.localizedDescription, error: true) }
        }
    }
}

/// Admin : qui regarde quoi, sur quel appareil, et si le serveur convertit la vidéo.
struct SessionsView: View {
    @Environment(AppSession.self) private var session
    @State private var sessions: [JfSession] = []

    var body: some View {
        List {
            let playing = sessions.filter { $0.NowPlayingItem != nil }
            if playing.isEmpty { Text("Personne ne regarde en ce moment").foregroundStyle(Theme.dim) }
            ForEach(playing) { s in
                if let it = s.NowPlayingItem {
                    HStack(spacing: 12) {
                        AsyncImage(url: session.jellyfin.posterURL(it, height: 180)) { p in
                            if case .success(let i) = p { i.resizable().scaledToFill() } else { Theme.surfaceHigh }
                        }
                        .frame(width: 50, height: 75).clipShape(RoundedRectangle(cornerRadius: 6))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(it.isEpisode ? "\(it.SeriesName ?? "") · \(it.episodeLabel)" : it.name).font(.headline)
                            Text("\(s.UserName ?? "?") · \(s.DeviceName ?? "") (\(s.Client ?? ""))").font(.caption).foregroundStyle(Theme.dim)
                            if let t = it.RunTimeTicks, t > 0, let pos = s.PlayState?.PositionTicks {
                                ProgressBar(value: Double(pos) / Double(t)).frame(maxWidth: 200)
                            }
                            let method = s.PlayState?.PlayMethod ?? ""
                            Text(s.PlayState?.IsPaused == true ? "⏸ En pause" : method == "Transcode" ? "🔄 Conversion par le serveur" : method == "DirectStream" ? "Flux direct" : "▶︎ Lecture directe")
                                .font(.caption).foregroundStyle(method == "Transcode" ? .orange : .green)
                        }
                    }
                }
            }
        }
        .navigationTitle("En cours de lecture")
        .task {
            while !Task.isCancelled {
                sessions = (try? await session.jellyfin.sessions()) ?? sessions
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }
}

/// Admin : droits et quotas de chaque utilisateur.
struct UsersView: View {
    @Environment(AppSession.self) private var session
    @State private var users: [AdminUser] = []
    @State private var error: String?

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.orange) }
            ForEach(users) { u in
                Section {
                    Toggle("Validation automatique", isOn: Binding(
                        get: { u.permissions.autoApprove || u.admin },
                        set: { v in update(u, ["autoApprove": v]) }
                    ))
                    .disabled(u.admin)
                    Stepper("Films : \(u.permissions.movieQuotaLimit == 0 ? "illimité" : "\(u.permissions.movieQuotaLimit) / \(u.permissions.movieQuotaDays) j")",
                            value: Binding(get: { u.permissions.movieQuotaLimit }, set: { update(u, ["movieQuotaLimit": $0]) }), in: 0...100)
                    Stepper("Saisons : \(u.permissions.tvQuotaLimit == 0 ? "illimité" : "\(u.permissions.tvQuotaLimit) / \(u.permissions.tvQuotaDays) j")",
                            value: Binding(get: { u.permissions.tvQuotaLimit }, set: { update(u, ["tvQuotaLimit": $0]) }), in: 0...100)
                } header: {
                    Text("\(u.name)\(u.admin ? " · admin" : "") · \(u.requestCount) demande\(u.requestCount > 1 ? "s" : "")")
                }
            }
        }
        .navigationTitle("Utilisateurs")
        .task { await load() }
    }

    private func load() async {
        do { users = try await session.lumio.users(); error = nil } catch { self.error = error.localizedDescription }
    }

    private func update(_ u: AdminUser, _ patch: [String: Any]) {
        Task {
            do { try await session.lumio.updateUser(u.id, patch); await load() } catch { Toast.shared.show(error.localizedDescription, error: true) }
        }
    }
}
