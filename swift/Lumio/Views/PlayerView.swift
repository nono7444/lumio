import AVKit
import SwiftUI

/// Lecteur natif (AVPlayer) : lecture directe des MP4 / MOV, sinon flux HLS converti par Jellyfin.
/// Remonte la position à Jellyfin (reprise sur tous les appareils).
@MainActor
@Observable
final class PlayerModel {
    var player: AVPlayer?
    var error: String?
    var title = ""
    var subtitle = ""

    private var playback: JellyfinAPI.Playback?
    private var api: JellyfinAPI?
    private var observer: Any?
    private var lastReport = Date.distantPast

    func start(item: JfItem, session: AppSession, fromStart: Bool) async {
        title = item.isEpisode ? "\(item.SeriesName ?? "") · \(item.episodeLabel)" : item.name
        subtitle = item.isEpisode ? item.name : (item.ProductionYear.map { String($0) } ?? "")
        let api = session.jellyfin
        self.api = api
        let startAt = fromStart ? 0 : item.resumeSeconds
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        do {
            let p = try await api.playback(itemId: item.Id, startSeconds: startAt)
            playback = p
            let av = AVPlayer(url: p.url)
            av.allowsExternalPlayback = true
            player = av
            if startAt > 5 {
                await av.seek(to: CMTime(seconds: startAt, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            }
            av.play()
            await api.report("start", p, position: startAt, paused: false)
            observer = av.addPeriodicTimeObserver(forInterval: CMTime(seconds: 5, preferredTimescale: 1), queue: .main) { [weak self] t in
                Task { @MainActor in self?.tick(t.seconds) }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func tick(_ pos: Double) {
        guard let p = playback, let api, Date().timeIntervalSince(lastReport) > 10 else { return }
        lastReport = Date()
        let paused = (player?.rate ?? 0) == 0
        Task { await api.report("progress", p, position: pos, paused: paused) }
    }

    func stop() {
        guard let av = player else { return }
        let pos = av.currentTime().seconds
        av.pause()
        if let observer { av.removeTimeObserver(observer) }
        observer = nil
        if let p = playback, let api {
            Task { await api.report("stop", p, position: pos.isFinite ? pos : 0, paused: true) }
        }
        player = nil
    }
}

struct PlayerView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let item: JfItem
    var fromStart = false
    @State private var model = PlayerModel()

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
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.headline).padding(12).glassCard(cornerRadius: 22)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .padding()
        }
        #if os(macOS)
        .frame(minWidth: 960, minHeight: 540)
        #endif
        .task { await model.start(item: item, session: session, fromStart: fromStart) }
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
    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) { vc.player = player }
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
    func updateNSView(_ v: AVPlayerView, context: Context) { v.player = player }
}
#endif

extension View {
    /// Ouvre le lecteur en plein écran (iPhone) ou en feuille (Mac) pour l'élément choisi.
    func playerCover(item: Binding<JfItem?>, fromStart: Bool = false) -> some View {
        #if os(iOS)
        return fullScreenCover(item: item) { PlayerView(item: $0, fromStart: fromStart) }
        #else
        return sheet(item: item) { PlayerView(item: $0, fromStart: fromStart) }
        #endif
    }

    func playerCover(isPresented: Binding<Bool>, item: JfItem) -> some View {
        #if os(iOS)
        return fullScreenCover(isPresented: isPresented) { PlayerView(item: item) }
        #else
        return sheet(isPresented: isPresented) { PlayerView(item: item) }
        #endif
    }
}
