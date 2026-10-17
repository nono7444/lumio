import SwiftUI

/// Ce qu'on demande (fiche TMDB).
struct RequestTarget {
    let type: String
    let tmdbId: Int
    var tvdbId: Int?
    let title: String
    var year: String?
    var poster: String?
    var backdrop: String?
    var seasons: [TmdbSeason]
    var flavor: String?
}

/// Bouton Demander → barre de téléchargement en direct → « Lire » quand le titre arrive dans Jellyfin.
struct RequestSection: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state
    let target: RequestTarget
    let inJellyfin: Bool
    var onAvailable: () -> Void

    @State private var media: MediaInfo?
    @State private var error: String?
    @State private var asking = false

    private var active: LumioRequest? { media?.requests.first { $0.status == 2 } }
    private var pending: [LumioRequest] { (media?.requests ?? []).filter { $0.status == 1 || $0.status == 4 } }
    private var isTv: Bool { target.type == "tv" }
    private var status: Int { inJellyfin && !isTv ? 5 : (media?.status ?? 1) }
    private var canRequest: Bool {
        guard let media, !(inJellyfin && !isTv) else { return false }
        return isTv ? media.seasons.contains { $0.status == 1 } : media.status == 1
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let error {
                Label("Serveur Lumio : \(error)", systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.red)
            }
            if let a = active {
                progressButton(a)
            } else if canRequest {
                Button { asking = true } label: {
                    Label(isTv && status != 1 ? "Demander d'autres saisons" : "Demander", systemImage: "arrow.down.circle.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            } else if media != nil, !inJellyfin, status == 5 || status == 4 {
                Label(isTv ? "Disponible (ou en partie) : arrive dans Jellyfin…" : "Prêt : arrive dans Jellyfin…", systemImage: "checkmark.circle")
                    .foregroundStyle(.green).font(.subheadline)
            }
            ForEach(pending) { r in pendingRow(r) }
        }
        .task(id: target.tmdbId) {
            await load()
            // Suivi en direct pendant le téléchargement
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(active != nil ? 5 : 20))
                let had = active != nil
                await load()
                if had && active == nil { onAvailable() }
                if !inJellyfin && status == 5 { onAvailable() }
            }
        }
        .sheet(isPresented: $asking) {
            RequestSheet(target: target, media: media) { msg in
                Toast.shared.show(msg)
                Task { await load(); await state.refresh(session) }
            }
            .presentationDetents([.large])
        }
    }

    private func load() async {
        let seasons = target.seasons.filter { $0.season_number > 0 }.map(\.season_number)
        do {
            media = try await session.lumio.media(type: target.type, tmdbId: target.tmdbId, tvdbId: target.tvdbId, seasons: seasons)
            error = nil
        } catch {
            if media == nil { self.error = error.localizedDescription }
        }
    }

    @ViewBuilder
    private func progressButton(_ r: LumioRequest) -> some View {
        let d = r.download
        let pct = (d?.progress ?? 0) / 100
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 14).fill(Theme.surfaceHigh)
                GeometryReader { g in
                    RoundedRectangle(cornerRadius: 14).fill(Theme.accent.opacity(0.55))
                        .frame(width: g.size.width * (d?.state == "downloading" ? pct : d?.state == "importing" ? 1 : 0.04))
                }
                HStack {
                    Image(systemName: d?.state == "warning" ? "exclamationmark.triangle.fill" : "arrow.down.circle")
                    Text(downloadText(d)).font(.headline)
                    Spacer()
                    if d?.state == "downloading" { Text("\(Int(pct * 100)) %").font(.headline.monospacedDigit()) }
                }
                .padding(.horizontal, 16)
            }
            .frame(height: 52)
            if d?.state == "warning", let m = d?.message { Text(m).font(.caption).foregroundStyle(.orange) }
        }
    }

    private func downloadText(_ d: LumioRequest.Download?) -> String {
        switch d?.state {
        case "downloading": return "Téléchargement"
        case "importing": return "Import dans Jellyfin…"
        case "warning": return "À vérifier"
        default: return "Recherche d'une source…"
        }
    }

    @ViewBuilder
    private func pendingRow(_ r: LumioRequest) -> some View {
        let st = r.statusLabel
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(st.0).font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color(hex: st.1).opacity(0.2), in: Capsule()).foregroundStyle(Color(hex: st.1))
                Text("par \(r.requestedBy.name) · \(timeAgo(r.createdAt))").font(.caption).foregroundStyle(Theme.dim)
                if let s = r.seasons, !s.isEmpty { Text("S\(s.map { String($0) }.joined(separator: ", "))").font(.caption).foregroundStyle(Theme.dim) }
            }
            if let e = r.error { Text(e).font(.caption).foregroundStyle(.red) }
            HStack {
                if session.isAdmin {
                    Button(r.status == 4 ? "Réessayer" : "Approuver") { act(r, r.status == 4 ? "retry" : "approve") }.buttonStyle(.borderedProminent)
                    if r.status == 1 { Button("Refuser", role: .destructive) { act(r, "decline") }.buttonStyle(.bordered) }
                } else if r.requestedBy.id == session.userId && r.status == 1 {
                    Button("Annuler la demande", role: .destructive) { act(r, "cancel") }.buttonStyle(.bordered)
                }
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private func act(_ r: LumioRequest, _ kind: String) {
        Task {
            do {
                let api = session.lumio
                switch kind {
                case "approve": try await api.approve(r.id)
                case "retry": try await api.retry(r.id)
                case "decline": try await api.decline(r.id, reason: nil)
                default: try await api.remove(r.id)
                }
                Toast.shared.show(kind == "approve" || kind == "retry" ? "Demande approuvée : téléchargement lancé." : kind == "decline" ? "Demande refusée." : "Demande annulée.")
                await load()
            } catch {
                Toast.shared.show(error.localizedDescription, error: true)
            }
        }
    }
}

