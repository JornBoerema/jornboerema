// Applies the saved theme before first paint. Mirrors @evido/ui/lib/theme.
// A file, not an inline script, so the Content-Security-Policy can stay script-src 'self'.
;(function () {
  try {
    var t = localStorage.getItem("evido.theme")
    var d = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
    document.documentElement.classList.add(d ? "dark" : "light")
    document.documentElement.style.colorScheme = d ? "dark" : "light"
  } catch (e) {}
})()
