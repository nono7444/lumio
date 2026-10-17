import Foundation
import Observation

/// État partagé de l'appli : pastilles (chat, signalements), notes de la famille, statut des titres.
@MainActor
@Observable
final class AppState {
    var ratings: [String: RatingSummary] = [:]
    var library: [String: [String: Int]] = [:]
    var chatLatest = ChatLatest()
    var problemCount = 0
    var pendingRequests = 0
    var serverOK: Bool?

    @ObservationIgnored private var lastRead = UserDefaults.standard.string(forKey: "chat.lastReadAt") ?? ""
    @ObservationIgnored private var timer: Task<Void, Never>?

    var unreadChat: Bool = false

    func rating(_ type: String, _ tmdbId: Int?) -> RatingSummary? {
        guard let tmdbId else { return nil }
        return ratings["\(type):\(tmdbId)"]
    }

    /// Statut d'un titre TMDB dans Radarr / Sonarr / Jellyfin (5 = disponible, 2 = en attente, 3 = en cours).
    func status(_ type: String, _ tmdbId: Int) -> Int? {
        library[type == "tv" ? "series" : "movies"]?[String(tmdbId)]
    }

    func start(_ session: AppSession) {
        timer?.cancel()
        timer = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh(session)
                try? await Task.sleep(for: .seconds(45))
            }
        }
    }

    func refresh(_ session: AppSession) async {
        guard session.isLoggedIn else { return }
        let api = session.lumio
        if let r = try? await api.ratingSummary() { ratings = r } else if let top = try? await api.topRated() {
            ratings = Dictionary(top.map { ("\($0.type):\($0.tmdbId)", RatingSummary(avg: ($0.avg * 10).rounded() / 10, count: $0.count)) }, uniquingKeysWith: { a, _ in a })
        }
        if let lib = try? await api.library() { library = lib; serverOK = true } else { serverOK = false }
        if let l = try? await api.latest() {
            chatLatest = l
            updateUnread(session)
        }
        if session.isAdmin {
            if let ideas = try? await api.ideas() { problemCount = ideas.filter { $0.kind == "bug" && $0.status == "new" }.count }
            if let r = try? await api.requests(filter: "pending") { pendingRequests = r.counts?.pending ?? r.results.count }
        }
    }

    func refreshRatings(_ session: AppSession) async {
        if let r = try? await session.lumio.ratingSummary() { ratings = r }
    }

    private func updateUnread(_ session: AppSession) {
        guard let at = chatLatest.at, chatLatest.from != session.userId else { unreadChat = false; return }
        unreadChat = at > lastRead
    }

    func markChatRead(_ at: String?) {
        guard let v = at ?? chatLatest.at, v > lastRead else { unreadChat = false; return }
        lastRead = v
        UserDefaults.standard.set(v, forKey: "chat.lastReadAt")
        unreadChat = false
    }
}
