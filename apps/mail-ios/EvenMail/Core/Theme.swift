import SwiftUI
import UIKit

/// The design tokens of `packages/ui/src/styles/globals.css`, light and dark,
/// so the phone shows the same colours as the web and desktop apps.
enum Theme {
    static let background = dynamic(light: oklch(1, 0, 0), dark: oklch(0.145, 0, 0))
    static let foreground = dynamic(light: oklch(0.145, 0, 0), dark: oklch(0.985, 0, 0))
    static let card = dynamic(light: oklch(1, 0, 0), dark: oklch(0.205, 0, 0))
    static let primary = dynamic(light: oklch(0.555, 0.163, 48.998), dark: oklch(0.473, 0.137, 46.201))
    /// Text and icons in the accent colour: the web's `text-primary`, lifted in the
    /// dark theme where the button colour is too dim to read as text.
    static let accentText = dynamic(light: oklch(0.555, 0.163, 48.998), dark: oklch(0.769, 0.188, 70.08))
    static let primaryForeground = dynamic(light: oklch(0.987, 0.022, 95.277), dark: oklch(0.987, 0.022, 95.277))
    static let muted = dynamic(light: oklch(0.97, 0, 0), dark: oklch(0.269, 0, 0))
    static let mutedForeground = dynamic(light: oklch(0.556, 0, 0), dark: oklch(0.708, 0, 0))
    static let accent = dynamic(light: oklch(0.97, 0, 0), dark: oklch(0.269, 0, 0))
    static let destructive = dynamic(light: oklch(0.577, 0.245, 27.325), dark: oklch(0.704, 0.191, 22.216))
    static let border = dynamic(light: oklch(0.922, 0, 0), dark: oklch(1, 0, 0, 0.10))
    static let input = dynamic(light: oklch(0.922, 0, 0), dark: oklch(1, 0, 0, 0.15))
    static let sidebar = dynamic(light: oklch(0.985, 0, 0), dark: oklch(0.205, 0, 0))
    /// A set star, in the colour mail apps use for it (the web's amber-500).
    static let starred = Color(red: 0.96, green: 0.62, blue: 0.04)

    /// `--radius`: 0.625rem.
    static let radius: CGFloat = 10

    /// Same lightness and strength, so no mailbox shouts louder than another
    /// (`apps/mail-web/src/components/account-dot.tsx`).
    static let accountColors: [Color] = [
        Color(oklch(0.66, 0.15, 250)), Color(oklch(0.76, 0.16, 75)), Color(oklch(0.68, 0.19, 355)),
        Color(oklch(0.69, 0.16, 155)), Color(oklch(0.64, 0.17, 300)), Color(oklch(0.72, 0.12, 200)),
        Color(oklch(0.63, 0.2, 28)), Color(oklch(0.65, 0.02, 260)),
    ]

    static func accountColor(_ index: Int) -> Color {
        accountColors[((index % accountColors.count) + accountColors.count) % accountColors.count]
    }

    /// A person's colour, from their address (`contact-avatar.tsx`).
    static func avatarColor(_ email: String) -> Color {
        var hash: UInt32 = 0
        for unit in email.lowercased().utf16 { hash = hash &* 31 &+ UInt32(unit) }
        return Color(oklch(0.6, 0.12, Double(hash % 360)))
    }

    private static func dynamic(light: UIColor, dark: UIColor) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}

/// CSS `oklch()` as an sRGB colour.
func oklch(_ lightness: Double, _ chroma: Double, _ hue: Double, _ alpha: Double = 1) -> UIColor {
    let radians = hue * .pi / 180
    let a = chroma * cos(radians)
    let b = chroma * sin(radians)
    let l = pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3)
    let m = pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3)
    let s = pow(lightness - 0.0894841775 * a - 1.2914855480 * b, 3)
    func gamma(_ value: Double) -> CGFloat {
        let clamped = min(max(value, 0), 1)
        return CGFloat(clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * pow(clamped, 1 / 2.4) - 0.055)
    }
    return UIColor(
        red: gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        green: gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        blue: gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
        alpha: alpha
    )
}

enum InterWeight: String {
    case regular = "Inter-Regular"
    case medium = "Inter-Medium"
    case semibold = "Inter-SemiBold"
    case bold = "Inter-Bold"
}

extension Font {
    /// Inter, the apps' typeface. Sizes follow the user's text size setting.
    static func inter(_ size: CGFloat, _ weight: InterWeight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(weight.rawValue, size: size, relativeTo: style)
    }
}

/// A Hugeicon by the name the web sources use without "Icon": `Icon("archive")`
/// is `ArchiveIcon`. All of them live in the asset catalog as `hi-<name>`.
struct Icon: View {
    let name: String
    var size: CGFloat = 20

    init(_ name: String, size: CGFloat = 20) {
        self.name = name
        self.size = size
    }

    var body: some View {
        Image("hi-\(name)")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The dot that tells mailboxes apart where several share a list.
struct AccountDot: View {
    let color: Int
    var size: CGFloat = 8

    var body: some View {
        Circle().fill(Theme.accountColor(color)).frame(width: size, height: size)
    }
}

/// Initials on a colour from the address. No pictures, as on the web.
struct ContactAvatar: View {
    let name: String?
    let email: String
    var size: CGFloat = 32

    private var initials: String {
        let words = (name ?? "").split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
        let picked: [String] = words.count > 1 ? [words[0], words[words.count - 1]] : words.count == 1 ? [words[0]] : [email]
        return picked.compactMap { $0.first.map(String.init) }.joined().uppercased()
    }

    var body: some View {
        Text(initials)
            .font(.inter(size * 0.4, .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Theme.avatarColor(email), in: Circle())
            .accessibilityHidden(true)
    }
}
