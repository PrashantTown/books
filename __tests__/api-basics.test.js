// Behaviour of the app shell itself: unknown routes, bad JSON, headers and
// the rate limiter. No database needed.
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret_key";
const createApp = require("../src/app");
const rateLimit = require("../src/middleware/rateLimit");

describe("App shell", () => {
  const app = createApp();

  test("unknown routes answer with JSON 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test("malformed JSON is a 400, not a crash", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not valid JSON/);
  });

  test("protective headers are set", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("CORS only allows the configured origins when CORS_ORIGINS is set", async () => {
    process.env.CORS_ORIGINS = "https://parents-go-to.vercel.app";
    const locked = createApp();
    const ok = await request(locked).get("/api/health").set("Origin", "https://parents-go-to.vercel.app");
    const no = await request(locked).get("/api/health").set("Origin", "https://evil.example");
    delete process.env.CORS_ORIGINS;
    expect(ok.headers["access-control-allow-origin"]).toBe("https://parents-go-to.vercel.app");
    expect(no.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("Rate limiter", () => {
  test("allows up to the limit, then answers 429 with Retry-After", async () => {
    const app = express();
    app.get("/x", rateLimit({ windowMs: 60000, max: 2, enabledInTests: true }), (req, res) => res.json({ ok: true }));
    expect((await request(app).get("/x")).status).toBe(200);
    expect((await request(app).get("/x")).status).toBe(200);
    const third = await request(app).get("/x");
    expect(third.status).toBe(429);
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
  });

  test("limits can be raised from the environment", () => {
    process.env.RATE_LIMIT_TEST = "123";
    expect(rateLimit.limitFromEnv("RATE_LIMIT_TEST", 5)).toBe(123);
    expect(rateLimit.limitFromEnv("RATE_LIMIT_MISSING", 5)).toBe(5);
    delete process.env.RATE_LIMIT_TEST;
  });
});
