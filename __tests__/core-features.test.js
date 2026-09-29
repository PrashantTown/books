const mongoose = require("mongoose");
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");

const User = require("../src/models/User");
const Book = require("../src/models/Book");
const Child = require("../src/models/Child");
const Review = require("../src/models/Review");
const Wishlist = require("../src/models/Wishlist");
const authRoutes = require("../src/routes/auth.routes");
const adminRoutes = require("../src/routes/admin.routes");
const bookRoutes = require("../src/routes/bookRoutes");
const childrenRoutes = require("../src/routes/children.routes");
const wishlistRoutes = require("../src/routes/wishlistRoutes");
const reviewRoutes = require("../src/routes/reviewRoutes");

dotenv.config();

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/children", childrenRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/reviews", reviewRoutes);

const password = "TestPass123!";
let testId;
let admin;
let parent;
let otherParent;
let student;
let otherStudent;
let adminToken;
let parentToken;
let otherParentToken;
let studentToken;
let otherStudentToken;
let activeBook;
let inactiveBook;
let child;

async function login(user) {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password });
  expect(response.status).toBe(200);
  return response.body.token;
}

beforeAll(async () => {
  testId = Date.now().toString();
  await mongoose.connect(process.env.MONGODB_URI);
  const hashedPassword = await bcrypt.hash(password, 10);

  admin = await User.create({ name: `Core Admin ${testId}`, email: `core.admin${testId}@test.com`, password: hashedPassword, role: "admin" });
  parent = await User.create({ name: `Core Parent ${testId}`, email: `core.parent${testId}@test.com`, password: hashedPassword, role: "parent" });
  otherParent = await User.create({ name: `Other Parent ${testId}`, email: `core.otherparent${testId}@test.com`, password: hashedPassword, role: "parent" });
  student = await User.create({ name: `Core Student ${testId}`, email: `core.student${testId}@test.com`, password: hashedPassword, role: "student", parentId: parent._id });
  otherStudent = await User.create({ name: `Other Student ${testId}`, email: `core.otherstudent${testId}@test.com`, password: hashedPassword, role: "student", parentId: otherParent._id });

  child = await Child.create({ name: `Core Child ${testId}`, age: 8, band: "A", parent: parent._id, student: student._id });
  activeBook = await Book.create({ title: `Core Active ${testId}`, author: "Author", category: "Adventure", ageGroup: "6-8", createdBy: admin._id, status: "active" });
  inactiveBook = await Book.create({ title: `Core Inactive ${testId}`, author: "Author", category: "Fantasy", ageGroup: "9-12", createdBy: admin._id, status: "archived" });

  adminToken = await login(admin);
  parentToken = await login(parent);
  otherParentToken = await login(otherParent);
  studentToken = await login(student);
  otherStudentToken = await login(otherStudent);
}, 30000);

