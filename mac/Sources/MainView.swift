// Fenêtre principale : barre latérale (Accueil, Recherche, bibliothèques) et contenu.
import SwiftUI

enum SidebarItem: Hashable {
    case home
    case search
    case library(String, String) // id, nom
}

struct MainView: View {
    @EnvironmentObject var session: Session
    @State private var selection: SidebarItem? = .home
    @State private var libraries: [JFItem] = []
    @State private var path = NavigationPath()

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Label("Accueil", systemImage: "house").tag(SidebarItem.home)
                Label("Recherche", systemImage: "magnifyingglass").tag(SidebarItem.search)
                if !libraries.isEmpty {
                    Section("Bibliothèques") {
                        ForEach(libraries) { lib in
                            Label(lib.title, systemImage: icon(lib.CollectionType)).tag(SidebarItem.library(lib.Id, lib.title))
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 190, ideal: 210)
            .safeAreaInset(edge: .bottom) {
                HStack {
                    Image(systemName: "person.crop.circle.fill").foregroundStyle(Theme.dim)
                    Text(session.userName).lineLimit(1)
                    Spacer()
                    Button { session.logout() } label: { Image(systemName: "rectangle.portrait.and.arrow.right") }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.dim)
                        .help("Se déconnecter")
                }
                .padding(12)
            }
        } detail: {
            NavigationStack(path: $path) {
                content
                    .navigationDestination(for: JFItem.self) { DetailView(item: $0) }
            }
            .background(Theme.bg)
        }
        .onChange(of: selection) { _ in path = NavigationPath() }
        .task {
            if let c = session.client { libraries = (try? await c.views()) ?? [] }
        }
    }

    @ViewBuilder private var content: some View {
        switch selection ?? .home {
        case .home: HomeView()
        case .search: SearchView()
        case .library(let id, let name): LibraryView(parentId: id, name: name).id(id)
        }
    }

    private func icon(_ type: String?) -> String {
        switch type {
        case "movies": return "film"
        case "tvshows": return "tv"
        case "boxsets": return "square.stack"
        default: return "folder"
        }
    }
}
