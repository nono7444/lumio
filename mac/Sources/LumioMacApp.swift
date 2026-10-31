// Lumio pour Mac — appli native SwiftUI, épurée : accueil, bibliothèques, recherche, lecture.
import SwiftUI

@main
struct LumioMacApp: App {
    @StateObject private var session = Session()

    init() {
        // Les affiches restent en cache entre deux écrans (et deux lancements)
        URLCache.shared = URLCache(memoryCapacity: 80 * 1024 * 1024, diskCapacity: 400 * 1024 * 1024)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.dark)
                .frame(minWidth: 960, minHeight: 620)
        }
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Compte") {
                Button("Se déconnecter") { session.logout() }
                    .disabled(session.client == nil)
            }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var session: Session

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if session.client == nil {
                LoginView()
            } else {
                MainView()
                    .id(session.userName)
            }
            if let req = session.player, let client = session.client {
                PlayerScreen(request: req, client: client) { session.player = nil }
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: session.player)
    }
}

enum Theme {
    static let bg = Color.black
    static let surface = Color(white: 0.09)
    static let surfaceHigh = Color(white: 0.13)
    static let dim = Color(white: 0.63)
    static let faint = Color(white: 0.37)
    static let accent = Color(red: 0.24, green: 0.55, blue: 1.0)
}
