// HTTP verification of the built Next.js server. No browser rendering is claimed.
const http = require("node:http");
const assert = require("node:assert/strict");
const next = require("next");
const app = next({
  dev: false,
  dir: process.cwd(),
  hostname: "127.0.0.1",
  port: 3123,
});
function request(path, method = "GET", data, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3123,
        path,
        method,
        headers: {
          ...(data ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () =>
          resolve({ status: res.statusCode, body, headers: res.headers }),
        );
      },
    );
    req.setTimeout(10000, () => req.destroy(new Error("HTTP check timeout")));
    req.on("error", reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}
(async () => {
  await app.prepare();
  const server = http.createServer(app.getRequestHandler());
  await new Promise((resolve) => server.listen(3123, "127.0.0.1", resolve));
  try {
    for (const route of [
      "/",
      "/discovery",
      "/leads",
      "/pipeline",
      "/campaigns",
      "/tasks",
      "/analytics",
      "/settings",
      "/automation",
    ]) {
      const result = await request(route);
      assert.equal(result.status, 200, route);
      assert.ok(result.body.includes("prospect"), route);
      assert.ok(
        result.body.includes("Loading your workspace"),
        route + " starts with loading state",
      );
      assert.ok(
        result.body.includes('aria-busy="true"'),
        route + " accessible loading state",
      );
      for (const sample of [
        "Acme Studio",
        "Sam Carter",
        "Bloom &amp; Wild Studio",
        "Oakwood Dental",
        "Demo workspace",
        "Sample history",
        "Reset demo data",
      ])
        assert.ok(
          !result.body.includes(sample),
          route + " never renders sample data: " + sample,
        );
      assert.equal(result.headers["x-content-type-options"], "nosniff");
      assert.match(result.body, /rel="icon"[^>]+href="\/icon\.svg/);
      console.log("PASS " + route);
    }
    const health = await request("/api/health");
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).service, "prospect-web");
    console.log("PASS health");
    const icon = await request("/icon.svg");
    assert.equal(icon.status, 200);
    assert.match(icon.headers["content-type"], /image\/svg\+xml/);
    assert.ok(icon.body.includes("#8156d1"));
    console.log("PASS branded favicon");
    for (const route of [
      "/api/workspace",
      "/api/leads?workspace=10000000-0000-4000-8000-000000000001",
    ]) {
      assert.equal((await request(route)).status, 401, route);
    }
    console.log("PASS workspace and leads authentication boundaries");
    const crossOriginLogin = await request(
      "/api/auth/login",
      "POST",
      {},
      { Origin: "https://evil.example" },
    );
    assert.equal(crossOriginLogin.status, 403);
    console.log("PASS cross-origin login rejected");
    const sameOriginAction = await request(
      "/api/actions",
      "POST",
      {},
      {
        Host: "localhost:3123",
        Origin: "http://localhost:3123",
      },
    );
    assert.equal(sameOriginAction.status, 400);
    assert.ok(!sameOriginAction.body.includes("Invalid request origin"));
    console.log(
      "PASS browser Host accepted with a different internal server origin",
    );
    const crossOriginAction = await request(
      "/api/actions",
      "POST",
      {},
      {
        Host: "localhost:3123",
        Origin: "https://evil.example",
      },
    );
    assert.equal(crossOriginAction.status, 403);
    assert.match(crossOriginAction.body, /Invalid request origin/);
    console.log("PASS cross-origin action rejected");
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const result = await request("/api/workspace");
      assert.equal(result.status, 503);
      assert.match(result.body, /Setup required/);
      console.log("PASS missing Supabase setup state");
    }
    const bad = await request("/api/unsubscribe?token=invalid", "POST", {});
    assert.equal(bad.status, 400);
    console.log("PASS invalid unsubscribe rejection");
    for (const route of ["/api/voice", "/api/webhooks/twilio"]) {
      const result = await request(route, "POST", {});
      assert.equal(result.status, 403, route);
      console.log("PASS signature rejection " + route);
    }
    const metaChallenge = await request(
      "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=invalid&hub.challenge=test",
    );
    assert.equal(metaChallenge.status, 403);
    console.log("PASS invalid Meta challenge rejection");
    if (!process.env.META_APP_SECRET) {
      const result = await request("/api/webhooks/whatsapp", "POST", {});
      assert.equal(result.status, 503);
      console.log("PASS missing Meta webhook setup state");
    }
    const automation = await request(
      "/api/automation?workspace=10000000-0000-4000-8000-000000000001",
    );
    assert.equal(automation.status, 401);
    console.log("PASS automation authentication boundary");
    if (!process.env.RESEND_WEBHOOK_SECRET) {
      const result = await request("/api/webhooks/resend", "POST", {});
      assert.equal(result.status, 503);
      console.log("PASS missing webhook setup state");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
