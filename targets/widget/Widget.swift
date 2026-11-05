// Widget « Serveurs » de Lumio, façon UptimeRobot : état de chaque service avec ses 24 dernières heures
// (une barre par heure), le % de disponibilité, et la machine en direct (processeur, chaleur).
// Données : GET <serveur Lumio>/status/public. Rafraîchi toutes les 5 min, à l'ouverture / fermeture de Lumio,
// et d'un tap sur ↻ (iOS 17 et plus).
import SwiftUI
import WidgetKit
import AppIntents

private let appGroup = "group.lol.wawanono.lumio"
private let defaultServer = "https://lumio.wawanono.lol"

// ——— Données ———

struct ServiceState: Decodable {
  let ok: Bool
  let queue: Int?
  let ms: Int?
  let uptime: Double?
  let bars: [Double]?
}

struct Machine: Decodable {
  let cpu: Double?
  let temp: Double?
}

struct SeedTop: Decodable {
  let title: String
  let up: Double?
  let ratio: Double?
}

/// Admin : torrents en partage (nombre, vitesse d'envoi, total envoyé)
struct SeedInfo: Decodable {
  let count: Int?
  let active: Int?
  let up: Double?
  let total: Double?
  let today: Double?
  let top: [SeedTop]?
}

/// Admin : une lecture en cours sur Jellyfin
struct Watching: Decodable {
  let user: String
  let title: String
  let progress: Int?
  let paused: Bool?
}

struct PublicStatus: Decodable {
  let lumio: ServiceState?
  let jellyfin: ServiceState?
  let radarr: ServiceState?
  let sonarr: ServiceState?
  let qbit: ServiceState?
  let vpn: ServiceState?
  let pending: Int?
  let machine: Machine?
  // Seulement avec la clé du widget de l'admin
  var seed: SeedInfo? = nil
  var watching: [Watching]? = nil
  // Public : nombre de lectures en cours (sans nom ni titre)
  var watchingCount: Int? = nil
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

private func widgetKey() -> String? {
  let k = UserDefaults(suiteName: appGroup)?.string(forKey: "widgetKey")
  return k?.isEmpty == false ? k : nil
}

private func fetchStatus() async -> (PublicStatus?, Bool) {
  // Admin : noms et titres en plus avec la clé du widget (App Group) ; sinon l'état public, qui a déjà les compteurs du partage
  if let k = widgetKey(), let url = URL(string: serverURL() + "/status/widget?k=" + k) {
    var req = URLRequest(url: url)
    req.timeoutInterval = 10
    req.cachePolicy = .reloadIgnoringLocalCacheData
    if let (data, resp) = try? await URLSession.shared.data(for: req),
       (resp as? HTTPURLResponse)?.statusCode == 200,
       let st = try? JSONDecoder().decode(PublicStatus.self, from: data) {
      return (st, true)
    }
  }
  guard let url = URL(string: serverURL() + "/status/public") else { return (nil, false) }
  var req = URLRequest(url: url)
  req.timeoutInterval = 10
  req.cachePolicy = .reloadIgnoringLocalCacheData
  for attempt in 0..<2 {
    do {
      let (data, resp) = try await URLSession.shared.data(for: req)
      guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return (nil, false) }
      return (try JSONDecoder().decode(PublicStatus.self, from: data), true)
    } catch {
      if attempt == 0 { try? await Task.sleep(nanoseconds: 1_500_000_000) }
    }
  }
  return (nil, false)
}

private let sampleBars: [Double] = Array(repeating: 1, count: 20) + [0.5, 1, 1, 1]

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> StatusEntry {
    let s = ServiceState(ok: true, queue: nil, ms: 42, uptime: 99.8, bars: sampleBars)
    return StatusEntry(
      date: Date(),
      status: PublicStatus(
        lumio: s, jellyfin: s, radarr: nil, sonarr: nil, qbit: s, vpn: s, pending: 1, machine: Machine(cpu: 12, temp: 48),
        seed: SeedInfo(count: 17, active: 3, up: 2_400_000, total: 128_000_000_000, today: 4_200_000_000, top: [SeedTop(title: "Peter Pan", up: 1_200_000, ratio: 0.8)]),
        watching: [Watching(user: "Marie", title: "Peter Pan", progress: 42, paused: false)]
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
      // Toutes les 5 min (iOS peut espacer un peu) ; 1 min si le serveur ne répond pas, pour revenir vite au vert
      completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(ok ? 5 * 60 : 60))))
    }
  }
}

