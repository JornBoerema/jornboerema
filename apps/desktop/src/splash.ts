/** Fades out the splash from index.html; once, when the first real screen is there. */
export function hideSplash() {
  const splash = document.getElementById("splash")
  if (!splash || splash.classList.contains("leaving")) return
  splash.classList.add("leaving")
  splash.addEventListener("transitionend", () => splash.remove(), { once: true })
  // No transition (reduced motion, hidden window): remove it anyway.
  setTimeout(() => splash.remove(), 400)
}
