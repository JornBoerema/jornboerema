import AuthenticationServices
import CryptoKit
import Foundation
import Network
import Security
import UIKit

/// The session token, kept in the keychain of this device only.
enum Keychain {
    private static let service = "nl.jornboerema.even.mail"
    private static let account = "session-token"
    /// A token handed in for a test run; never written to the keychain.
    private static let injected = ProcessInfo.processInfo.environment["EVEN_TOKEN"]
    private static var cached: String?

    static var token: String? {
        if let injected, !injected.isEmpty { return injected }
        if let cached { return cached }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        cached = String(data: data, encoding: .utf8)
        return cached
    }

    static func store(_ token: String?) {
        cached = token
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard let token else { return }
        var item = query
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(item as CFDictionary, nil)
    }
}

/// Who is signed in on this device.
@Observable
@MainActor
final class Session {
    enum State: Equatable {
        case loading
        case signedOut
        case signedIn(SessionUser)
    }

    var state: State = .loading
    var signingIn = false
    var error: String?

    private var flow: BrowserSignIn?
    private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(forName: .signedOut, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.forget() }
        }
    }

    private struct Current: Decodable {
        let user: SessionUser
    }

    /// Asks the API who the stored token belongs to.
    func restore() async {
        if Demo.enabled {
            state = .signedIn(Demo.user)
            return
        }
        guard Keychain.token != nil else {
            state = .signedOut
            return
        }
        do {
            // Better Auth answers `null` for a session it no longer knows.
            let current: Current? = try await API.get("/api/auth/get-session")
            if let current { state = .signedIn(current.user) } else { forget() }
        } catch let failure as APIError where failure.status == 401 || failure.status == 403 {
            forget()
        } catch {
            // Offline or a passing fault: the token stays, and the screen offers to try again.
            self.error = errorText(error)
            state = .signedOut
        }
    }

    /// Signs in through the account site in the browser, as the desktop app does.
    func signIn() async {
        guard !signingIn else { return }
        signingIn = true
        error = nil
        defer { signingIn = false; flow = nil }
        do {
            let flow = BrowserSignIn()
            self.flow = flow
            let user = try await flow.run()
            state = .signedIn(user)
        } catch is CancellationError {
            // Closed the browser: nothing to say.
        } catch {
            self.error = errorText(error)
        }
    }

    func signOut() async {
        try? await API.run("/api/auth/sign-out")
        forget()
    }

    private func forget() {
        Keychain.store(nil)
        state = .signedOut
    }
}

/// The browser sign-in of `packages/auth/src/desktop-sign-in.ts`: the account
/// site, already signed in or signing in there, hands a one-time code to this
/// app on 127.0.0.1, and the app trades code and PKCE verifier for a session of
/// its own. Every sign-in method the account site gains works here unchanged.
@MainActor
final class BrowserSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let verifier = BrowserSignIn.random(48)
    private let state = BrowserSignIn.random(24)
    private var listener: NWListener?
    private var web: ASWebAuthenticationSession?

    func run() async throws -> SessionUser {
        defer { listener?.cancel() }
        let port = try await listen()
        let query = try await browse(port: port)
        let params = Dictionary(uniqueKeysWithValues: (URLComponents(string: "?\(query)")?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        guard params["state"] == state, let code = params["code"], !code.isEmpty else {
            throw APIError(message: t("Signing in failed. Try again.", "Inloggen is mislukt. Probeer het opnieuw."), status: 0)
        }
        return try await exchange(code: code)
    }

    private var answered: ((Result<String, Error>) -> Void)?

    /// Opens a loopback port and answers with the port it got.
    private func listen() async throws -> UInt16 {
        let parameters = NWParameters.tcp
        parameters.requiredInterfaceType = .loopback
        parameters.allowLocalEndpointReuse = true
        let listener = try NWListener(using: parameters)
        self.listener = listener
        listener.newConnectionHandler = { [weak self] connection in
            connection.start(queue: .main)
            connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
                let request = String(data: data ?? Data(), encoding: .utf8) ?? ""
                // "GET /callback?code=…&state=… HTTP/1.1"
                let target = request.split(separator: " ").dropFirst().first.map(String.init) ?? ""
                let query = target.hasPrefix("/callback?") ? String(target.dropFirst("/callback?".count)) : nil
                let done = "\(API.authURL.absoluteString)/desktop/done"
                let response = query == nil
                    ? "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    : "HTTP/1.1 302 Found\r\nLocation: \(done)\r\nCache-Control: no-store\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
                if let query {
                    Task { @MainActor in self?.finish(.success(query)) }
                }
            }
        }
        return try await withCheckedThrowingContinuation { continuation in
            var resumed = false
            listener.stateUpdateHandler = { state in
                guard !resumed else { return }
                switch state {
                case .ready:
                    resumed = true
                    if let port = listener.port?.rawValue { continuation.resume(returning: port) }
                    else { continuation.resume(throwing: APIError(message: "No port", status: 0)) }
                case .failed(let error):
                    resumed = true
                    continuation.resume(throwing: error)
                default:
                    break
                }
            }
            listener.start(queue: .main)
        }
    }

    /// Shows the account site and waits for the code to arrive on the port.
    private func browse(port: UInt16) async throws -> String {
        var components = URLComponents(url: API.authURL.appendingPathComponent("desktop"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "port", value: String(port)),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "challenge", value: BrowserSignIn.challenge(for: verifier)),
        ]
        return try await withCheckedThrowingContinuation { continuation in
            answered = { result in continuation.resume(with: result) }
            // The code comes in on the port, never through this scheme; closing
            // the sheet by hand is the only thing reported here.
            let web = ASWebAuthenticationSession(url: components.url!, callback: .customScheme("evenmail")) { [weak self] _, _ in
                Task { @MainActor in self?.finish(.failure(CancellationError())) }
            }
            web.presentationContextProvider = self
            // Shares Safari's session, so someone already signed in only confirms.
            web.prefersEphemeralWebBrowserSession = false
            self.web = web
            if !web.start() { finish(.failure(APIError(message: t("Could not open the browser", "De browser openen lukte niet"), status: 0))) }
        }
    }

    private func finish(_ result: Result<String, Error>) {
        guard let answered else { return }
        self.answered = nil
        if case .success = result { web?.cancel() }
        web = nil
        answered(result)
    }

    private struct Exchange: Encodable {
        let code: String
        let verifier: String
    }

    private struct Exchanged: Decodable {
        let user: SessionUser
    }

    private func exchange(code: String) async throws -> SessionUser {
        let request = API.request("/api/auth/desktop/token", method: "POST", body: Exchange(code: code, verifier: verifier), token: nil)
        let (data, response) = try await API.send(request)
        guard let token = response.value(forHTTPHeaderField: "set-auth-token"), !token.isEmpty else {
            throw APIError(message: t("Signing in failed. Try again.", "Inloggen is mislukt. Probeer het opnieuw."), status: 0)
        }
        Keychain.store(token)
        return try API.decoder.decode(Exchanged.self, from: data).user
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }

    /// PKCE values: unreserved characters only.
    private static func random(_ bytes: Int) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return base64Url(data)
    }

    private static func challenge(for verifier: String) -> String {
        base64Url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func base64Url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
