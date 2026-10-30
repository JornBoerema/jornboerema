/** Run work after responding. Failures are logged, never surfaced to the client. */
export function defer(work: () => Promise<unknown>) {
  void work().catch((error) => console.error("Achtergrondtaak mislukt", error))
}
