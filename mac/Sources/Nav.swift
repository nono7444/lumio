// Destinations de navigation (fiches TMDB, plateformes, bibliothèques, collections).
import SwiftUI

struct MediaRef: Hashable { let type: String; let tmdbId: Int }
struct PlatformRef: Hashable { let id: String; let name: String }
struct LibRef: Hashable { let id: String; let name: String; let collectionType: String? }
struct CollectionsRef: Hashable {}

extension View {
    /// Toutes les destinations, dans n'importe quelle pile
    func lumioDestinations() -> some View {
        self
            .navigationDestination(for: JFItem.self) { DetailView(item: $0) }
            .navigationDestination(for: MediaRef.self) { MediaDetailView(ref: $0) }
            .navigationDestination(for: PlatformRef.self) { PlatformView(ref: $0) }
            .navigationDestination(for: LibRef.self) { LibraryView(lib: $0) }
            .navigationDestination(for: CollectionsRef.self) { _ in CollectionsView() }
            .navigationDestination(for: LumioCollection.self) { CollectionDetailView(collection: $0) }
    }
}

/// Affiche TMDB (fiche) avec titre, année et pastille « Disponible ».
struct TmdbPosterCard: View {
    let ref: MediaRef
    let title: String
    let year: String?
    let poster: URL?
    var badge: String? = nil
    var width: CGFloat = 150
    @State private var hover = false

    var body: some View {
        NavigationLink(value: ref) {
            VStack(alignment: .leading, spacing: 6) {
                RemoteImage(url: poster)
                    .frame(width: width, height: width * 1.5)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(alignment: .topLeading) {
                        if let badge {
                            Text(badge)
                                .font(.system(size: 10, weight: .heavy))
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(badge == "Disponible" ? Color.green.opacity(0.9) : Color.black.opacity(0.7), in: Capsule())
                                .padding(6)
                        }
                    }
                    .shadow(color: .black.opacity(hover ? 0.6 : 0), radius: 12, y: 6)
                    .scaleEffect(hover ? 1.04 : 1)
                Text(title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                Text([ref.type == "tv" ? "Série" : "Film", year].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 11)).foregroundStyle(Theme.dim)
            }
            .frame(width: width)
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(.easeOut(duration: 0.15)) { hover = h } }
    }
}

/// Titre de page.
struct PageTitle: View {
    let text: String
    var body: some View { Text(text).font(.system(size: 30, weight: .heavy)) }
}

/// Puce de filtre.
struct Chip: View {
    let label: String
    let on: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(on ? Color.white : Theme.surfaceHigh, in: Capsule())
                .foregroundStyle(on ? Color.black : Color.white)
        }
        .buttonStyle(.plain)
    }
}

/// Bouton principal (pilule).
struct PillButton: View {
    let title: String
    let icon: String
    var primary = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .fontWeight(.semibold)
                .padding(.horizontal, 18).padding(.vertical, 10)
                .background(primary ? AnyShapeStyle(Color.white) : AnyShapeStyle(.ultraThinMaterial), in: Capsule())
                .foregroundStyle(primary ? Color.black : Color.white)
        }
        .buttonStyle(.plain)
    }
}

let isoDate: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

func parseISO(_ s: String?) -> Date? {
    guard let s else { return nil }
    return isoDate.date(from: s) ?? ISO8601DateFormatter().date(from: s)
}
