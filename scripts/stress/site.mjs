/**
 * Local stress site: static pages from evals/stress/ plus dynamic routes that
 * real sites use and fixtures on file:// cannot — slow XHR, redirect chains,
 * server-side forms with sessions, and a new-tab target with a real URL.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)), "evals", "stress");

const REPO = fileURLToPath(new URL("../..", import.meta.url));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain" };

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui;max-width:900px;margin:24px auto;font-size:14px}</style></head><body>${body}</body></html>`;

const sessions = new Set();

export function startSite() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");

    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(body);
    };

    // Slow JSON: the page polls or awaits this to simulate real AJAX latency.
    if (url.pathname === "/api/slow") {
      const ms = Number(url.searchParams.get("ms") ?? 2000);
      await new Promise((r) => setTimeout(r, ms));

      return send(200, JSON.stringify({ ok: true, ms }), { "content-type": "application/json" });
    }

    // Redirect chain: /redirect/3 → /redirect/2 → /redirect/1 → /redirect-landing
    const chain = url.pathname.match(/^\/redirect\/(\d+)$/);

    if (chain) {
      const n = Number(chain[1]);
      await new Promise((r) => setTimeout(r, 150));

      return send(302, "", { location: n > 1 ? `/redirect/${n - 1}` : "/redirect-landing" });
    }

    if (url.pathname === "/redirect-landing") {
      return send(200, page("Landing", `<h1>Redirect landing</h1><p>You arrived after the chain.</p><a href="/redirect-final">Continue to the final page</a>`));
    }

    if (url.pathname === "/redirect-final") {
      return send(200, page("Final", `<h1>Final page</h1><p>DONE: final page reached</p>`));
    }

    // Server-side login with a cookie session.
    if (url.pathname === "/login" && req.method === "POST") {
      const body = await readBody(req);
      const params = new URLSearchParams(body);

      if (params.get("user") === "alice" && params.get("pass") === "s3cret") {
        const sid = Math.random().toString(36).slice(2);
        sessions.add(sid);

        return send(302, "", { location: "/dashboard", "set-cookie": `sid=${sid}; Path=/` });
      }

      return send(200, page("Login", loginForm("Invalid credentials")));
    }

    if (url.pathname === "/login") return send(200, page("Login", loginForm("")));

    if (url.pathname === "/dashboard") {
      const sid = (req.headers.cookie ?? "").match(/sid=(\w+)/)?.[1];

      if (!sid || !sessions.has(sid)) return send(302, "", { location: "/login" });

      return send(200, page("Dashboard", `<h1>Dashboard</h1><p>Welcome, alice.</p><nav><a href="/reports">Reports</a> <a href="/settings">Settings</a></nav>`));
    }

    if (url.pathname === "/reports") {
      return send(200, page("Reports", `<h1>Reports</h1><p>DONE: reports page</p><form method="post" action="/export"><label>Format <select name="fmt"><option>CSV</option><option>PDF</option></select></label><button>Export</button></form>`));
    }

    if (url.pathname === "/export" && req.method === "POST") {
      const params = new URLSearchParams(await readBody(req));

      return send(200, page("Exported", `<h1>Export queued</h1><p>DONE: export ${params.get("fmt")}</p>`));
    }

    // Form echo: the multi-field form posts here; the page shows every value.
    if (url.pathname === "/submit" && req.method === "POST") {
      const params = new URLSearchParams(await readBody(req));
      const rows = [...params].map(([k, v]) => `<li>${k}=${escapeHtml(v)}</li>`).join("");

      return send(200, page("Submitted", `<h1>Submitted</h1><ul>${rows}</ul><p>DONE: submitted</p>`));
    }

    // Slow HTML: server holds the response — the navigation itself is slow.
    if (url.pathname === "/slow-page") {
      await new Promise((r) => setTimeout(r, Number(url.searchParams.get("ms") ?? 3000)));

      return send(200, page("Slow page", `<h1>Slow page</h1><p>DONE: slow page loaded</p>`));
    }

    if (url.pathname === "/help") {
      return send(200, page("Help", `<h1>Help center</h1><p>DONE: help visible</p><a href="/help/faq">FAQ</a>`));
    }

    if (url.pathname === "/help/faq") return send(200, page("FAQ", `<h1>FAQ</h1><p>DONE: faq visible</p>`));

    // Static: evals/stress/*.html and the repo fixtures.
    let file = join(ROOT, url.pathname === "/" ? "index.html" : url.pathname.slice(1));

    if (!existsSync(file) && /^\/fixture(-interactions)?\.html$/.test(url.pathname)) {
      file = join(REPO, url.pathname.slice(1));
    }

    if (!file.startsWith(ROOT) && !file.startsWith(REPO)) return send(403, "forbidden");

    if (!existsSync(file)) return send(404, page("404", `<h1>Not found</h1>`));

    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function loginForm(error) {
  return `<h1>Sign in</h1>${error ? `<p style="color:#b00">${error}</p>` : ""}<form method="post" action="/login"><label>Username <input name="user" autocomplete="off"></label><br><label>Password <input type="password" name="pass"></label><br><button>Sign in</button></form>`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => resolve(data));
  });
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

if (import.meta.url === `file://${process.argv[1]}`) {
  const site = await startSite();
  console.log(`stress site on ${site.origin}`);
}
