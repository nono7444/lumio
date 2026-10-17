import SwiftUI

/// Live TV : chaînes des listes IPTV / addons Stremio, triées par langue, thème et groupe, avec favoris.
struct LiveView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var sourceId: String?
    @State private var channels: [Channel] = []
    @State private var loading = false
    @State private var error: String?
    @State private var query = ""
    @State private var theme = "all"
    @State private var group: String?
    @State private var playing: PlayerSource?
    @State private var opening: String?
    @State private var vpnOn = false
    @State private var vpnSetup = false
    @State private var autoDone = false

    private var source: LiveSource? { session.liveSources.first { $0.id == sourceId } ?? session.liveSources.first }
    private var favs: Set<String> { Set(session.liveFavorites) }

    private var langFiltered: [Channel] {
        let lang = session.liveLang
        if lang == "all" { return channels }
        let tagged = channels.filter { Live.country($0) != nil }
        // Liste sans indication de pays : tout est gardé
        if tagged.isEmpty { return channels }
        return channels.filter { ch in
            guard let c = Live.country(ch) else { return false }
            return lang == "fr" ? Live.french.contains(c) : c == lang
        }
    }
    private var langs: [String] {
        var counts: [String: Int] = [:]
        for ch in channels { if let c = Live.country(ch) { counts[c, default: 0] += 1 } }
        return counts.sorted { $0.value > $1.value }.map(\.key)
    }
    private var themed: [Channel] {
        switch theme {
        case "all": return langFiltered
        case "fav": return langFiltered.filter { favs.contains($0.key) }
        default: return langFiltered.filter { Live.theme($0) == theme }
        }
    }
    private var groups: [String] {
        var seen: [String] = []
        for ch in themed { if let g = ch.group, !seen.contains(g) { seen.append(g) } }
        return seen
    }
    private var visible: [Channel] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return themed.filter { ch in
            (group == nil || ch.group == group) && (q.isEmpty || ch.name.lowercased().contains(q))
        }
    }

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if session.liveSources.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "tv").font(.system(size: 44)).foregroundStyle(Theme.dim)
                        Text("Ajoute ta liste IPTV (lien M3U ou compte Xtream Codes) ou un addon Stremio de chaînes.")
                            .multilineTextAlignment(.center).foregroundStyle(Theme.dim)
                        NavigationLink(value: Route.liveSources) { Text("Ajouter une source").bold() }.buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity).padding(40)
                } else {
                    filters
                    if loading { ProgressView("Chargement des chaînes…").frame(maxWidth: .infinity).padding(30) }
                    if let error { ErrorBox(message: error) { Task { await load(force: true) } } }
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(visible.prefix(600)) { ch in
                            Button { play(ch) } label: { ChannelTile(ch: ch, fav: favs.contains(ch.key), busy: opening == ch.key) }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    Button(favs.contains(ch.key) ? "Retirer des favoris" : "Ajouter aux favoris",
                                           systemImage: favs.contains(ch.key) ? "star.slash" : "star") { toggleFav(ch) }
                                }
                        }
                    }
                    .padding(.horizontal)
                    if !loading && visible.isEmpty && error == nil {
                        Text(theme == "fav" ? "Pas encore de favori : appui long sur une chaîne." : "Aucune chaîne").foregroundStyle(Theme.dim).frame(maxWidth: .infinity).padding(30)
                    }
                }
            }
            .padding(.vertical)
        }
        .background(Color.black)
        .navigationTitle("Live TV")
        .searchable(text: $query, prompt: "Chercher une chaîne")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { vpn() } label: {
                    Label(vpnOn ? "VPN actif" : "VPN", systemImage: vpnOn ? "lock.shield.fill" : "lock.shield")
                        .foregroundStyle(vpnOn ? Color.green : Color.primary)
                }
                .contextMenu { Button("Réglages du VPN") { vpnSetup = true } }
                NavigationLink(value: Route.liveSources) { Label("Sources", systemImage: "plus") }
            }
        }
        .appDestinations()
        .playerCover(source: $playing)
        .sheet(isPresented: $vpnSetup) { VpnSetupView() }
        .task(id: source?.id) { await load() }
        .onAppear {
            // Démarrage automatique du VPN à la première ouverture de la Live TV
            if !autoDone, session.liveVpn.enabled, session.liveVpn.auto, !vpnOn {
                autoDone = true
                runShortcut(on: true)
            }
        }
        .refreshable { await load(force: true) }
    }

    @ViewBuilder
    private var filters: some View {
        if session.liveSources.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(session.liveSources) { s in Chip(label: s.name, on: s.id == source?.id) { sourceId = s.id } }
                }
                .padding(.horizontal)
            }
        }
        if langs.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Chip(label: "🇫🇷 Français", on: session.liveLang == "fr") { setLang("fr") }
                    ForEach(langs.filter { !Live.french.contains($0) }.prefix(12), id: \.self) { c in
                        let info = Live.countries.first { $0.0 == c }
                        Chip(label: "\(info?.2 ?? "") \(info?.1 ?? c)", on: session.liveLang == c) { setLang(c) }
                    }
                    Chip(label: "🌐 Toutes", on: session.liveLang == "all") { setLang("all") }
                }
                .padding(.horizontal)
            }
        }
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Chip(label: "Tout", on: theme == "all") { theme = "all"; group = nil }
                Chip(label: "Favoris", icon: "star.fill", on: theme == "fav") { theme = "fav"; group = nil }
                ForEach(Live.themes, id: \.0) { t in
                    Chip(label: t.1, icon: t.2, on: theme == t.0) { theme = t.0; group = nil }
                }
            }
            .padding(.horizontal)
        }
        if groups.count > 1 && groups.count < 200 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Chip(label: "Tous les groupes", on: group == nil) { group = nil }
                    ForEach(groups, id: \.self) { g in Chip(label: g, on: group == g) { group = g } }
                }
                .padding(.horizontal)
            }
        }
    }

    private func setLang(_ l: String) {
        group = nil
        session.liveLang = l
        session.saveCloud()
    }

    private func load(force: Bool = false) async {
        guard let source else { return }
        loading = true
        error = nil
        do {
            channels = try await Live.channels(source, force: force)
        } catch {
            channels = []
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func toggleFav(_ ch: Channel) {
        if favs.contains(ch.key) { session.liveFavorites.removeAll { $0 == ch.key } } else { session.liveFavorites.append(ch.key) }
        session.saveCloud()
    }

    private func play(_ ch: Channel) {
        opening = ch.key
        Task {
            do {
                let s = try await Live.streams(ch)
                playing = .live(title: ch.name, streams: s)
            } catch {
                Toast.shared.show(error.localizedDescription, error: true)
            }
            opening = nil
        }
    }

    // ——— VPN : iOS ne laisse pas une appli piloter Proton VPN, on passe par deux raccourcis ———

    private func vpn() {
        guard session.liveVpn.enabled else { vpnSetup = true; return }
        runShortcut(on: !vpnOn)
    }

    private func runShortcut(on: Bool) {
        let name = on ? session.liveVpn.onShortcut : session.liveVpn.offShortcut
        let back = "lumioswift://live"
        let enc = { (s: String) in s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s }
        guard let url = URL(string: "shortcuts://x-callback-url/run-shortcut?name=\(enc(name))&x-success=\(enc(back))&x-cancel=\(enc(back))&x-error=\(enc(back))") else { return }
        openURL(url)
        vpnOn = on
    }
}

private struct ChannelTile: View {
    let ch: Channel
    let fav: Bool
    let busy: Bool

    var body: some View {
        VStack(spacing: 6) {
            ZStack(alignment: .topTrailing) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(Theme.surfaceHigh)
                    if let l = ch.logo, let url = URL(string: l) {
                        AsyncImage(url: url) { p in
                            if case .success(let i) = p { i.resizable().scaledToFit().padding(10) } else { initials }
                        }
                    } else { initials }
                    if busy { ProgressView() }
                }
                .frame(height: 66)
                if fav { Image(systemName: "star.fill").font(.caption2).foregroundStyle(Theme.gold).padding(5) }
            }
            Text(ch.name).font(.caption.weight(.semibold)).lineLimit(1)
        }
    }

    private var initials: some View {
        Text(String(ch.name.prefix(12))).font(.caption.bold()).foregroundStyle(Theme.dim).multilineTextAlignment(.center).padding(4)
    }
}