// ——— Bouton ↻ (iOS 17+) ———

#if canImport(AppIntents)
@available(iOS 17.0, *)
struct RefreshIntent: AppIntent {
  static let title: LocalizedStringResource = "Actualiser"
  func perform() async throws -> some IntentResult {
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}
#endif

private struct RefreshButton: View {
  var body: some View {
    #if canImport(AppIntents)
    if #available(iOS 17.0, *) {
      Button(intent: RefreshIntent()) {
        Image(systemName: "arrow.clockwise")
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(.white.opacity(0.75))
          .frame(width: 22, height: 22)
          .background(Color.white.opacity(0.1))
          .clipShape(Circle())
      }
      .buttonStyle(.plain)
    }
    #endif
  }
}

// ——— Couleurs façon UptimeRobot ———

private let green = Color(red: 0.29, green: 0.87, blue: 0.5)
private let red = Color(red: 1.0, green: 0.27, blue: 0.23)
private let orange = Color(red: 1.0, green: 0.7, blue: 0.25)
private let grey = Color(red: 0.17, green: 0.17, blue: 0.19)
private let cardBg = Color(red: 0.08, green: 0.08, blue: 0.12)

private func barColor(_ v: Double) -> Color {
  if v >= 1 { return green }
  if v >= 0.5 { return orange }
  if v >= 0 { return red }
  return grey
}

private func uptimeColor(_ u: Double?) -> Color {
  guard let u = u else { return green }
  return u >= 99 ? green : u >= 95 ? orange : red
}

private func pct(_ u: Double?) -> String {
  guard let u = u else { return "—" }
  return u >= 100 ? "100%" : String(format: "%.1f%%", u).replacingOccurrences(of: ".", with: ",")
}

/// 128 Go, 850 Mo (unités françaises)
private func bytes(_ b: Double?) -> String {
  let v = b ?? 0
  if v >= 1e12 { return String(format: "%.1f To", v / 1e12).replacingOccurrences(of: ".", with: ",") }
  if v >= 1e9 { return String(format: v >= 1e11 ? "%.0f Go" : "%.1f Go", v / 1e9).replacingOccurrences(of: ".", with: ",") }
  return String(format: "%.0f Mo", v / 1e6)
}

private func speed(_ b: Double?) -> String {
  let v = b ?? 0
  if v >= 1e6 { return String(format: "%.1f Mo/s", v / 1e6).replacingOccurrences(of: ".", with: ",") }
  return String(format: "%.0f ko/s", v / 1e3)
}

private let blue = Color(red: 0.24, green: 0.55, blue: 1.0)

/// « ↑ 2,4 Mo/s · 17 en partage · 128 Go envoyés »
private struct SeedLine: View {
  let seed: SeedInfo
  var size: CGFloat = 11
  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "arrow.up.circle.fill").foregroundColor(green)
      Text(speed(seed.up)).monospacedDigit().foregroundColor(.white)
      Text("· \(seed.count ?? 0) en partage · \(bytes(seed.total))").monospacedDigit().foregroundColor(.white.opacity(0.7))
    }
    .font(.system(size: size, weight: .bold))
    .lineLimit(1)
    .minimumScaleFactor(0.8)
  }
}

/// « ▶︎ Marie · Peter Pan 42 % »
private struct WatchLine: View {
  let w: Watching
  var size: CGFloat = 11
  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: (w.paused ?? false) ? "pause.fill" : "play.fill").font(.system(size: size - 2, weight: .bold)).foregroundColor(blue)
      Text(w.user).font(.system(size: size, weight: .heavy)).foregroundColor(.white)
      Text(w.title).font(.system(size: size, weight: .medium)).foregroundColor(.white.opacity(0.75))
      Spacer(minLength: 2)
      if let p = w.progress { Text("\(p) %").font(.system(size: size - 1, weight: .bold).monospacedDigit()).foregroundColor(.white.opacity(0.5)) }
    }
    .lineLimit(1)
  }
}

