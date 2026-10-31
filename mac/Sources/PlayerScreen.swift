// Lecteur plein fenêtre (AVKit) : reprise là où on s'était arrêté, progression envoyée à Jellyfin.
import AVKit
import SwiftUI

struct PlayerScreen: View {
    let request: PlayRequest
    let client: JellyfinClient
    let close: () -> Void

    @State private var player: AVPlayer?
    @State private var error: String?
    @State private var source = ""
    @State private var playSession: String?
    @State private var method = "DirectPlay"
    @State private var timer: Timer?
    @State private var hoverClose = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            if let player {
                AVPlayerViewRepresentable(player: player).ignoresSafeArea()
            } else if let error {
                MessageView(icon: "exclamationmark.triangle", text: error)
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text(request.item.title).foregroundStyle(Theme.dim)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button(action: stop) {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .frame(width: 34, height: 34)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .padding(.leading, 18)
            .padding(.top, 34)
            .opacity(hoverClose || player == nil ? 1 : 0.55)
            .onHover { hoverClose = $0 }
            .help("Fermer (Échap)")
        }
        .task { await start() }
        .onDisappear { cleanup() }
    }

    private var startTicks: Int64 {
        request.fromStart ? 0 : (request.item.UserData?.PlaybackPositionTicks ?? 0)
    }

    private func start() async {
        do {
            let p = try await client.playback(itemId: request.item.Id, startTicks: startTicks)
            source = p.mediaSourceId
            playSession = p.session
            method = p.method
            let av = AVPlayer(url: p.url)
            // Flux HLS : Jellyfin le commence déjà au bon endroit ; fichier direct : on se place nous-mêmes
            if p.method == "DirectPlay", startTicks > 0 {
                await av.seek(to: CMTime(seconds: Double(startTicks) / 10_000_000, preferredTimescale: 600))
            }
            player = av
            av.play()
            await client.reportStart(request.item.Id, source: source, session: playSession, ticks: startTicks, method: method)
            timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in
                Task { @MainActor in
                    await client.reportProgress(request.item.Id, source: source, session: playSession, ticks: currentTicks(), paused: (player?.rate ?? 0) == 0, method: method)
                }
            }
        } catch {
            self.error = "Lecture impossible.\n\(error.localizedDescription)"
        }
    }

    /// Position en « ticks » Jellyfin (1 s = 10 000 000). Pour un flux HLS qui commence au point de reprise, on ajoute ce décalage.
    private func currentTicks() -> Int64 {
        let s = player?.currentTime().seconds ?? 0
        let base = method == "DirectPlay" ? 0 : startTicks
        return base + Int64((s.isFinite ? s : 0) * 10_000_000)
    }

    private func stop() {
        cleanup()
        close()
    }

    private func cleanup() {
        timer?.invalidate()
        timer = nil
        guard let p = player else { return }
        let ticks = currentTicks()
        p.pause()
        player = nil
        let id = request.item.Id, src = source, sess = playSession
        Task { await client.reportStop(id, source: src, session: sess, ticks: ticks) }
    }
}

struct AVPlayerViewRepresentable: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let v = AVPlayerView()
        v.player = player
        v.controlsStyle = .floating
        v.showsFullScreenToggleButton = true
        v.allowsPictureInPicturePlayback = true
        return v
    }

    func updateNSView(_ v: AVPlayerView, context: Context) {
        if v.player !== player { v.player = player }
    }
}