afterAll(async () => {
  const userIds = [admin?._id, parent?._id, otherParent?._id, student?._id, otherStudent?._id];
  await Promise.all([
    Review.deleteMany({ studentId: { $in: userIds } }),
    Wishlist.deleteMany({ studentId: { $in: userIds } }),
    Child.deleteMany({ _id: child?._id }),
    Book.deleteMany({ _id: { $in: [activeBook?._id, inactiveBook?._id] } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await mongoose.connection.close();
}, 30000);

describe("Authentication and admin", () => {
  test("registers, rejects duplicate, reads /me, and logs out", async () => {
    const email = `new.user${testId}@test.com`;
    const registered = await request(app).post("/api/auth/register").send({ name: "New User", email, password });
    expect(registered.status).toBe(201);
    expect(registered.body.user).not.toHaveProperty("password");
    expect((await request(app).post("/api/auth/register").send({ name: "New User", email, password })).status).toBe(409);
    const token = registered.body.token;
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    await User.deleteOne({ email });
  });

  test("rejects invalid credentials and protected requests without or with invalid token", async () => {
    expect((await request(app).post("/api/auth/login").send({ email: parent.email, password: "wrong" })).status).toBe(401);
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer invalid")).status).toBe(401);
  });

  test("allows admin routes only to admins", async () => {
    expect((await request(app).get("/api/admin/test").set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get("/api/admin/test").set("Authorization", `Bearer ${parentToken}`)).status).toBe(403);
    expect((await request(app).get("/api/admin/test").set("Authorization", `Bearer ${studentToken}`)).status).toBe(403);
  });
});

describe("Books", () => {
  test("lists, searches, filters, paginates, and gets active books", async () => {
    const list = await request(app).get("/api/books?search=Core&category=Adventure&ageGroup=6-8&page=1&limit=1&sort=title").set("Authorization", `Bearer ${parentToken}`);
    expect(list.status).toBe(200);
    expect(list.body.pagination.limit).toBe(1);
    expect(list.body.books.some(book => book._id === activeBook._id.toString())).toBe(true);
    expect((await request(app).get(`/api/books/${activeBook._id}`).set("Authorization", `Bearer ${studentToken}`)).status).toBe(200);
    expect((await request(app).get(`/api/books/${inactiveBook._id}`).set("Authorization", `Bearer ${studentToken}`)).status).toBe(404);
    expect((await request(app).get("/api/books/not-an-id").set("Authorization", `Bearer ${studentToken}`)).status).toBe(400);
  });

  test("admin creates, updates, deactivates, activates, and archives books", async () => {
    const created = await request(app).post("/api/books").set("Authorization", `Bearer ${adminToken}`).send({ title: `Created ${testId}`, author: "Author", category: "Educational", ageGroup: "6-8" });
    expect(created.status).toBe(201);
    const id = created.body.book._id;
    expect((await request(app).put(`/api/books/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Updated" })).status).toBe(200);
    expect((await request(app).patch(`/api/books/${id}/deactivate`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).patch(`/api/books/${id}/activate`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).delete(`/api/books/${id}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).post("/api/books").set("Authorization", `Bearer ${parentToken}`).send({ title: "No", author: "No", category: "Adventure", ageGroup: "6-8" })).status).toBe(403);
    expect((await request(app).post("/api/books").set("Authorization", `Bearer ${adminToken}`).send({ title: "", author: "No", category: "Adventure", ageGroup: "6-8" })).status).toBe(400);
  });
});

describe("Children, wishlist, and reviews", () => {
  test("auto-links a student user when a parent creates a child without a studentId", async () => {
    const created = await request(app)
      .post("/api/children")
      .set("Authorization", `Bearer ${parentToken}`)
      .send({
        name: `Auto Child ${testId}`,
        age: 6,
        band: "5-7",
        colour: "#B3402G",
        likes: ["picture"],
      });

    expect(created.status).toBe(201);
    expect(created.body.child.student).toBeTruthy();
    expect(created.body.child.parent).toBe(parent._id.toString());

    const childRecord = await Child.findById(created.body.child._id);
    expect(childRecord).toBeTruthy();
    expect(childRecord.parent.toString()).toBe(parent._id.toString());
    expect(childRecord.student).toBeTruthy();

    const linkedStudent = await User.findById(childRecord.student);
    expect(linkedStudent).toBeTruthy();
    expect(linkedStudent.role).toBe("student");
    expect(linkedStudent.parentId.toString()).toBe(parent._id.toString());
    expect(await Child.countDocuments({ student: linkedStudent._id })).toBe(1);
  });

  test("enforces parent child ownership and role restrictions", async () => {
    const created = await request(app).post("/api/children").set("Authorization", `Bearer ${parentToken}`).send({ name: `New Child ${testId}`, age: 5, band: "A" });
    expect(created.status).toBe(201);
    const id = created.body.child._id;
    expect((await request(app).get("/api/children").set("Authorization", `Bearer ${parentToken}`)).status).toBe(200);
    expect((await request(app).get(`/api/children/${id}`).set("Authorization", `Bearer ${otherParentToken}`)).status).toBe(403);
    expect((await request(app).get(`/api/children/${id}`).set("Authorization", `Bearer ${studentToken}`)).status).toBe(403);
    expect((await request(app).put(`/api/children/${id}`).set("Authorization", `Bearer ${parentToken}`).send({ age: 6 })).status).toBe(200);
    expect((await request(app).delete(`/api/children/${id}`).set("Authorization", `Bearer ${parentToken}`)).status).toBe(200);
  });

  test("supports student wishlist lifecycle and restrictions", async () => {
    expect((await request(app).post(`/api/wishlist/${activeBook._id}`).set("Authorization", `Bearer ${studentToken}`)).status).toBe(201);
    expect((await request(app).post(`/api/wishlist/${activeBook._id}`).set("Authorization", `Bearer ${studentToken}`)).status).toBe(409);
    expect((await request(app).get("/api/wishlist").set("Authorization", `Bearer ${studentToken}`)).status).toBe(200);
    expect((await request(app).get(`/api/wishlist/${activeBook._id}/status`).set("Authorization", `Bearer ${studentToken}`)).status).toBe(200);
    expect((await request(app).post(`/api/wishlist/${activeBook._id}`).set("Authorization", `Bearer ${parentToken}`)).status).toBe(403);
    expect((await request(app).delete(`/api/wishlist/${activeBook._id}`).set("Authorization", `Bearer ${studentToken}`)).status).toBe(200);
  });

  test("supports review lifecycle, summary, duplicate, validation, and ownership", async () => {
    const created = await request(app).post(`/api/reviews/${activeBook._id}`).set("Authorization", `Bearer ${studentToken}`).send({ rating: 5, comment: "Good" });
    expect(created.status).toBe(201);
    const id = created.body.review._id;
    expect((await request(app).post(`/api/reviews/${activeBook._id}`).set("Authorization", `Bearer ${studentToken}`).send({ rating: 5 })).status).toBe(409);
    expect((await request(app).post(`/api/reviews/${inactiveBook._id}`).set("Authorization", `Bearer ${otherStudentToken}`).send({ rating: 0 })).status).toBe(400);
    expect((await request(app).get(`/api/reviews/book/${activeBook._id}`).set("Authorization", `Bearer ${parentToken}`)).status).toBe(200);
    expect((await request(app).get(`/api/reviews/book/${activeBook._id}/summary`).set("Authorization", `Bearer ${parentToken}`)).status).toBe(200);
    expect((await request(app).put(`/api/reviews/${id}`).set("Authorization", `Bearer ${otherStudentToken}`).send({ rating: 1 })).status).toBe(403);
    expect((await request(app).put(`/api/reviews/${id}`).set("Authorization", `Bearer ${studentToken}`).send({ rating: 4 })).status).toBe(200);
    expect((await request(app).delete(`/api/reviews/${id}`).set("Authorization", `Bearer ${studentToken}`)).status).toBe(200);
  });
});