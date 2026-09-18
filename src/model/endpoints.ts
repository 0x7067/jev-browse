/**
 * Pre-establish TLS/HTTP2 to the model endpoints while the browser still
 * launches and navigates — the first real request then skips the handshake.
 * Fire-and-forget; failures are irrelevant.
 */
export function warmModelEndpoints(): void {
  const origins = new Set<string>();

  for (const raw of [
    process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai",
    process.env.TEXT_MODEL_BASE_URL,
  ]) {
    try {
      if (raw) origins.add(new URL(raw).origin);
    } catch {
      // unparseable env — the real request will surface it
    }
  }

  for (const origin of origins) {
    fetch(origin, { method: "HEAD" })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  }
}
