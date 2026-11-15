// Counts this page view for the visitor statistics in the Even admin.
// No cookies; see /privacy. Nothing is sent from localhost unless asked.
;(function () {
  try {
    if (navigator.webdriver) return
    var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    var api = local ? "http://localhost:4000" : "https://api.jornboerema.nl"
    var params = new URLSearchParams(location.search)
    var body = JSON.stringify({
      site: "home",
      path: location.pathname,
      referrer: document.referrer,
      source: params.get("utm_source") || params.get("ref") || "",
    })
    var url = api + "/api/stats/hit"
    if (navigator.sendBeacon) navigator.sendBeacon(url, body)
    else fetch(url, { method: "POST", body: body, keepalive: true, mode: "no-cors" })
  } catch (e) {}
})()
