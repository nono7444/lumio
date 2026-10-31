// Fenêtre principale : barre latérale (comme les onglets de l'iPhone) et contenu.
import SwiftUI

enum SidebarItem: String, Hashable, CaseIterable {
    case home, search, library, calendar, requests, watchlist, chat, profile

    var label: String {
        switch self {
        case .home: return "Accueil"
        case .search: return "Recherche"
        case .library: return "Bibliothèque"
        case .calendar: return "Agenda"
        case .requests: return "Demandes"
        case .watchlist: return "À voir"
        case .chat: return "Chat"
        case .profile: return "Profil"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house"
        case .search: return "magnifyingglass"
        case .library: return "rectangle.stack"
        case .calendar: return "calendar"
        case .requests: return "tray.and.arrow.down"
        case .watchlist: return "bookmark"
        case .chat: return "bubble.left.and.bubble.right"
        case .profile: return "person.crop.circle"
        }
    }
}

struct MainView: View {
    @EnvironmentObject var session: Session
    @State private var selection: SidebarItem? = .home
    @State private var path = NavigationPath()

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach([SidebarItem.home, .search, .library], id: \.self) { item in
                    Label(item.label, systemImage: item.icon).tag(item)
                }
                Section("Lumio") {
                    ForEach([SidebarItem.calendar, .requests, .watchlist, .chat], id: \.self) { item in
                        Label(item.label, systemImage: item.icon).tag(item)
                    }
                }
                Section {
                    Label(SidebarItem.profile.label, systemImage: SidebarItem.profile.icon).tag(SidebarItem.profile)
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 190, ideal: 210)
        } detail: {
            NavigationStack(path: $path) {
                content.lumioDestinations()
            }
            .background(Theme.bg)
        }
        .onChange(of: selection) { _ in path = NavigationPath() }
        .task { await session.prepare() }
    }

    @ViewBuilder private var content: some View {
        switch selection ?? .home {
        case .home: HomeView()
        case .search: SearchView()
        case .library: LibraryHomeView()
        case .calendar: CalendarView()
        case .requests: RequestsView()
        case .watchlist: WatchlistView()
        case .chat: ChatView()
        case .profile: ProfileView()
        }
    }
}