/// Sources Live TV : liste M3U, compte Xtream Codes, addon Stremio.
struct LiveSourcesView: View {
    @Environment(AppSession.self) private var session
    @State private var kind = "xtream"
    @State private var name = ""
    @State private var url = ""
    @State private var server = ""
    @State private var user = ""
    @State private var pass = ""
    @State private var busy = false

    var body: some View {
        Form {
            Section("Tes sources") {
                if session.liveSources.isEmpty { Text("Aucune source").foregroundStyle(Theme.dim) }
                ForEach(session.liveSources) { s in
                    VStack(alignment: .leading) {
                        Text(s.name).font(.headline)
                        Text(s.kind == "stremio" ? "Addon Stremio" : "Liste IPTV").font(.caption).foregroundStyle(Theme.dim)
                    }
                }
                .onDelete { idx in
                    session.liveSources.remove(atOffsets: idx)
                    session.saveCloud()
                }
            }
            Section("Ajouter") {
                Picker("Type", selection: $kind) {
                    Text("Xtream Codes").tag("xtream")
                    Text("Lien M3U").tag("m3u")
                    Text("Addon Stremio").tag("stremio")
                }
                .pickerStyle(.segmented)
                TextField("Nom (facultatif)", text: $name)
                if kind == "xtream" {
                    TextField("Serveur (http://…:port)", text: $server).autocorrectionDisabled()
                    TextField("Identifiant", text: $user).autocorrectionDisabled()
                    SecureField("Mot de passe", text: $pass)
                } else {
                    TextField(kind == "m3u" ? "Lien de la liste .m3u" : "Lien de l'addon (manifest.json)", text: $url).autocorrectionDisabled()
                }
                Button {
                    add()
                } label: {
                    HStack { if busy { ProgressView() }; Text("Ajouter la source") }
                }
                .disabled(busy || (kind == "xtream" ? server.isEmpty || user.isEmpty || pass.isEmpty : url.isEmpty))
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Sources Live TV")
    }

    private func add() {
        busy = true
        let link = kind == "xtream" ? Live.xtreamM3u(server: server, user: user, pass: pass) : url.trimmingCharacters(in: .whitespaces)
        var src = LiveSource(id: Live.newSourceId(), name: name.isEmpty ? (kind == "stremio" ? "Addon" : "IPTV") : name,
                             kind: kind == "stremio" ? "stremio" : "m3u", url: link)
        Task {
            do {
                if src.kind == "stremio", name.isEmpty { src.name = (try? await Live.resolveAddon(link).1.name) ?? "Addon" }
                let ch = try await Live.channels(src, force: true)
                session.liveSources.append(src)
                session.saveCloud()
                Toast.shared.show("\(src.name) ajoutée : \(ch.count) chaînes")
                name = ""; url = ""; server = ""; user = ""; pass = ""
            } catch {
                Toast.shared.show(error.localizedDescription, error: true)
            }
            busy = false
        }
    }
}

/// Réglages du VPN de la Live TV (raccourcis « Lumio VPN On / Off »).
struct VpnSetupView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        @Bindable var s = session
        NavigationStack {
            Form {
                Section {
                    Text("iOS ne permet pas à Lumio d'allumer directement Proton VPN : on passe par deux raccourcis de l'app Raccourcis (une seule fois à faire).")
                        .font(.subheadline)
                    Text("1. Raccourcis → « + » → action « Proton VPN › Connexion rapide » (ou « Définir le VPN » → Connecter), nommé « \(session.liveVpn.onShortcut) ».")
                    Text("2. Un 2ᵉ raccourci avec « Proton VPN › Déconnecter », nommé « \(session.liveVpn.offShortcut) ».")
                    Button("Ouvrir Raccourcis") { if let u = URL(string: "shortcuts://") { openURL(u) } }
                }
                .font(.footnote)
                Section("Noms des raccourcis") {
                    TextField("Démarrer", text: $s.liveVpn.onShortcut)
                    TextField("Éteindre", text: $s.liveVpn.offShortcut)
                }
                Section {
                    Toggle("Bouton VPN actif", isOn: $s.liveVpn.enabled)
                    Toggle("Démarrer automatiquement avec la Live TV", isOn: $s.liveVpn.auto).disabled(!session.liveVpn.enabled)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("VPN")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { session.saveCloud(); dismiss() } } }
        }
    }
}
