import AVKit
import SwiftUI

/// Ce que lit le lecteur : un élément Jellyfin, ou une chaîne Live TV (plusieurs sources possibles).
enum PlayerSource: Identifiable, Hashable {
    case jellyfin(JfItem, fromStart: Bool)
    case live(title: String, streams: [LiveStream])

    var id: String {
        switch self {
        case .jellyfin(let i, let f): return "jf:\(i.Id):\(f)"
        case .live(let t, let s): return "live:\(t):\(s.first?.url.absoluteString ?? "")"
        }
    }
}

extension LiveStream: Identifiable { var id: String { url.absoluteString } }

/// Lecteur natif (AVPlayer) : lecture directe des MP4 / MOV, sinon flux HLS converti par Jellyfin.
/// Remonte la position à Jellyfin, propose la qualité, enchaîne l'épisode suivant.
@MainActor
@Observable
final class PlayerModel {
    var player: AVPlayer?
    var error: String?
    var title = ""
    var subtitle = ""
    var quality = "original"
    var nextUp: JfItem?
    var countdown = 0
    var stats: [String] = []
    var liveIndex = 0

    @ObservationIgnored private var playback: JellyfinAPI.Playback?
    @ObservationIgnored private var api: JellyfinAPI?
    @ObservationIgnored private var observer: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var statusTask: Task<Void, Never>?
    @ObservationIgnored private var lastReport = Date.distantPast
    @ObservationIgnored private var item: JfItem?
    @ObservationIgnored private var streams: [LiveStream] = []

    func start(_ source: PlayerSource, session: AppSession) async {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        quality = session.quality
        switch source {
        case .jellyfin(let item, let fromStart):
            await startJellyfin(item, session: session, startAt: fromStart ? 0 : item.resumeSeconds)
        case .live(let t, let s):
            title = t
            subtitle = "En direct"
            streams = s
            playLive(0)
        }
    }

    // ——— Jellyfin ———

