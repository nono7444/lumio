// Plateformes, Demandes, À voir, Agenda, Chat, Profil (rang, stats, serveur).
import SwiftUI

// ——— Plateforme : sorties mélangées (dispo ou à demander) par date ———
struct PlatformView: View {
    @EnvironmentObject var session: Session
    let ref: PlatformRef
    @State private var page: PlatformPage?
    @State private var sort = "desc"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    if let p = page { PlatformTile(platform: PlatformInfo(id: p.id, name: p.name, logo: p.logo)).scaleEffect(0.8) }
                    PageTitle(text: ref.name)
                    Spacer()
                    Chip(label: "Plus récents", on: sort == "desc") { sort = "desc" }
                    Chip(label: "Plus anciens", on: sort == "asc") { sort = "asc" }
                }
                if let p = page {
                    let items = p.items ?? (p.latest + p.library)
                    let missing = items.filter { !$0.available }.count
                    Text("\(items.count - missing) sur ton serveur · \(missing) à demander").foregroundStyle(Theme.dim)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 170), spacing: 18, alignment: .top)], spacing: 22) {
                        ForEach(items) { t in
                            TmdbPosterCard(ref: MediaRef(type: t.type, tmdbId: t.tmdbId), title: t.title, year: t.year,
                                           poster: t.poster.flatMap(URL.init(string:)), badge: t.available ? "Disponible" : "À demander")
                        }
                    }
                } else {
                    LoadingView().frame(height: 300)
                }
            }
            .padding(28)
        }
        .task(id: sort) { page = try? await session.lumio?.platform(ref.id, sort: sort) }
    }
}

// ——— Demandes ———
struct RequestsView: View {
    @EnvironmentObject var session: Session
    @State private var filter = "all"
    @State private var mine = false
    @State private var list: [LumioRequest] = []
    @State private var loading = true
    @State private var error: String?

    private let filters: [(String, String)] = [("all", "Toutes"), ("pending", "En attente"), ("processing", "En cours"), ("available", "Disponibles"), ("failed", "Échecs")]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    PageTitle(text: "Demandes")
                    Spacer()
                    Toggle("Seulement les miennes", isOn: $mine).toggleStyle(.switch)
                }
                HStack(spacing: 8) { ForEach(filters, id: \.0) { f in Chip(label: f.1, on: filter == f.0) { filter = f.0 } } }
                if let error { Text(error).foregroundStyle(.red) }
                if loading && list.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                if !loading && list.isEmpty { MessageView(icon: "tray", text: "Aucune demande ici.").frame(height: 240) }
                VStack(spacing: 10) {
                    ForEach(list) { r in RequestRow(req: r, admin: session.me?.admin == true) { await load() } }
                }
            }
            .padding(28)
        }
        .task(id: "\(filter)\(mine)") { await load() }
        .task {
            // Rafraîchi toutes les 15 s (progression des téléchargements)
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                await load()
            }
        }
    }

    private func load() async {
        guard let l = session.lumio else { return }
        do {
            list = try await l.requests(filter: filter, mine: mine).results
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

struct RequestRow: View {
    @EnvironmentObject var session: Session
    let req: LumioRequest
    let admin: Bool
    let reload: () async -> Void

    var body: some View {
        HStack(spacing: 14) {
            NavigationLink(value: MediaRef(type: req.type, tmdbId: req.tmdbId)) {
                RemoteImage(url: req.poster.flatMap(URL.init(string:)))
                    .frame(width: 64, height: 96)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 5) {
                Text("\(req.title)\(req.year.map { " (\($0))" } ?? "")").font(.system(size: 15, weight: .semibold))
                Text([req.type == "tv" ? "Série" : "Film",
                      req.seasons.flatMap { $0.isEmpty ? nil : "Saisons \($0.map(String.init).joined(separator: ", "))" },
                      "par \(req.requestedBy.name)"].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
                HStack(spacing: 8) {
                    Text(req.statusLabel)
                        .font(.system(size: 11, weight: .heavy))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(color.opacity(0.2), in: Capsule())
                        .foregroundStyle(color)
                    if req.download?.via == "secour" { Text("Lumio Secour").font(.system(size: 11)).foregroundStyle(Theme.dim) }
                }
                if let p = req.download?.progress, req.download?.state == "downloading" {
                    ProgressView(value: p).tint(Theme.accent).frame(maxWidth: 320)
                }
                if let e = req.error ?? req.reason, !e.isEmpty { Text(e).font(.system(size: 12)).foregroundStyle(.orange).lineLimit(2) }
            }
            Spacer()
            HStack(spacing: 8) {
                if admin && req.status == 1 {
                    Button("Refuser") { Task { try? await session.lumio?.act(req.id, "decline", body: ["reason": ""]); await reload() } }
                    Button("Approuver") { Task { try? await session.lumio?.act(req.id, "approve"); await reload() } }
                        .buttonStyle(.borderedProminent)
                }
                if admin && (req.status == 4 || req.download?.state == "warning") {
                    Button("Relancer") { Task { try? await session.lumio?.act(req.id, "retry"); await reload() } }
                }
                Menu {
                    if admin { Button("Chercher à nouveau") { Task { try? await session.lumio?.act(req.id, "search"); await reload() } } }
                    Button("Supprimer la demande", role: .destructive) { Task { try? await session.lumio?.deleteRequest(req.id); await reload() } }
                } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton)
                .frame(width: 30)
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var color: Color {
        if req.mediaStatus == MediaStatus.available { return .green }
        switch req.status {
        case 1: return .orange
        case 3, 4: return .red
        default: return Theme.accent
        }
    }
}

// ——— À voir ———
struct WatchlistView: View {
    @EnvironmentObject var session: Session
    @State private var items: [WatchItem] = []
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageTitle(text: "À voir")
                if loaded && items.isEmpty {
                    MessageView(icon: "bookmark", text: "Ta liste est vide. Ajoute des titres depuis leur fiche.").frame(height: 300)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 170), spacing: 18, alignment: .top)], spacing: 22) {
                    ForEach(items) { w in
                        TmdbPosterCard(ref: MediaRef(type: w.type, tmdbId: w.tmdbId), title: w.title, year: w.year,
                                       poster: w.poster.flatMap(URL.init(string:)),
                                       badge: MediaStatus.label(w.status) ?? w.digital.map { "Sortie \(shortDate($0))" })
                            .contextMenu {
                                Button("Retirer de À voir") {
                                    Task {
                                        try? await session.lumio?.removeWatch(type: w.type, tmdbId: w.tmdbId)
                                        items.removeAll { $0.id == w.id }
                                    }
                                }
                            }
                    }
                }
            }
            .padding(28)
        }
        .task {
            items = (try? await session.lumio?.watchlist()) ?? []
            loaded = true
        }
    }

    private func shortDate(_ s: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: String(s.prefix(10))) else { return s }
        let o = DateFormatter()
        o.locale = Locale(identifier: "fr_FR")
        o.dateFormat = "d MMM"
        return o.string(from: d)
    }
}

