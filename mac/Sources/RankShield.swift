// Écusson de rang (10 rangs), dessiné comme dans l'appli iPhone.
import SwiftUI

struct RankShield: View {
    let tier: Int
    var size: CGFloat = 28

    private struct Tier { let light: Color; let base: Color; let dark: Color; let inner: (Color, Color)?; let star: (Color, Color); let edge: Color }

    private static func c(_ hex: UInt32) -> Color {
        Color(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    private static let gold = (c(0xFFE58A), c(0xF4B52C), c(0xA8700F))
    private static let goldStar = (c(0xFFE27A), c(0xE89B12))
    private static let tiers: [Tier] = [
        Tier(light: c(0x8E5A34), base: c(0x6E4224), dark: c(0x3E2412), inner: nil, star: (c(0x7A4A28), c(0x4E2C16)), edge: c(0x2E190B)),
        Tier(light: c(0xC77A43), base: c(0xA65A26), dark: c(0x5E2F12), inner: nil, star: (c(0xB4642E), c(0x7A3C17)), edge: c(0x4A230B)),
        Tier(light: c(0xE3A79B), base: c(0xC27F73), dark: c(0x7E4A43), inner: nil, star: (c(0xD08F84), c(0x9A5F57)), edge: c(0x6A3C36)),
        Tier(light: c(0xC2CAD6), base: c(0x8E98A8), dark: c(0x4D5563), inner: nil, star: (c(0xA3ADBC), c(0x6B7484)), edge: c(0x3E4552)),
        Tier(light: c(0xE6EBF2), base: c(0xB3BBC8), dark: c(0x646C7A), inner: nil, star: (c(0xD2D8E1), c(0x8D96A5)), edge: c(0x555D6A)),
        Tier(light: gold.0, base: gold.1, dark: gold.2, inner: (c(0x5BA8FF), c(0x1F5FC4)), star: goldStar, edge: c(0x8A5A06)),
        Tier(light: gold.0, base: gold.1, dark: gold.2, inner: (c(0xF5A623), c(0xC26E08)), star: (c(0xFFF3BF), c(0xF7C23A)), edge: c(0x7A4E05)),
        Tier(light: gold.0, base: gold.1, dark: gold.2, inner: (c(0x8C63FF), c(0x4B25B8)), star: goldStar, edge: c(0x8A5A06)),
        Tier(light: gold.0, base: gold.1, dark: gold.2, inner: (c(0xA24DE0), c(0x5A1E99)), star: goldStar, edge: c(0x8A5A06)),
        Tier(light: gold.0, base: gold.1, dark: gold.2, inner: (c(0xFFA43A), c(0xE0610F)), star: goldStar, edge: c(0x8A5A06)),
    ]

    var body: some View {
        let t = Self.tiers[max(0, min(9, tier))]
        let k = size / 100
        ZStack {
            outer(k).fill(t.dark).offset(y: 3 * k)
            outer(k).fill(LinearGradient(colors: [t.light, t.base], startPoint: .top, endPoint: .bottom))
            outer(k).stroke(t.dark, lineWidth: 2 * k)
            inner(k).fill(LinearGradient(colors: t.inner.map { [$0.0, $0.1] } ?? [t.base, t.dark], startPoint: .top, endPoint: .bottom))
            star(k, 50, 57, 25, 10.5).fill(t.edge).offset(y: 2.5 * k)
            star(k, 50, 57, 25, 10.5).fill(LinearGradient(colors: [t.star.0, t.star.1], startPoint: .top, endPoint: .bottom))
            star(k, 50, 57, 13, 5.5).fill(Color.white.opacity(0.18))
        }
        .frame(width: size, height: size * 1.1)
    }

    private func outer(_ k: CGFloat) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 18 * k, y: 6 * k))
        p.addLine(to: CGPoint(x: 82 * k, y: 6 * k))
        p.addLine(to: CGPoint(x: 94 * k, y: 18 * k))
        p.addLine(to: CGPoint(x: 94 * k, y: 60 * k))
        p.addCurve(to: CGPoint(x: 50 * k, y: 106 * k), control1: CGPoint(x: 94 * k, y: 78 * k), control2: CGPoint(x: 74 * k, y: 94 * k))
        p.addCurve(to: CGPoint(x: 6 * k, y: 60 * k), control1: CGPoint(x: 26 * k, y: 94 * k), control2: CGPoint(x: 6 * k, y: 78 * k))
        p.addLine(to: CGPoint(x: 6 * k, y: 18 * k))
        p.closeSubpath()
        return p
    }

    private func inner(_ k: CGFloat) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 23 * k, y: 15 * k))
        p.addLine(to: CGPoint(x: 77 * k, y: 15 * k))
        p.addLine(to: CGPoint(x: 85 * k, y: 23 * k))
        p.addLine(to: CGPoint(x: 85 * k, y: 59 * k))
        p.addCurve(to: CGPoint(x: 50 * k, y: 96 * k), control1: CGPoint(x: 85 * k, y: 73 * k), control2: CGPoint(x: 69 * k, y: 86 * k))
        p.addCurve(to: CGPoint(x: 15 * k, y: 59 * k), control1: CGPoint(x: 31 * k, y: 86 * k), control2: CGPoint(x: 15 * k, y: 73 * k))
        p.addLine(to: CGPoint(x: 15 * k, y: 23 * k))
        p.closeSubpath()
        return p
    }

    private func star(_ k: CGFloat, _ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, _ ri: CGFloat) -> Path {
        var p = Path()
        for i in 0..<10 {
            let a = -Double.pi / 2 + Double(i) * Double.pi / 5
            let rr = i % 2 == 0 ? r : ri
            let pt = CGPoint(x: (cx + rr * CGFloat(cos(a))) * k, y: (cy + rr * CGFloat(sin(a))) * k)
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        p.closeSubpath()
        return p
    }
}
