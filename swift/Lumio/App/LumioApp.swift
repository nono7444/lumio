import SwiftUI

@main
struct LumioApp: App {
    @State private var session = AppSession()
    @State private var state = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(state)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
        #if os(macOS)
        .defaultSize(width: 1280, height: 820)
        #endif
    }
}

struct RootView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppState.self) private var state

    var body: some View {
        Group {
            if session.isLoggedIn {
                MainTabs()
                    .task(id: session.token) {
                        await session.loadCloud()
                        state.start(session)
                    }
            } else {
                LoginView()
            }
        }
        .toastHost()
    }
}

/// Onglets : barre « Liquid Glass » sur iPhone (iOS 26), barre latérale sur Mac et iPad.
/// Calendrier, Chat, Profil et signalements sont en haut de l'accueil (comme dans l'appli Lumio).
struct MainTabs: View {
    @Environment(AppState.self) private var state
    @State private var tab = "home"

    var body: some View {
        TabView(selection: $tab) {
            Tab("Accueil", systemImage: "house.fill", value: "home") {
                NavigationStack { HomeView() }
            }
            Tab("Bibliothèque", systemImage: "square.stack.fill", value: "library") {
                NavigationStack { LibraryView() }
            }
            Tab("Live TV", systemImage: "tv.fill", value: "live") {
                NavigationStack { LiveView() }
            }
            Tab("Demandes", systemImage: "tray.full.fill", value: "requests") {
                NavigationStack { RequestsView() }
            }
            .badge(state.pendingRequests)
            Tab(value: "search", role: .search) {
                NavigationStack { SearchView() }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
    }
}

// ——— Petits messages en bas de l'écran ———

@MainActor
@Observable
final class Toast {
    static let shared = Toast()
    var text: String?
    var isError = false
    private var task: Task<Void, Never>?

    func show(_ text: String, error: Bool = false) {
        self.text = text
        isError = error
        task?.cancel()
        task = Task {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { self.text = nil }
        }
    }
}

extension View {
    func toastHost() -> some View {
        overlay(alignment: .bottom) {
            ToastView().padding(.bottom, 90)
        }
    }
}

private struct ToastView: View {
    @State private var toast = Toast.shared
    var body: some View {
        if let t = toast.text {
            Label(t, systemImage: toast.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 16).padding(.vertical, 12)
                .glassCard(cornerRadius: 22)
                .padding(.horizontal)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .animation(.spring, value: toast.text)
        }
    }
}