// ——— Agenda ———
struct CalendarView: View {
    @EnvironmentObject var session: Session
    @State private var entries: [CalendarEntry] = []
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageTitle(text: "Agenda")
                Text("Sorties numériques des films et nouvelles séries, de la semaine passée aux six prochaines.").foregroundStyle(Theme.dim)
                if loading { ProgressView().frame(maxWidth: .infinity) }
                ForEach(days, id: \.0) { day in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(label(day.1)).font(.system(size: 18, weight: .bold))
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .top, spacing: 16) {
                                ForEach(day.2) { e in
                                    TmdbPosterCard(ref: MediaRef(type: e.type, tmdbId: e.tmdbId), title: e.title, year: nil, poster: e.poster, badge: nil, width: 130)
                                }
                            }
                        }
                    }
                }
            }
            .padding(28)
        }
        .task {
            if session.tmdb == nil { await session.prepare() }
            entries = (try? await session.tmdb?.calendar()) ?? []
            loading = false
        }
    }

    private var days: [(String, Date, [CalendarEntry])] {
        let cal = Calendar.current
        let groups = Dictionary(grouping: entries) { cal.startOfDay(for: $0.date) }
        return groups.keys.sorted().map { ("\($0.timeIntervalSince1970)", $0, groups[$0]!) }
    }

    private func label(_ d: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Aujourd’hui" }
        if cal.isDateInTomorrow(d) { return "Demain" }
        if cal.isDateInYesterday(d) { return "Hier" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "fr_FR")
        f.dateFormat = "EEEE d MMMM"
        return f.string(from: d).capitalized
    }
}

// ——— Chat de la famille ———
struct ChatView: View {
    @EnvironmentObject var session: Session
    @State private var messages: [ChatMessage] = []
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack { PageTitle(text: "Chat"); Spacer() }.padding(.horizontal, 28).padding(.top, 28).padding(.bottom, 12)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(messages) { m in bubble(m).id(m.id) }
                    }
                    .padding(.horizontal, 28)
                }
                .onChange(of: messages.count) { _ in
                    if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            if let error { Text(error).foregroundStyle(.red).font(.caption).padding(.horizontal, 28) }
            HStack(spacing: 10) {
                TextField("Message à la famille", text: $text)
                    .textFieldStyle(.plain)
                    .padding(12)
                    .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 12))
                    .onSubmit(send)
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold))
                        .frame(width: 36, height: 36).background(Theme.accent, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(20)
        }
        .task {
            while !Task.isCancelled {
                if let m = try? await session.lumio?.messages() { messages = m }
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    private func bubble(_ m: ChatMessage) -> some View {
        let mine = m.userName == session.userName
        return HStack {
            if mine { Spacer(minLength: 80) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
                if !mine { Text(m.userName).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.dim) }
                Text(m.text)
                    .padding(.horizontal, 13).padding(.vertical, 8)
                    .background(m.kind == "grab" ? Theme.surface : (mine ? Theme.accent : Theme.surfaceHigh), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .foregroundStyle(m.kind == "grab" ? Theme.dim : .white)
                    .textSelection(.enabled)
                Text(time(m.createdAt)).font(.system(size: 10)).foregroundStyle(Theme.faint)
            }
            if !mine { Spacer(minLength: 80) }
        }
    }

    private func time(_ s: String) -> String {
        guard let d = parseISO(s) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "fr_FR")
        f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "d MMM HH:mm"
        return f.string(from: d)
    }

    private func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        text = ""
        Task {
            do {
                try await session.lumio?.send(t)
                if let m = try? await session.lumio?.messages() { messages = m }
                error = nil
            } catch { self.error = error.localizedDescription }
        }
    }
}

