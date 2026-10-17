import SwiftUI

enum Theme {
    static let accent = Color(hex: "#3D8BFF")
    static let surface = Color(hex: "#121212")
    static let surfaceHigh = Color(hex: "#1C1C1E")
    static let dim = Color(hex: "#A1A1A6")
    static let gold = Color(hex: "#FFC93C")
}

extension Color {
    init(hex: String) {
        let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        self.init(
            .sRGB,
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension View {
    /// Effet verre d'iOS 26 / macOS 26 quand il existe, sinon matériau flou classique.
    @ViewBuilder
    func glassCard(cornerRadius: CGFloat = 16) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            self.glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
        } else {
            self.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
        }
    }
}
