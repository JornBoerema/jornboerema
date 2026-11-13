import Foundation

struct APIError: LocalizedError {
    let message: String
    let status: Int

    var errorDescription: String? { message }
}

extension Notification.Name {
    /// The API no longer knows the session: back to the sign-in screen.
    static let signedOut = Notification.Name("even.signedOut")
}

/// The Even API with the session token (`apps/mail-web/src/lib/api.ts`).
enum API {
    static let baseURL: URL = {
        let environment = ProcessInfo.processInfo.environment["EVEN_API_URL"]
        return URL(string: environment ?? "https://api.jornboerema.nl")!
    }()

    static let authURL: URL = {
        let environment = ProcessInfo.processInfo.environment["EVEN_AUTH_URL"]
        return URL(string: environment ?? "https://auth.jornboerema.nl")!
    }()

    /// Writes are refused without a known origin (the API's CSRF guard for
    /// cookies). A native app has none, so it names the Even app's, as the
    /// desktop apps do; the bearer token is what actually signs it in.
    private static let origin = "tauri://localhost"

    /// Test runs must never change the real account: with `EVEN_BLOCK_WRITES=1`
    /// everything but reading is answered locally as if it had worked.
    static let blocksWrites = ProcessInfo.processInfo.environment["EVEN_BLOCK_WRITES"] == "1"

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 60
        return URLSession(configuration: configuration)
    }()

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: text) ?? plain.date(from: text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a date: \(text)"))
        }
        return decoder
    }()

    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        return encoder
    }()

    struct Empty: Codable {}

    static func request(_ path: String, method: String = "GET", body: (any Encodable)? = nil, token: String? = Keychain.token) -> URLRequest {
        var request = URLRequest(url: URL(string: baseURL.absoluteString + path)!)
        request.httpMethod = method
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.setValue(Prefs.shared.languageCode, forHTTPHeaderField: "Accept-Language")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? encoder.encode(body)
        }
        return request
    }

    /// The raw answer; throws the API's own message when it refuses.
    static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if blocksWrites, request.httpMethod != "GET" {
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data("{}".utf8), response)
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError(message: t("No answer", "Geen antwoord"), status: 0) }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { NotificationCenter.default.post(name: .signedOut, object: nil) }
            let failure = try? JSONDecoder().decode(Failure.self, from: data)
            let fallback = HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw APIError(message: failure?.error ?? failure?.message ?? fallback, status: http.statusCode)
        }
        return (data, http)
    }

    private struct Failure: Decodable {
        let error: String?
        let message: String?
    }

    static func get<T: Decodable>(_ path: String) async throws -> T {
        let (data, _) = try await send(request(path))
        return try decoder.decode(T.self, from: data)
    }

    @discardableResult
    static func post<T: Decodable>(_ path: String, _ body: (any Encodable)? = nil, method: String = "POST") async throws -> T {
        let (data, _) = try await send(request(path, method: method, body: body ?? Empty()))
        return try decoder.decode(T.self, from: data)
    }

    /// A write whose answer doesn't matter.
    static func run(_ path: String, _ body: (any Encodable)? = nil, method: String = "POST") async throws {
        _ = try await send(request(path, method: method, body: body ?? Empty()))
    }

    /// Binary answers, such as attachments.
    static func bytes(_ path: String, _ body: any Encodable) async throws -> Data {
        var request = request(path, method: "POST", body: body)
        request.timeoutInterval = 120
        // Reading an attachment is a POST (ids outgrow a URL) but changes nothing.
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError(message: t("Could not download the file", "Bestand downloaden lukte niet"), status: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return data
    }
}

func errorText(_ error: Error) -> String {
    if let api = error as? APIError { return api.message }
    if (error as? URLError)?.code == .notConnectedToInternet { return t("No internet connection", "Geen internetverbinding") }
    return error.localizedDescription
}

extension String {
    /// For a value inside a query string.
    var queryEncoded: String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
    }
}
