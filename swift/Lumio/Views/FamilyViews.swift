import SwiftUI

/// Notes de la famille : moyenne, ma note en étoiles (toucher à nouveau la même étoile l'enlève), petit avis, avis des autres.
struct FamilyRatingCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state
    let type: String
    let tmdbId: Int
    let title: String
    var poster: String?

    @State private var info: RatingInfo?
    @State private var reviewing = false
    @State private var comment = ""

    var body: some View {
        Group {
            if let info {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Notes de la famille").font(.headline)
                        Spacer()
                        if let avg = info.avg {
                            Label("\(avg.formatted(.number.precision(.fractionLength(0...1)))) · \(info.count) avis", systemImage: "star.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.gold)
                        } else {
                            Text("Pas encore noté").font(.subheadline).foregroundStyle(Theme.dim)
                        }
                    }
                    HStack(spacing: 12) {
                        Text("Ta note").font(.subheadline).foregroundStyle(Theme.dim)
                        HStack(spacing: 6) {
                            ForEach(1...5, id: \.self) { n in
                                let mine = info.mine?.stars ?? 0
                                Button { rate(n == mine ? 0 : n, comment: info.mine?.comment) } label: {
                                    Image(systemName: n <= mine ? "star.fill" : "star")
                                        .font(.title2)
                                        .foregroundStyle(n <= mine ? Theme.gold : Theme.dim)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        Spacer()
                        Button {
                            comment = info.mine?.comment ?? ""
                            reviewing = true
                        } label: {
                            Image(systemName: "text.bubble").padding(9).background(Theme.surfaceHigh, in: Circle())
                        }
                        .buttonStyle(.plain)
                    }
                    if let c = info.mine?.comment, !c.isEmpty {
                        Text("« \(c) »").font(.subheadline)
                    }
                    ForEach(info.list.filter { !$0.mine }, id: \.self) { v in
                        Divider()
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(v.name).font(.subheadline.bold())
                                Text(String(repeating: "★", count: v.stars)).font(.caption).foregroundStyle(Theme.gold)
                                Spacer()
                                Text(timeAgo(v.at)).font(.caption).foregroundStyle(Theme.dim)
                            }
                            if let c = v.comment { Text(c).font(.subheadline).foregroundStyle(Theme.dim) }
                        }
                    }
                }
                .padding(14)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
            }
        }
        .task(id: tmdbId) { await load() }
        .alert("Ton avis", isPresented: $reviewing) {
            TextField("Un petit mot pour la famille", text: $comment)
            Button("Annuler", role: .cancel) {}
            Button("Enregistrer") { rate(max(info?.mine?.stars ?? 0, 1), comment: comment) }
        } message: {
            Text("Il sera visible sous ta note.")
        }
    }

    private func load() async {
        info = try? await session.lumio.rating(type: type, tmdbId: tmdbId)
    }

    private func rate(_ stars: Int, comment: String?) {
        Task {
            do {
                try await session.lumio.rate(type: type, tmdbId: tmdbId, stars: stars, comment: comment, title: title, poster: poster)
                await load()
                await state.refreshRatings(session)
            } catch {
                Toast.shared.show(error.localizedDescription, error: true)
            }
        }
    }
}

/// « Signaler un problème » sur un film ou une série → arrive chez l'admin (Idées & signalements).
struct ReportProblemButton: View {
    @Environment(AppSession.self) private var session
    let type: String
    let tmdbId: Int
    let title: String
    var poster: String?
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            Label("Signaler un problème", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Color(hex: "#FFB340"))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Color(hex: "#FFB340").opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $open) {
            ReportSheet(type: type, tmdbId: tmdbId, title: title, poster: poster)
                .presentationDetents([.medium, .large])
        }
    }
}

private struct ReportSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let type: String
    let tmdbId: Int
    let title: String
    var poster: String?
    static let categories = ["Vidéo", "Son", "Sous-titres", "Mauvais film / épisode", "Épisode manquant", "Autre"]
    @State private var cat = "Vidéo"
    @State private var details = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section(title) {
                    Picker("Problème", selection: $cat) {
                        ForEach(ReportSheet.categories, id: \.self) { Text($0) }
                    }
                    TextField("Ce qui ne va pas (épisode, minute, langue…)", text: $details, axis: .vertical)
                        .lineLimit(3...8)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Signaler un problème")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Envoyer") { send() }.disabled(busy)
                }
            }
        }
    }

    private func send() {
        busy = true
        Task {
            do {
                try await session.lumio.createIdea(kind: "bug", title: "\(cat) · \(title)", details: details, category: cat,
                                                   media: Idea.Media(type: type, tmdbId: tmdbId, title: title, poster: poster))
                Toast.shared.show("Merci ! Le problème est signalé à l'admin.")
                dismiss()
            } catch {
                Toast.shared.show(error.localizedDescription, error: true)
            }
            busy = false
        }
    }
}

/// « il y a 2 h », « il y a 3 j »…
func timeAgo(_ iso: String) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
    let s = Date().timeIntervalSince(d)
    if s < 60 { return "à l'instant" }
    if s < 3600 { return "il y a \(Int(s / 60)) min" }
    if s < 86400 { return "il y a \(Int(s / 3600)) h" }
    if s < 86400 * 30 { return "il y a \(Int(s / 86400)) j" }
    return d.formatted(.dateTime.day().month().year().locale(Locale(identifier: "fr_FR")))
}
