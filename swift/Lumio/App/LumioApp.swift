import SwiftUI

@main
struct LumioApp: App {
    @State private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
        #if os(macOS)
        .defaultSize(width: 1280, height: 820)
        .windowToolbarStyle(.unified)
        #endif
    }
}

struct RootView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        if session.isLoggedIn {
            MainTabs()
        } else {
            LoginView()
        }
    }
}

/// Onglets : barre « Liquid Glass » sur iPhone (iOS 26), barre latérale sur Mac et iPad.
struct MainTabs: View {
    @State private var tab = "home"

    var body: some View {
        TabView(selection: $tab) {
            Tab("Accueil", systemImage: "house.fill", value: "home") {
                NavigationStack { HomeView() }
            }
            Tab("Bibliothèque", systemImage: "square.stack.fill", value: "library") {
                NavigationStack { LibraryView() }
            }
            Tab("Demandes", systemImage: "tray.full.fill", value: "requests") {
                NavigationStack { RequestsView() }
            }
            Tab("Profil", systemImage: "person.crop.circle.fill", value: "profile") {
                NavigationStack { ProfileView() }
            }
            Tab(value: "search", role: .search) {
                NavigationStack { SearchView() }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
    }
}