// ——— Éléments ———

private struct Bars: View {
  let bars: [Double]
  var height: CGFloat = 12
  var body: some View {
    HStack(spacing: 1.5) {
      ForEach(Array((bars.isEmpty ? Array(repeating: -1.0, count: 24) : bars).enumerated()), id: \.offset) { _, v in
        RoundedRectangle(cornerRadius: 1.5).fill(barColor(v)).frame(height: height)
      }
    }
  }
}

private struct StatusDot: View {
  let ok: Bool
  var size: CGFloat = 8
  var body: some View {
    Circle()
      .fill(ok ? green : red)
      .frame(width: size, height: size)
      .shadow(color: (ok ? green : red).opacity(0.6), radius: 3)
  }
}

struct Svc {
  let name: String
  let symbol: String
  let state: ServiceState?
}

func services(_ e: StatusEntry) -> [Svc] {
  let s = e.status
  var list = [Svc(name: "Lumio", symbol: "sparkles", state: e.reachable ? (s?.lumio ?? ServiceState(ok: true, queue: nil, ms: nil, uptime: nil, bars: nil)) : ServiceState(ok: false, queue: nil, ms: nil, uptime: nil, bars: nil))]
  list.append(Svc(name: "Jellyfin", symbol: "play.circle.fill", state: s?.jellyfin))
  // Lumio Auto : qBittorrent et le VPN ; Radarr / Sonarr seulement s'ils sont encore utilisés
  if s?.qbit != nil { list.append(Svc(name: "qBittorrent", symbol: "arrow.up.arrow.down.circle.fill", state: s?.qbit)) }
  if s?.vpn != nil { list.append(Svc(name: "VPN", symbol: "lock.shield.fill", state: s?.vpn)) }
  if s?.radarr != nil { list.append(Svc(name: "Radarr", symbol: "film.fill", state: s?.radarr)) }
  if s?.sonarr != nil { list.append(Svc(name: "Sonarr", symbol: "tv.fill", state: s?.sonarr)) }
  return list
}

private struct Header: View {
  let entry: StatusEntry
  let allOk: Bool
  var compact = false
  var body: some View {
    HStack(spacing: 6) {
      StatusDot(ok: allOk, size: compact ? 8 : 9)
      Text(compact ? "Lumio" : (allOk ? "Tout est en ligne" : "Un service ne répond pas"))
        .font(.system(size: compact ? 14 : 14, weight: .heavy))
        .foregroundColor(.white)
        .lineLimit(1)
      Spacer(minLength: 2)
      Text(entry.date, style: .time)
        .font(.system(size: 10, weight: .medium).monospacedDigit())
        .foregroundColor(.white.opacity(0.45))
      RefreshButton()
    }
  }
}

private struct MachineLine: View {
  let m: Machine?
  var body: some View {
    HStack(spacing: 10) {
      if let c = m?.cpu {
        Label { Text("\(Int(c)) %").monospacedDigit() } icon: { Image(systemName: "cpu") }
          .foregroundColor(c >= 85 ? red : c >= 60 ? orange : .white.opacity(0.8))
      }
      if let t = m?.temp {
        Label { Text("\(Int(t)) °C").monospacedDigit() } icon: { Image(systemName: "thermometer.medium") }
          .foregroundColor(t >= 80 ? red : t >= 65 ? orange : .white.opacity(0.8))
      }
    }
    .font(.system(size: 11, weight: .bold))
  }
}

// ——— Vues ———