// ——— Profil : rang, stats, classement, serveurs, déconnexion ———
struct ProfileView: View {
    @EnvironmentObject var session: Session
    @State private var board: RewardsBoard?
    @State private var lumioField = ""
    @State private var serverOK: Bool?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                PageTitle(text: "Profil")
                if let b = board, let me = b.users.first(where: { $0.id == b.me }) { rankCard(me, b) }
                if let b = board {
                    section("Classement de la famille") {
                        ForEach(b.users) { u in
                            HStack(spacing: 12) {
                                Text("\(u.rank)").font(.system(size: 15, weight: .heavy)).frame(width: 24)
                                RankShield(tier: u.grade.tier ?? 0, size: 22)
                                Text(u.name).fontWeight(u.id == b.me ? .bold : .regular)
                                Spacer()
                                Text("\(u.points) pts").foregroundStyle(Theme.dim)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    section("Rangs et bonus de demandes") {
                        ForEach(b.grades, id: \.name) { g in
                            HStack(spacing: 12) {
                                RankShield(tier: g.tier ?? 0, size: 22)
                                Text(g.name)
                                Spacer()
                                Text("\(g.min) pts").foregroundStyle(Theme.dim)
                                if let bo = g.bonus { Text("+\(bo.movies) film · +\(bo.seasons) saison").font(.caption).foregroundStyle(Theme.dim).frame(width: 150, alignment: .trailing) }
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
                section("Serveurs") {
                    LabeledContent("Jellyfin", value: session.client?.base.absoluteString ?? "")
                    HStack {
                        TextField("Serveur Lumio", text: $lumioField).textFieldStyle(.roundedBorder)
                        Button("Enregistrer") { session.setLumioURL(lumioField); Task { await check() } }
                        if let ok = serverOK {
                            Image(systemName: ok ? "checkmark.circle.fill" : "xmark.octagon.fill").foregroundStyle(ok ? .green : .red)
                        }
                    }
                    if let q = session.me?.quota {
                        Text("Quotas : \(q.movie.remaining.map { "\($0) film(s)" } ?? "films illimités") · \(q.tv.remaining.map { "\($0) saison(s)" } ?? "saisons illimitées") restant(es)")
                            .font(.caption).foregroundStyle(Theme.dim)
                    }
                }
                Button(role: .destructive) { session.logout() } label: { Label("Se déconnecter", systemImage: "rectangle.portrait.and.arrow.right") }
            }
            .padding(28)
            .frame(maxWidth: 820, alignment: .leading)
        }
        .task {
            lumioField = session.lumioURL
            board = try? await session.lumio?.rewards()
            await check()
        }
    }

    private func check() async {
        serverOK = (try? await session.lumio?.me()) != nil
    }

    private func rankCard(_ me: RankRow, _ b: RewardsBoard) -> some View {
        HStack(spacing: 20) {
            RankShield(tier: me.grade.tier ?? 0, size: 84)
            VStack(alignment: .leading, spacing: 6) {
                Text(session.userName).font(.system(size: 26, weight: .heavy))
                Text("\(me.grade.name) · \(me.points) points · \(me.rank)\(me.rank == 1 ? "er" : "e") de la famille").foregroundStyle(Theme.dim)
                if let n = me.next {
                    ProgressView(value: Double(me.points - me.grade.min), total: Double(max(1, n.min - me.grade.min))).tint(Theme.accent)
                    Text("Encore \(n.min - me.points) points pour \(n.name)").font(.caption).foregroundStyle(Theme.dim)
                }
                HStack(spacing: 14) {
                    stat("\(me.hours) h", "regardées"); stat("\(me.movies)", "films"); stat("\(me.episodes)", "épisodes"); stat("\(me.requests)", "demandes")
                }
                .padding(.top, 4)
                if let badges = me.badges, !badges.isEmpty {
                    Text(badges.map { "\($0.emoji) \($0.name)" }.joined(separator: "   ")).font(.system(size: 13)).padding(.top, 2)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func stat(_ v: String, _ l: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(v).font(.system(size: 17, weight: .bold))
            Text(l).font(.system(size: 11)).foregroundStyle(Theme.dim)
        }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 18, weight: .bold))
            VStack(alignment: .leading, spacing: 6) { content() }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}
