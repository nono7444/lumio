import SwiftUI

/// Calendrier des sorties numériques, par plateforme (Netflix, Prime Video, Disney+…).
struct CalendarView: View {
    @Environment(AppSession.self) private var session
    @State private var items: [Release] = []
    @State private var loading = true
    @State private var error: String?
    @State private var platform: String?
    @State private var filter = "all"

    private var platforms: [(Platform, Int)] {
        var counts: [String: (Platform, Int)] = [:]
        for r in items {
            for p in r.providers where !p.rent {
                counts[p.name] = (counts[p.name]?.0 ?? p, (counts[p.name]?.1 ?? 0) + 1)
            }
        }
        return counts.values.sorted { $0.1 > $1.1 }
    }
    private var rentOnly: Int { items.filter { !$0.providers.contains { !$0.rent } }.count }

    private var visible: [Release] {
        items.filter { r in
            (filter == "all" || r.kind == filter) &&
            (platform == nil || (platform == "rent" ? !r.providers.contains { !$0.rent } : r.providers.contains { $0.name == platform && !$0.rent }))
        }
    }

    private var days: [(Date, [Release])] {
        let cal = Calendar.current
        let groups = Dictionary(grouping: visible) { cal.startOfDay(for: $0.date) }
        return groups.keys.sorted().map { ($0, groups[$0]!) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14, pinnedViews: [.sectionHeaders]) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Chip(label: "Toutes", icon: "square.grid.2x2", on: platform == nil) { platform = nil }
                        ForEach(platforms, id: \.0.name) { entry in
                            let p = entry.0, n = entry.1
                            Button { platform = p.name } label: {
                                HStack(spacing: 6) {
                                    AsyncImage(url: p.logo) { ph in
                                        if case .success(let i) = ph { i.resizable() } else { Theme.surface }
                                    }
                                    .frame(width: 24, height: 24).clipShape(RoundedRectangle(cornerRadius: 6))
                                    Text("\(p.name) · \(n)").font(.subheadline.weight(.semibold))
                                }
                                .padding(.leading, 6).padding(.trailing, 12).padding(.vertical, 6)
                                .background(platform == p.name ? Color.white : Theme.surfaceHigh, in: Capsule())
                                .foregroundStyle(platform == p.name ? Color.black : Color.white)
                            }
                            .buttonStyle(.plain)
                        }
                        if rentOnly > 0 {
                            Chip(label: "Achat / location · \(rentOnly)", icon: "cart", on: platform == "rent") { platform = "rent" }
                        }
                    }
                    .padding(.horizontal)
                }
                HStack(spacing: 8) {
                    Chip(label: "Tout", on: filter == "all") { filter = "all" }
                    Chip(label: "Films", on: filter == "movie") { filter = "movie" }
                    Chip(label: "Séries", on: filter == "tv") { filter = "tv" }
                }
                .padding(.horizontal)

                if loading && items.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(40) }
                if let error { ErrorBox(message: error) { Task { await load(force: true) } } }

                ForEach(days, id: \.0) { entry in
                    let day = entry.0, list = entry.1
                    Section {
                        ForEach(list) { r in
                            TmdbLink(type: r.kind, id: r.tmdbId) { ReleaseRow(r: r) }
                        }
                        .padding(.horizontal)
                    } header: {
                        HStack {
                            Text(dayLabel(day)).font(.headline)
                            Spacer()
                            Text("\(list.count)").font(.caption.bold()).foregroundStyle(Theme.dim)
                        }
                        .padding(.horizontal).padding(.vertical, 8)
                        .background(Color.black.opacity(0.92))
                    }
                }
            }
            .padding(.vertical)
        }
        .background(Color.black)
        .navigationTitle("Calendrier")
        .refreshable { await load(force: true) }
        .task { await load() }
    }

    private func load(force: Bool = false) async {
        guard session.hasTmdb else { error = "Ajoute ta clé TMDB (Profil) pour voir les sorties."; loading = false; return }
        loading = true
        do {
            items = try await Releases.fetch(session.tmdb, force: force)
            error = nil
        } catch { self.error = error.localizedDescription }
        loading = false
    }

    private func dayLabel(_ d: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Aujourd'hui" }
        if cal.isDateInTomorrow(d) { return "Demain" }
        if cal.isDateInYesterday(d) { return "Hier" }
        return d.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "fr_FR"))).capitalized
    }
}

private struct ReleaseRow: View {
    @Environment(AppState.self) private var state
    let r: Release
    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: r.poster) { p in
                if case .success(let i) = p { i.resizable().scaledToFill() } else { Theme.surfaceHigh }
            }
            .frame(width: 56, height: 84).clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(r.name).font(.headline).lineLimit(2)
                Text(r.info).font(.caption).foregroundStyle(Theme.dim).lineLimit(2)
                HStack(spacing: 4) {
                    ForEach(r.providers.prefix(4)) { p in
                        AsyncImage(url: p.logo) { ph in if case .success(let i) = ph { i.resizable() } else { Theme.surface } }
                            .frame(width: 20, height: 20).clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                }
            }
            Spacer(minLength: 0)
            if let st = state.status(r.kind, r.tmdbId), let b = StatusBadge.of(st) {
                Image(systemName: b.0).foregroundStyle(b.1)
            }
        }
        .padding(10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}