struct LumioWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: StatusEntry

  var body: some View {
    let list = services(entry)
    let allOk = entry.reachable && list.allSatisfy { $0.state?.ok ?? false }
    Group {
      switch family {
      case .systemSmall: small(list, allOk)
      case .systemLarge: large(list, allOk)
      case .accessoryInline: inline(list, allOk)
      case .accessoryCircular: circular(list, allOk)
      case .accessoryRectangular: rectangular(list, allOk)
      default:
        if entry.status?.seed != nil || entry.status?.watching != nil || entry.status?.watchingCount != nil { mediumAdmin(list, allOk) } else { medium(list, allOk) }
      }
    }
    .widgetURL(URL(string: "lumio://settings"))
    .modifier(WidgetBackground(lockScreen: [.accessoryInline, .accessoryCircular, .accessoryRectangular].contains(family)))
  }

  // ——— Écran verrouillé ———

  /// Une ligne au-dessus de l'heure : « Lumio · tout est en ligne » ou le service en panne
  func inline(_ list: [Svc], _ allOk: Bool) -> some View {
    let down = list.filter { !($0.state?.ok ?? false) }.map { $0.name }
    return Label(allOk ? "Lumio · tout est en ligne" : "\(down.joined(separator: ", ")) hors ligne", systemImage: allOk ? "checkmark.circle" : "exclamationmark.triangle")
  }

  /// Rond : services en ligne sur le total
  func circular(_ list: [Svc], _ allOk: Bool) -> some View {
    let up = list.filter { $0.state?.ok ?? false }.count
    return ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 1) {
        Image(systemName: allOk ? "checkmark" : "exclamationmark.triangle.fill").font(.system(size: 13, weight: .bold))
        Text("\(up)/\(list.count)").font(.system(size: 13, weight: .heavy).monospacedDigit())
      }
    }
  }

  /// Rectangle : un point par service, processeur et chaleur
  func rectangular(_ list: [Svc], _ allOk: Bool) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 4) {
        Image(systemName: allOk ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
        Text(allOk ? "Lumio en ligne" : "Lumio : panne").font(.system(size: 13, weight: .bold))
      }
      HStack(spacing: 6) {
        ForEach(list, id: \.name) { s in
          HStack(spacing: 2) {
            Image(systemName: (s.state?.ok ?? false) ? "circle.fill" : "xmark.circle")
              .font(.system(size: 7, weight: .bold))
            Text(String(s.name.prefix(3))).font(.system(size: 11, weight: .semibold))
          }
        }
      }
      if let m = entry.status?.machine {
        Text("\(m.cpu.map { "\(Int($0)) %" } ?? "—") CPU · \(m.temp.map { "\(Int($0)) °C" } ?? "—")")
          .font(.system(size: 11).monospacedDigit())
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  // Petit : état + % par service, machine en bas
  func small(_ list: [Svc], _ allOk: Bool) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Header(entry: entry, allOk: allOk, compact: true)
      ForEach(list, id: \.name) { s in
        HStack(spacing: 6) {
          StatusDot(ok: s.state?.ok ?? false, size: 7)
          Text(s.name).font(.system(size: 12, weight: .semibold)).foregroundColor(.white).lineLimit(1)
          Spacer(minLength: 2)
          Text(pct(s.state?.uptime)).font(.system(size: 11, weight: .bold).monospacedDigit()).foregroundColor(uptimeColor(s.state?.uptime))
        }
      }
      Spacer(minLength: 0)
      if let seed = entry.status?.seed {
        HStack(spacing: 3) {
          Image(systemName: "arrow.up.circle.fill").foregroundColor(green)
          Text("\(bytes(seed.total)) · \(seed.count ?? 0)").monospacedDigit().foregroundColor(.white)
        }
        .font(.system(size: 11, weight: .bold))
        .lineLimit(1)
      }
      MachineLine(m: entry.status?.machine)
    }
  }

  // Moyen (admin) : services en une ligne, puis le partage et qui regarde quoi
  func mediumAdmin(_ list: [Svc], _ allOk: Bool) -> some View {
    let st = entry.status
    return VStack(alignment: .leading, spacing: 6) {
      Header(entry: entry, allOk: allOk)
      HStack(spacing: 8) {
        ForEach(list, id: \.name) { s in
          HStack(spacing: 3) {
            StatusDot(ok: s.state?.ok ?? false, size: 6)
            Text(s.name == "qBittorrent" ? "qBit" : s.name).font(.system(size: 11, weight: .semibold)).foregroundColor(.white.opacity(0.85))
          }
        }
        Spacer(minLength: 0)
      }
      .lineLimit(1)
      if let seed = st?.seed { SeedLine(seed: seed) }
      if let w = st?.watching, !w.isEmpty {
        ForEach(Array(w.prefix(2).enumerated()), id: \.offset) { _, x in WatchLine(w: x) }
      } else {
        let n = entry.status?.watchingCount ?? 0
        HStack(spacing: 4) {
          Image(systemName: n > 0 ? "play.fill" : "moon.zzz.fill").font(.system(size: 9, weight: .bold)).foregroundColor(n > 0 ? blue : .white.opacity(0.4))
          Text(n > 0 ? "\(n) lecture\(n > 1 ? "s" : "") en cours" : "Personne ne regarde").font(.system(size: 11, weight: .semibold)).foregroundColor(.white.opacity(n > 0 ? 0.85 : 0.45))
        }
      }
      Spacer(minLength: 0)
      HStack {
        MachineLine(m: st?.machine)
        Spacer()
        if let p = st?.pending, p > 0 {
          Text("\(p) à valider").font(.system(size: 10, weight: .bold)).foregroundColor(orange)
        }
      }
    }
  }

  // Moyen : une ligne UptimeRobot par service (nom, 24 barres, %)
  func medium(_ list: [Svc], _ allOk: Bool) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Header(entry: entry, allOk: allOk)
      ForEach(list, id: \.name) { s in
        HStack(spacing: 7) {
          StatusDot(ok: s.state?.ok ?? false, size: 7)
          Text(s.name).font(.system(size: 12, weight: .semibold)).foregroundColor(.white).lineLimit(1).frame(width: 56, alignment: .leading)
          Bars(bars: s.state?.bars ?? [], height: 11)
          Text(pct(s.state?.uptime)).font(.system(size: 10, weight: .bold).monospacedDigit()).foregroundColor(uptimeColor(s.state?.uptime)).frame(width: 40, alignment: .trailing)
        }
      }
      Spacer(minLength: 0)
      HStack {
        MachineLine(m: entry.status?.machine)
        Spacer()
        if let p = entry.status?.pending, p > 0 {
          Text("\(p) demande\(p > 1 ? "s" : "") à valider").font(.system(size: 10, weight: .bold)).foregroundColor(orange)
        }
      }
    }
  }

  // Grand : cartes UptimeRobot complètes + machine
  func large(_ list: [Svc], _ allOk: Bool) -> some View {
    let admin = entry.status?.seed != nil || entry.status?.watching != nil || entry.status?.watchingCount != nil
    return VStack(alignment: .leading, spacing: admin ? 6 : 8) {
      Header(entry: entry, allOk: allOk)
      HStack(spacing: 8) {
        Gauge2(label: "PROCESSEUR", value: entry.status?.machine?.cpu, unit: "%", warn: 60, bad: 85)
        Gauge2(label: "CHALEUR", value: entry.status?.machine?.temp, unit: "°C", warn: 65, bad: 80)
      }
      ForEach(list, id: \.name) { s in
        VStack(alignment: .leading, spacing: admin ? 3 : 4) {
          HStack(spacing: 6) {
            Image(systemName: s.symbol).font(.system(size: 11, weight: .semibold)).foregroundColor(.white.opacity(0.8)).frame(width: 14)
            Text(s.name).font(.system(size: 13, weight: .bold)).foregroundColor(.white)
            StatusDot(ok: s.state?.ok ?? false, size: 6)
            Spacer()
            if let q = s.state?.queue, q > 0 {
              Text("\(q) ⬇︎").font(.system(size: 10, weight: .bold)).foregroundColor(Color(red: 0.24, green: 0.55, blue: 1.0))
            }
            if let ms = s.state?.ms { Text("\(ms) ms").font(.system(size: 10).monospacedDigit()).foregroundColor(.white.opacity(0.45)) }
            Text(pct(s.state?.uptime)).font(.system(size: 11, weight: .bold).monospacedDigit()).foregroundColor(uptimeColor(s.state?.uptime))
          }
          Bars(bars: s.state?.bars ?? [], height: admin ? 9 : 15)
        }
        .padding(admin ? 6 : 8)
        .background(cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 10))
      }
      if let seed = entry.status?.seed {
        VStack(alignment: .leading, spacing: 3) {
          HStack {
            SeedLine(seed: seed, size: 12)
            Spacer(minLength: 2)
            if let t = seed.today { Text("+\(bytes(t)) aujourd’hui").font(.system(size: 10, weight: .bold).monospacedDigit()).foregroundColor(green) }
          }
          ForEach(Array((seed.top ?? []).prefix(2).enumerated()), id: \.offset) { _, t in
            HStack(spacing: 4) {
              Text(t.title).font(.system(size: 11, weight: .medium)).foregroundColor(.white.opacity(0.75)).lineLimit(1)
              Spacer(minLength: 2)
              Text("↑ \(speed(t.up)) · ratio \(String(format: "%.2f", t.ratio ?? 0))").font(.system(size: 10, weight: .semibold).monospacedDigit()).foregroundColor(.white.opacity(0.5))
            }
          }
        }
        .padding(6)
        .background(cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 10))
      }
      if admin {
        VStack(alignment: .leading, spacing: 3) {
          if let w = entry.status?.watching, !w.isEmpty {
            ForEach(Array(w.prefix(2).enumerated()), id: \.offset) { _, x in WatchLine(w: x, size: 12) }
          } else {
            let n = entry.status?.watchingCount ?? 0
        HStack(spacing: 4) {
          Image(systemName: n > 0 ? "play.fill" : "moon.zzz.fill").font(.system(size: 9, weight: .bold)).foregroundColor(n > 0 ? blue : .white.opacity(0.4))
          Text(n > 0 ? "\(n) lecture\(n > 1 ? "s" : "") en cours" : "Personne ne regarde en ce moment").font(.system(size: 11, weight: .semibold)).foregroundColor(.white.opacity(n > 0 ? 0.85 : 0.45))
        }
          }
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 10))
      }
      Spacer(minLength: 0)
      if !admin {
      HStack {
        Text("il y a 24 h").font(.system(size: 9)).foregroundColor(.white.opacity(0.4))
        Spacer()
        if let p = entry.status?.pending, p > 0 {
          Text("\(p) demande\(p > 1 ? "s" : "") à valider").font(.system(size: 10, weight: .bold)).foregroundColor(orange)
          Spacer()
        }
        Text("maintenant").font(.system(size: 9)).foregroundColor(.white.opacity(0.4))
      }
      }
    }
  }
}