    func startJellyfin(_ item: JfItem, session: AppSession, startAt: Double) async {
        teardown(report: true)
        self.item = item
        nextUp = nil
        error = nil
        title = item.isEpisode ? "\(item.SeriesName ?? "") · \(item.episodeLabel)" : item.name
        subtitle = item.isEpisode ? item.name : (item.ProductionYear.map { String($0) } ?? "")
        let api = session.jellyfin
        self.api = api
        do {
            let q = Quality.of(quality)
            let p = try await api.playback(itemId: item.Id, startSeconds: startAt, quality: q.bitrate == nil ? nil : q)
            playback = p
            let av = AVPlayer(url: p.url)
            av.allowsExternalPlayback = true
            player = av
            if startAt > 5 {
                await av.seek(to: CMTime(seconds: startAt, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            }
            av.play()
            await api.report("start", p, position: startAt, paused: false)
            observer = av.addPeriodicTimeObserver(forInterval: CMTime(seconds: 2, preferredTimescale: 1), queue: .main) { [weak self] t in
                Task { @MainActor in self?.tick(t.seconds) }
            }
            endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: av.currentItem, queue: .main) { [weak self] _ in
                Task { @MainActor in await self?.ended(session) }
            }
            watchFailure(av)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func changeQuality(_ q: String, session: AppSession) async {
        guard let item, let av = player else { return }
        quality = q
        let pos = av.currentTime().seconds
        await startJellyfin(item, session: session, startAt: pos.isFinite ? pos : item.resumeSeconds)
    }

    private func tick(_ pos: Double) {
        updateStats()
        guard let p = playback, let api, Date().timeIntervalSince(lastReport) > 10 else { return }
        lastReport = Date()
        let paused = (player?.rate ?? 0) == 0
        Task { await api.report("progress", p, position: pos, paused: paused) }
    }

    private func ended(_ session: AppSession) async {
        guard let item, item.isEpisode, let next = await session.jellyfin.episodeAfter(item) else { return }
        nextUp = next
        countdown = 8
        while countdown > 0 {
            try? await Task.sleep(for: .seconds(1))
            guard nextUp != nil else { return }
            countdown -= 1
        }
        if let n = nextUp { await startJellyfin(n, session: session, startAt: 0) }
    }

    func cancelNext() { nextUp = nil }

    // ——— Live TV : on passe à la source suivante si l'une ne marche pas (erreur ou 20 s sans image) ———

    private func playLive(_ i: Int) {
        teardown(report: false)
        guard i < streams.count else {
            error = streams.count > 1 ? "\(streams.count) sources essayées, aucune ne fonctionne pour le moment." : "Cette chaîne ne répond pas."
            return
        }
        liveIndex = i
        let s = streams[i]
        let asset = AVURLAsset(url: s.url, options: s.headers.map { ["AVURLAssetHTTPHeaderFieldsKey": $0] })
        let av = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        player = av
        av.play()
        observer = av.addPeriodicTimeObserver(forInterval: CMTime(seconds: 2, preferredTimescale: 1), queue: .main) { [weak self] _ in
            Task { @MainActor in self?.updateStats() }
        }
        statusTask = Task { [weak self] in
            for _ in 0..<40 {
                try? await Task.sleep(for: .milliseconds(500))
                guard let self, !Task.isCancelled else { return }
                if av.currentItem?.status == .failed { self.playLive(i + 1); return }
                if av.currentItem?.status == .readyToPlay && av.currentTime().seconds > 0.5 { return }
            }
            guard let self, !Task.isCancelled else { return }
            if av.currentTime().seconds < 0.5 { self.playLive(i + 1) }
        }
    }

    private func watchFailure(_ av: AVPlayer) {
        statusTask = Task { [weak self] in
            for _ in 0..<60 {
                try? await Task.sleep(for: .milliseconds(500))
                guard let self, !Task.isCancelled else { return }
                if av.currentItem?.status == .failed {
                    self.error = av.currentItem?.error?.localizedDescription ?? "Lecture impossible"
                    return
                }
                if av.currentItem?.status == .readyToPlay { return }
            }
        }
    }

    private func updateStats() {
        guard let it = player?.currentItem else { return }
        var out: [String] = []
        if let p = playback { out.append("Méthode : \(p.playMethod == "DirectPlay" ? "lecture directe" : p.playMethod == "DirectStream" ? "flux direct" : "conversion par le serveur")") }
        let size = it.presentationSize
        if size.width > 0 { out.append("Image : \(Int(size.width))×\(Int(size.height))") }
        if let e = it.accessLog()?.events.last {
            if e.indicatedBitrate > 0 { out.append(String(format: "Débit du flux : %.1f Mb/s", e.indicatedBitrate / 1_000_000)) }
            if e.observedBitrate > 0 { out.append(String(format: "Réseau : %.1f Mb/s", e.observedBitrate / 1_000_000)) }
            if e.numberOfDroppedVideoFrames > 0 { out.append("Images perdues : \(e.numberOfDroppedVideoFrames)") }
        }
        if let r = it.loadedTimeRanges.last?.timeRangeValue {
            let buf = r.end.seconds - it.currentTime().seconds
            if buf.isFinite { out.append(String(format: "Tampon : %.0f s", max(buf, 0))) }
        }
        if !streams.isEmpty { out.append("Source \(liveIndex + 1)/\(streams.count)") }
        stats = out
    }

    private func teardown(report: Bool) {
        statusTask?.cancel()
        statusTask = nil
        guard let av = player else { return }
        let pos = av.currentTime().seconds
        av.pause()
        if let observer { av.removeTimeObserver(observer) }
        observer = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        if report, let p = playback, let api {
            Task { await api.report("stop", p, position: pos.isFinite ? pos : 0, paused: true) }
        }
        player = nil
    }

    func stop() {
        nextUp = nil
        teardown(report: true)
    }
}

struct PlayerView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let source: PlayerSource
    @State private var model = PlayerModel()
    @State private var showStats = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            if let player = model.player {
                NativePlayer(player: player).ignoresSafeArea()
            } else if let error = model.error {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.circle").font(.largeTitle)
                    Text("Lecture impossible").font(.headline)
                    Text(error).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
                    Button("Fermer") { dismiss() }.buttonStyle(.bordered)
                }
                .padding(30)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large)
                    Text(model.title).foregroundStyle(Theme.dim)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            HStack(spacing: 10) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.headline).padding(12).glassCard(cornerRadius: 22)
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.cancelAction)
                Spacer()
                if case .jellyfin = source {
                    Menu {
                        Picker("Qualité", selection: Binding(get: { model.quality }, set: { q in Task { await model.changeQuality(q, session: session) } })) {
                            ForEach(Quality.all) { Text($0.label).tag($0.id) }
                        }
                    } label: {
                        Image(systemName: "dial.medium").font(.headline).padding(12).glassCard(cornerRadius: 22)
                    }
                }
                Button { showStats.toggle() } label: {
                    Image(systemName: "chart.bar.xaxis").font(.headline).padding(12).glassCard(cornerRadius: 22)
                }
                .buttonStyle(.plain)
            }
            .padding()

            if showStats && !model.stats.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(model.stats, id: \.self) { Text($0).font(.caption.monospaced()) }
                }
                .padding(10)
                .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 10))
                .padding(.top, 76).padding(.leading)
            }

            if let next = model.nextUp {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Épisode suivant dans \(model.countdown) s").font(.caption).foregroundStyle(Theme.dim)
                    Text("\(next.episodeLabel) · \(next.name)").font(.headline).lineLimit(2)
                    HStack {
                        Button("Lire maintenant") { Task { await model.startJellyfin(next, session: session, startAt: 0) } }
                            .buttonStyle(.borderedProminent)
                        Button("Annuler") { model.cancelNext() }.buttonStyle(.bordered)
                    }
                }
                .padding()
                .glassCard(cornerRadius: 18)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            }
        }
        #if os(macOS)
        .frame(minWidth: 960, minHeight: 540)
        #endif
        .task { await model.start(source, session: session) }
        .onDisappear { model.stop() }
    }
}

