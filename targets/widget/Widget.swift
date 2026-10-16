// Widget « Serveurs » de Lumio : en ligne / hors ligne pour Jellyfin, Radarr, Sonarr et le serveur Lumio,
// avec les téléchargements en cours et les demandes à valider. Données : GET <serveur Lumio>/status/public.
import SwiftUI
import WidgetKit

private let appGroup = "group.lol.wawanono.lumio"
private let defaultServer = "https://lumio.wawanono.lol"

struct ServiceState: Decodable {
  let ok: Bool
  let queue: Int?
}

struct PublicStatus: Decodable {
  let jellyfin: ServiceState?
  let radarr: ServiceState?
  let sonarr: ServiceState?
  let pending: Int?
}

struct StatusEntry: TimelineEntry {
  let date: Date
  let status: PublicStatus?
  let reachable: Bool
}

private func serverURL() -> String {
  let stored = UserDefaults(suiteName: appGroup)?.string(forKey: "serverUrl")
  return (stored?.isEmpty == false ? stored! : defaultServer).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
}

private func fetchStatus() async -> (PublicStatus?, Bool) {
  guard let url = URL(string: serverURL() + "/status/public") else { return (nil, false) }
  var req = URLRequest(url: url)
  req.timeoutInterval = 12
  do {
    let (data, resp) = try await URLSession.shared.data(for: req)
    guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return (nil, false) }
    return (try JSONDecoder().decode(PublicStatus.self, from: data), true)
  } catch {
    return (nil, false)
  }
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> StatusEntry {
    StatusEntry(
      date: Date(),
      status: PublicStatus(
        jellyfin: ServiceState(ok: true, queue: nil),
        radarr: ServiceState(ok: true, queue: 2),
        sonarr: ServiceState(ok: true, queue: 5),
        pending: 1
      ),
      reachable: true
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
    if context.isPreview {
      completion(placeholder(in: context))
      return
    }
    Task {
      let (s, ok) = await fetchStatus()
      completion(StatusEntry(date: Date(), status: s, reachable: ok))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
    Task {
      let (s, ok) = await fetchStatus()
      let entry = StatusEntry(date: Date(), status: s, reachable: ok)
      // iOS décide du rythme réel ; on demande une mise à jour toutes les 15 min
      completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
  }
}

private struct Row: View {
  let name: String
  let symbol: String
  let state: ServiceState?
  let lumioReachable: Bool
  var compact = false

  var body: some View {
    let ok = lumioReachable && (state?.ok ?? false)
    HStack(spacing: 8) {
      Image(systemName: symbol)
        .font(.system(size: compact ? 11 : 13, weight: .semibold))
        .foregroundColor(.white.opacity(0.75))
        .frame(width: 16)
      Text(name)
        .font(.system(size: compact ? 12 : 14, weight: .semibold))
        .foregroundColor(.white)
        .lineLimit(1)
      Spacer(minLength: 4)
      if let q = state?.queue, q > 0, !compact {
        Text("\(q) ⬇︎")
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(Color(red: 0.24, green: 0.55, blue: 1.0))
      }
      Circle()
        .fill(ok ? Color(red: 0.19, green: 0.82, blue: 0.35) : Color(red: 1.0, green: 0.27, blue: 0.23))
        .frame(width: 9, height: 9)
    }
  }
}

struct LumioWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: StatusEntry

  var body: some View {
    let s = entry.status
    let allOk = entry.reachable && (s?.jellyfin?.ok ?? false) && (s?.radarr?.ok ?? true) && (s?.sonarr?.ok ?? true)
    let compact = family == .systemSmall
    VStack(alignment: .leading, spacing: compact ? 6 : 8) {
      HStack(spacing: 6) {
        Text("Lumio")
          .font(.system(size: compact ? 15 : 17, weight: .heavy))
          .foregroundColor(.white)
        Spacer()
        Text(allOk ? "OK" : "!")
          .font(.system(size: 11, weight: .black))
          .padding(.horizontal, 7)
          .padding(.vertical, 2)
          .background(allOk ? Color(red: 0.19, green: 0.82, blue: 0.35) : Color(red: 1.0, green: 0.62, blue: 0.04))
          .foregroundColor(.black)
          .clipShape(Capsule())
      }
      Row(name: "Jellyfin", symbol: "play.rectangle.fill", state: s?.jellyfin, lumioReachable: entry.reachable, compact: compact)
      Row(name: "Radarr", symbol: "film.fill", state: s?.radarr, lumioReachable: entry.reachable, compact: compact)
      Row(name: "Sonarr", symbol: "tv.fill", state: s?.sonarr, lumioReachable: entry.reachable, compact: compact)
      Row(name: "Lumio", symbol: "server.rack", state: ServiceState(ok: entry.reachable, queue: nil), lumioReachable: true, compact: compact)
      if !compact {
        Spacer(minLength: 0)
        HStack {
          if let p = s?.pending, p > 0 {
            Text("\(p) demande\(p > 1 ? "s" : "") à valider")
              .font(.system(size: 11, weight: .bold))
              .foregroundColor(Color(red: 1.0, green: 0.62, blue: 0.04))
          }
          Spacer()
          Text(entry.date, style: .time)
            .font(.system(size: 10, weight: .medium))
            .foregroundColor(.white.opacity(0.45))
        }
      }
    }
    .widgetURL(URL(string: "lumio://settings"))
    .modifier(WidgetBackground())
  }
}

/// Fond du widget (API différente avant / après iOS 17).
private struct WidgetBackground: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content.containerBackground(for: .widget) {
        LinearGradient(colors: [Color(red: 0.07, green: 0.09, blue: 0.16), Color(red: 0.02, green: 0.03, blue: 0.05)], startPoint: .top, endPoint: .bottom)
      }
    } else {
      content
        .padding()
        .background(LinearGradient(colors: [Color(red: 0.07, green: 0.09, blue: 0.16), Color(red: 0.02, green: 0.03, blue: 0.05)], startPoint: .top, endPoint: .bottom))
    }
  }
}

@main
struct LumioWidget: Widget {
  let kind = "LumioWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      LumioWidgetView(entry: entry)
    }
    .configurationDisplayName("Serveurs Lumio")
    .description("Jellyfin, Radarr, Sonarr et le serveur Lumio : en ligne ou non.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
