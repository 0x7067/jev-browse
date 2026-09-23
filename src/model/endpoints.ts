export function warmModelEndpoints(decisionBaseURL: string): void {
  const origins = new Set<string>();

  for (const raw of [decisionBaseURL, process.env.TEXT_MODEL_BASE_URL]) {
    try {
      if (raw) origins.add(new URL(raw).origin);
    } catch {
    }
  }

  for (const origin of origins) {
    fetch(origin, { method: "HEAD" })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  }
}
