import SwiftUI
import WebKit

/// Untrusted mail HTML made safe to show (`lib/email-html.ts`). The web cleans
/// it with DOMPurify and shows it in a sandboxed iframe; here the reader itself
/// is the sandbox: scripts are off for the page, the policy below blocks every
/// load but inline styles and (when allowed) pictures, nothing is kept between
/// messages, and the only navigation that ever happens is a tapped link, which
/// opens in the browser.
enum EmailDocument {
    private static func removing(_ pattern: String, from html: String) -> String {
        html.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
    }

    /// Drops what could run, redirect or loosen the policy. A second line of
    /// defence: the reader refuses all of it anyway.
    static func clean(_ html: String) -> String {
        var cleaned = removing(#"<script\b[^>]*>[\s\S]*?</script\s*>"#, from: html)
        cleaned = removing(#"<(script|meta|base|link|iframe|frame|object|embed|form|input|button|textarea|select)\b[^>]*>"#, from: cleaned)
        cleaned = removing(#"</(script|iframe|frame|object|embed|form|button|textarea|select)\s*>"#, from: cleaned)
        return removing(#"\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#, from: cleaned)
    }

    static func hasRemoteImages(_ html: String) -> Bool {
        html.range(of: #"<img[^>]+src=["']?https?:|url\(\s*["']?https?:"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Whether the mail paints its own backgrounds (a newsletter, an invoice).
    /// Those keep their look on white paper in dark mode; plain mail follows the theme.
    static func hasOwnBackground(_ html: String) -> Bool {
        if html.range(of: #"background-image\s*:"#, options: [.regularExpression, .caseInsensitive]) != nil { return true }
        let plain = #"^(none|transparent|inherit|initial|unset|white|#fff|#ffffff|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*1(\.0*)?\s*)?\))$"#
        let patterns = [#"\bbgcolor\s*=\s*["']?([^"'\s>]+)"#, #"background(?:-color)?\s*:\s*([^;"'}]+)"#]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { continue }
            let text = html as NSString
            for match in regex.matches(in: html, range: NSRange(location: 0, length: text.length)) where match.numberOfRanges > 1 {
                let value = text.substring(with: match.range(at: 1))
                    .replacingOccurrences(of: "!important", with: "", options: .caseInsensitive)
                    .trimmingCharacters(in: .whitespaces)
                if value.range(of: plain, options: [.regularExpression, .caseInsensitive]) == nil { return true }
            }
        }
        return false
    }

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    /// The page the reader shows. `paper` keeps designed mail on white in the
    /// dark theme; plain mail takes the app's own colours.
    static func build(html: String, allowImages: Bool, dark: Bool) -> (document: String, paper: Bool) {
        let paper = hasOwnBackground(html)
        let policy = [
            "default-src 'none'",
            "style-src 'unsafe-inline'",
            "img-src data:\(allowImages ? " https:" : "")",
            "font-src data:",
            "form-action 'none'",
            "base-uri 'none'",
        ].joined(separator: "; ")
        var style = [
            "html,body{margin:0;height:auto!important;min-height:0!important;-webkit-text-size-adjust:100%}",
            "body{padding:0;font:16px/1.5 -apple-system,system-ui,sans-serif;overflow-wrap:anywhere;color:#111;background:\(paper ? "#fff" : "transparent")}",
            paper ? "body{padding:12px}" : "",
            "img{max-width:100%;height:auto}",
            "pre{white-space:pre-wrap;font:inherit;margin:0}",
            "a{color:#b4530f}",
        ].joined()
        if dark, !paper {
            style += [
                ":root{color-scheme:dark}",
                "html,body{background:transparent!important;color:#e4e4e1!important}",
                "#evido-mail *{color:inherit!important;background-color:transparent!important;border-color:rgba(255,255,255,.14)!important}",
                "#evido-mail a,#evido-mail a *{color:#8fb3ff!important}",
            ].joined()
        }
        let document = "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"\(policy)\"><meta name=\"referrer\" content=\"no-referrer\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>\(style)</style></head><body><div id=\"evido-mail\">\(html)</div></body></html>"
        return (document, paper)
    }
}

/// A message's body, as tall as its content so the conversation scrolls as one.
struct EmailBody: View {
    let html: String
    let allowImages: Bool

    @Environment(\.colorScheme) private var colorScheme
    @State private var height: CGFloat = 44

    var body: some View {
        let built = EmailDocument.build(html: html, allowImages: allowImages, dark: colorScheme == .dark)
        EmailWebView(document: built.document, height: $height)
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: built.paper ? Theme.radius : 0, style: .continuous))
    }
}

private struct EmailWebView: UIViewRepresentable {
    let document: String
    @Binding var height: CGFloat

    func makeCoordinator() -> Coordinator { Coordinator(height: $height) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Nothing a message loads or sets outlives it.
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.allowsInlineMediaPlayback = false
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 1), configuration: configuration)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        web.navigationDelegate = context.coordinator
        context.coordinator.observe(web)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        guard context.coordinator.shown != document else { return }
        context.coordinator.shown = document
        context.coordinator.loading = true
        web.loadHTMLString(document, baseURL: nil)
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        coordinator.observation = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var height: CGFloat
        var shown: String?
        var loading = false
        var observation: NSKeyValueObservation?

        init(height: Binding<CGFloat>) {
            _height = height
        }

        func observe(_ web: WKWebView) {
            observation = web.scrollView.observe(\.contentSize, options: [.new]) { [weak self] _, change in
                guard let self, let size = change.newValue else { return }
                let next = max(24, ceil(size.height))
                guard abs(next - self.height) > 0.5 else { return }
                DispatchQueue.main.async { self.height = next }
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // The page itself, once: the document handed over above.
            if loading, action.navigationType == .other, action.targetFrame?.isMainFrame == true, action.request.url?.absoluteString == "about:blank" {
                decisionHandler(.allow)
                return
            }
            // A tapped link leaves for the browser; anything else a mail tries goes nowhere.
            if action.navigationType == .linkActivated, let url = action.request.url, ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            loading = false
        }
    }
}
