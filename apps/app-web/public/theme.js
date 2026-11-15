// Applies the saved theme before first paint. Mirrors @even/ui/lib/theme.
// A file, not an inline script, so the Content-Security-Policy can stay script-src 'self'.
;(function () {
  try {
    // Settings saved under the old name (evido.*) move to even.* once.
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var k = localStorage.key(i)
      if (k && k.indexOf("evido.") === 0) {
        if (localStorage.getItem("even." + k.slice(6)) === null) localStorage.setItem("even." + k.slice(6), localStorage.getItem(k))
        localStorage.removeItem(k)
      }
    }
    var t = localStorage.getItem("even.theme")
    var d = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
    document.documentElement.classList.add(d ? "dark" : "light")
    document.documentElement.style.colorScheme = d ? "dark" : "light"
  } catch (e) {}
})()