private struct Gauge2: View {
  let label: String
  let value: Double?
  let unit: String
  let warn: Double
  let bad: Double
  var body: some View {
    let v = value ?? 0
    let c = v >= bad ? red : v >= warn ? orange : green
    VStack(alignment: .leading, spacing: 3) {
      Text(label).font(.system(size: 9, weight: .semibold)).foregroundColor(.white.opacity(0.55))
      Text(value == nil ? "—" : "\(Int(v)) \(unit)").font(.system(size: 18, weight: .heavy).monospacedDigit()).foregroundColor(c)
      GeometryReader { g in
        ZStack(alignment: .leading) {
          Capsule().fill(grey)
          Capsule().fill(c).frame(width: g.size.width * min(1, v / 100))
        }
      }
      .frame(height: 4)
    }
    .padding(8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(cardBg)
    .clipShape(RoundedRectangle(cornerRadius: 10))
  }
}

/// Fond du widget (API différente avant / après iOS 17).
private struct WidgetBackground: ViewModifier {
  var lockScreen = false
  func body(content: Content) -> some View {
    let bg = LinearGradient(colors: [Color(red: 0.05, green: 0.05, blue: 0.08), Color(red: 0.02, green: 0.02, blue: 0.04)], startPoint: .top, endPoint: .bottom)
    if lockScreen {
      // Écran verrouillé : iOS dessine lui-même le fond
      if #available(iOS 17.0, *) {
        content.containerBackground(for: .widget) { Color.clear }
      } else {
        content
      }
    } else if #available(iOS 17.0, *) {
      content.containerBackground(for: .widget) { bg }
    } else {
      content.padding().background(bg)
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
    .description("Disponibilité de Lumio, Jellyfin, qBittorrent et du VPN, la machine, le partage et qui regarde quoi.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryInline, .accessoryCircular, .accessoryRectangular])
  }
}