/// Fenêtre « Demander » : saisons, dossier, quota, profil imposé.
struct RequestSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let target: RequestTarget
    let media: MediaInfo?
    var done: (String) -> Void

    @State private var me: LumioMe?
    @State private var opts: ArrOptions?
    @State private var selected = Set<Int>()
    @State private var folder: String?
    @State private var busy = false

    private var isTv: Bool { target.type == "tv" }
    private var seasons: [TmdbSeason] { target.seasons.filter { $0.season_number > 0 } }
    private func status(_ n: Int) -> Int { media?.seasons.first { $0.seasonNumber == n }?.status ?? 1 }
    private var requestable: [Int] { seasons.map(\.season_number).filter { status($0) == 1 } }
    private var quota: LumioMe.Quota? { isTv ? me?.quota?.tv : me?.quota?.movie }
    private var overQuota: Bool {
        guard let q = quota, let rem = q.remaining else { return false }
        return isTv ? selected.count > rem : rem < 1
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        AsyncImage(url: target.poster.flatMap(URL.init(string:))) { p in
                            if case .success(let i) = p { i.resizable().scaledToFill() } else { Theme.surfaceHigh }
                        }
                        .frame(width: 60, height: 90).clipShape(RoundedRectangle(cornerRadius: 8))
                        VStack(alignment: .leading) {
                            Text(isTv ? "Demander la série" : "Demander le film").font(.caption).foregroundStyle(Theme.dim)
                            Text(target.title).font(.headline)
                            if let y = target.year { Text(y).font(.caption).foregroundStyle(Theme.dim) }
                        }
                    }
                }
                if isTv {
                    Section("Saisons") {
                        Toggle("Toutes les saisons", isOn: Binding(
                            get: { !requestable.isEmpty && requestable.allSatisfy(selected.contains) },
                            set: { selected = $0 ? Set(requestable) : [] }
                        ))
                        ForEach(seasons) { s in
                            let st = status(s.season_number)
                            Toggle(isOn: Binding(
                                get: { selected.contains(s.season_number) },
                                set: { on in if on { selected.insert(s.season_number) } else { selected.remove(s.season_number) } }
                            )) {
                                VStack(alignment: .leading) {
                                    Text(s.name ?? "Saison \(s.season_number)")
                                    Text(st == 1 ? "\(s.episode_count ?? 0) épisodes" : st == 5 ? "Disponible" : st == 4 ? "En partie disponible" : "Déjà demandée")
                                        .font(.caption).foregroundStyle(Theme.dim)
                                }
                            }
                            .disabled(st != 1)
                        }
                    }
                }
                if let opts, !opts.folders.isEmpty {
                    Section("Dossier") {
                        Picker("Dossier", selection: Binding(get: { folder ?? "" }, set: { folder = $0 })) {
                            ForEach(opts.folders) { f in
                                Text(f.name + (f.freeSpace.map { " · \(formatBytes($0)) libres" } ?? "")).tag(f.path)
                            }
                        }
                        if let lp = opts.lockedProfile { LabeledContent("Qualité", value: lp.name) }
                    }
                }
                if let q = quota, q.limit > 0 {
                    Section {
                        Text("Quota : \(q.used)/\(q.limit) sur \(q.days) jours").foregroundStyle(overQuota ? .red : Theme.dim)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Demander")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Envoyer") { submit() }.disabled(busy || overQuota || (isTv && selected.isEmpty))
                }
            }
            .task {
                selected = Set(isTv ? requestable : [])
                me = try? await session.lumio.me()
                if let o = try? await session.lumio.options(type: target.type) {
                    opts = o
                    folder = suggestFolder(o.folders, flavor: target.flavor, fallback: o.default)
                }
            }
        }
    }

    private func submit() {
        busy = true
        var body: [String: Any] = ["type": target.type, "tmdbId": target.tmdbId, "title": target.title]
        if let v = target.tvdbId { body["tvdbId"] = v }
        if isTv { body["seasons"] = selected.sorted() }
        if let v = target.year { body["year"] = v }
        if let v = target.poster { body["poster"] = v }
        if let v = target.backdrop { body["backdrop"] = v }
        if let folder { body["rootFolderPath"] = folder }
        Task {
            do {
                let r = try await session.lumio.create(body)
                let what = isTv ? ((r.seasons?.count ?? 0) > 1 ? "\(r.seasons!.count) saisons" : "la saison \(r.seasons?.first ?? 1)") : "le film"
                done(r.status == 1 ? "Demande envoyée pour \(what). Elle attend la validation de l'admin."
                     : r.status == 4 ? "Demande enregistrée, mais l'envoi a échoué : \(r.error ?? "erreur")"
                     : "Demande approuvée : \(what) part en téléchargement.")
                dismiss()
            } catch {
                Toast.shared.show(error.localizedDescription, error: true)
            }
            busy = false
        }
    }
}

func suggestFolder(_ folders: [ServerFolder], flavor: String?, fallback: String?) -> String? {
    let anime = "anim[eé]", kids = "kid|enfant|jeunesse|famil|dessin"
    func match(_ f: ServerFolder, _ re: String) -> Bool { f.name.range(of: re, options: [.regularExpression, .caseInsensitive]) != nil }
    if flavor == "anime", let f = folders.first(where: { match($0, anime) }) { return f.path }
    if flavor == "kids", let f = folders.first(where: { match($0, kids) }) { return f.path }
    if let fallback, folders.contains(where: { $0.path == fallback }) { return fallback }
    return folders.first { !match($0, anime) && !match($0, kids) }?.path ?? folders.first?.path
}

func formatBytes(_ b: Double) -> String {
    ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .file)
}
