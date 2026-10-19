/**
 * Shared setup for the API tests added with the frontend integration.
 * Builds the real Express app (src/app.js), connects to MONGODB_URI and
 * creates users with unique emails so test files can run side by side.
 */
const mongoose = require("mongoose");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");

dotenv.config();

const createApp = require("../../src/app");
const User = require("../../src/models/User");

const PASSWORD = "TestPass123!";

const harness = (label) => {
  const runId = `${label}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const app = createApp();
  const created = [];

  const email = (name) => `${name}.${runId}@test.com`.toLowerCase();

  const connect = async () => {
    if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI in .env to run the tests");
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_key";
    await mongoose.connect(process.env.MONGODB_URI);
  };

  const makeUser = async (name, role = "parent", extra = {}) => {
    const user = await User.create({
      name: `${name} ${runId}`,
      email: email(name),
      password: await bcrypt.hash(PASSWORD, 10),
      role,
      ...extra,
    });
    created.push(user._id);
    return user;
  };

  const login = async (user, password = PASSWORD) => {
    const res = await request(app).post("/api/auth/login").send({ email: user.email, password });
    if (res.status !== 200 || !res.body.token) {
      throw new Error(`Login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.token;
  };

  const as = (token) => ({
    get: (url) => request(app).get(url).set("Authorization", `Bearer ${token}`),
    post: (url, body) => request(app).post(url).set("Authorization", `Bearer ${token}`).send(body || {}),
    put: (url, body) => request(app).put(url).set("Authorization", `Bearer ${token}`).send(body || {}),
    patch: (url, body) => request(app).patch(url).set("Authorization", `Bearer ${token}`).send(body || {}),
    delete: (url, body) => request(app).delete(url).set("Authorization", `Bearer ${token}`).send(body || {}),
  });

  const track = (id) => created.push(id);

  const cleanup = async () => {
    const { deleteAccountAndData } = require("../../src/utils/accountCleanup");
    const users = await User.find({ $or: [{ _id: { $in: created } }, { email: new RegExp(`${runId}@test\\.com$`) }] });
    for (const user of users) await deleteAccountAndData(user);
    await mongoose.connection.close();
  };

  return { app, request: () => request(app), runId, email, connect, makeUser, login, as, track, cleanup, PASSWORD };
};

module.exports = { harness, PASSWORD };