#if os(iOS)
/// AVPlayerViewController : commandes Apple, pistes audio / sous-titres, image dans l'image, AirPlay.
struct NativePlayer: UIViewControllerRepresentable {
    let player: AVPlayer
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = true
        vc.canStartPictureInPictureAutomaticallyFromInline = true
        return vc
    }
    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        if vc.player !== player { vc.player = player }
    }
}
#else
/// AVPlayerView : commandes macOS, plein écran, image dans l'image.
struct NativePlayer: NSViewRepresentable {
    let player: AVPlayer
    func makeNSView(context: Context) -> AVPlayerView {
        let v = AVPlayerView()
        v.player = player
        v.controlsStyle = .floating
        v.allowsPictureInPicturePlayback = true
        v.showsFullScreenToggleButton = true
        return v
    }
    func updateNSView(_ v: AVPlayerView, context: Context) {
        if v.player !== player { v.player = player }
    }
}
#endif

extension View {
    /// Ouvre le lecteur en plein écran (iPhone) ou en feuille (Mac).
    func playerCover(item: Binding<JfItem?>, fromStart: Bool = false) -> some View {
        playerCover(source: Binding(
            get: { item.wrappedValue.map { PlayerSource.jellyfin($0, fromStart: fromStart) } },
            set: { if $0 == nil { item.wrappedValue = nil } }
        ))
    }

    func playerCover(source: Binding<PlayerSource?>) -> some View {
        #if os(iOS)
        return fullScreenCover(item: source) { PlayerView(source: $0) }
        #else
        return sheet(item: source) { PlayerView(source: $0) }
        #endif
    }
}
