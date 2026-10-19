const mongoose = require('mongoose');
const request = require('supertest');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

// Models
const User = require('../src/models/User');
const Child = require('../src/models/Child');
const Book = require('../src/models/Book');
const ParentalControl = require('../src/models/ParentalControl');
const ReadingSession = require('../src/models/ReadingSession');

// The server files sessions under its local date, so the tests must too.
const { todayKey } = require('../src/utils/readingAccess');

// Routes
const authRoutes = require('../src/routes/auth.routes');
const childrenRoutes = require('../src/routes/children.routes');
const bookRoutes = require('../src/routes/bookRoutes');
const parentalControlRoutes = require('../src/routes/parentalControl.routes');
const readingSessionRoutes = require('../src/routes/readingSession.routes');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/children', childrenRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/parental-controls', parentalControlRoutes);
app.use('/api/reading-sessions', readingSessionRoutes);

// Test data storage
let testAdmin, testParentA, testParentB, testStudentA, testStudentB;
let testChildA, testChildB;
let testActiveBook, testInactiveBook;
let testControlA;
let adminToken, parentTokenA, parentTokenB, studentTokenA, studentTokenB;
let testId;

// Helper to generate tokens
const generateToken = async (user) => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: user.email,
      password: 'TestPass123!',
    });

  if (res.status !== 200) {
    throw new Error(`Failed to login user: ${user.email}`);
  }

  return res.body.token;
};

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key';

// "HH:MM" on the server clock, some minutes from now. Lets the access-hours
// tests build windows that do or don't include the current time, so they
// pass whatever time of day the suite runs.
const hhmm = (offsetMinutes) => {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Connect to test database before all tests
beforeAll(async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('Test database URI not configured. Set MONGODB_URI in .env');
  }

  const mongoUri = process.env.MONGODB_URI;
  await mongoose.connect(mongoUri);

  // Create unique test identifiers
  testId = Date.now().toString();

  // Clear existing test data
  await User.deleteMany({ email: new RegExp(`test.*${testId}@test\.com$`) });
  await Child.deleteMany({ name: new RegExp(`Test Child ${testId}`) });
  await Book.deleteMany({ title: new RegExp(`Test Book ${testId}`) });
  await ParentalControl.deleteMany({ testId });
  await ReadingSession.deleteMany({ testId });

  // Create test users
  const hashedPassword = await bcrypt.hash('TestPass123!', 10);

  testAdmin = await User.create({
    name: `Test Admin ${testId}`,
    email: `test.admin${testId}@test.com`,
    password: hashedPassword,
    role: 'admin',
    testId,
  });

  testParentA = await User.create({
    name: `Test Parent A ${testId}`,
    email: `test.parentA${testId}@test.com`,
    password: hashedPassword,
    role: 'parent',
    testId,
  });

  testParentB = await User.create({
    name: `Test Parent B ${testId}`,
    email: `test.parentB${testId}@test.com`,
    password: hashedPassword,
    role: 'parent',
    testId,
  });

  testStudentA = await User.create({
    name: `Test Student A ${testId}`,
    email: `test.studentA${testId}@test.com`,
    password: hashedPassword,
    role: 'student',
    parentId: testParentA._id,
    testId,
  });

  testStudentB = await User.create({
    name: `Test Student B ${testId}`,
    email: `test.studentB${testId}@test.com`,
    password: hashedPassword,
    role: 'student',
    parentId: testParentB._id,
    testId,
  });

// Create test children
  testChildA = await Child.create({
    name: `Test Child A ${testId}`,
    age: 7,
    band: 'A',
    parent: testParentA._id,
    student: testStudentA._id,
    testId,
  });

  testChildB = await Child.create({
    name: `Test Child B ${testId}`,
    age: 8,
    band: 'B',
    parent: testParentB._id,
    student: testStudentB._id,
    testId,
  });

// Create test books
  testActiveBook = await Book.create({
    title: `Test Active Book ${testId}`,
    author: 'Test Author',
    description: 'Test Description',
    category: 'Adventure',
    ageGroup: '6-8',
    status: 'active',
    createdBy: testAdmin._id,
    testId,
  });

  testInactiveBook = await Book.create({
    title: `Test Inactive Book ${testId}`,
    author: 'Test Author',
    description: 'Test Description',
    category: 'Adventure',
    ageGroup: '6-8',
    status: 'archived',
    createdBy: testAdmin._id,
    testId,
  });

// Create test parental controls
  testControlA = await ParentalControl.create({
    childId: testChildA._id,
    parentId: testParentA._id,
    dailyLimit: 120,
    sessionLimit: 60,
    allowedStartTime: '08:00',
    allowedEndTime: '20:00',
    externalLinksAllowed: true,
    isEnabled: true,
    testId,
  });

// Generate tokens
  adminToken = await generateToken(testAdmin);
  parentTokenA = await generateToken(testParentA);
  parentTokenB = await generateToken(testParentB);
  studentTokenA = await generateToken(testStudentA);
  studentTokenB = await generateToken(testStudentB);

  // Add parentId to student tokens
  studentTokenA = await generateToken({ ...testStudentA.toObject(), parentId: testParentA._id });
  studentTokenB = await generateToken({ ...testStudentB.toObject(), parentId: testParentB._id });
}, 30000);

// Clean up after all tests
afterAll(async () => {
  // Clean up test data
  await User.deleteMany({ email: new RegExp(`test.*${testId}@test\.com$`) });
  await Child.deleteMany({ name: new RegExp(`Test Child ${testId}`) });
  await Book.deleteMany({ title: new RegExp(`Test Book ${testId}`) });
  await ParentalControl.deleteMany({ testId });
  await ReadingSession.deleteMany({ testId });
  await mongoose.connection.close();
}, 30000);

// ============================================
// A. PARENTAL CONTROL TESTS
// ============================================

describe('A. Parental Control Tests', () => {

  // A1. Get controls for an owned child
  test('A1. Get controls for an owned child - Expected 200', async () => {
    // First create controls
    await request(app)
      .post(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({
        dailyLimit: 60,
        sessionLimit: 30,
        allowedStartTime: '07:00',
        allowedEndTime: '20:00',
        externalLinksAllowed: false,
      });

    const res = await request(app)
      .get(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  // A2. Get controls for another family's child
  test('A2. Get controls for another family\'s child - Expected 403', async () => {
    const res = await request(app)
      .get(`/api/parental-controls/${testChildB._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // A3. Create controls for owned child
  test('A3. Create controls for owned child - Expected 201', async () => {
    // Delete any existing controls first
    await ParentalControl.deleteOne({ childId: testChildB._id });

    const res = await request(app)
      .post(`/api/parental-controls/${testChildB._id}`)
      .set('Authorization', `Bearer ${parentTokenB}`)
      .send({
        dailyLimit: 90,
        sessionLimit: 45,
        allowedStartTime: '08:00',
        allowedEndTime: '21:00',
        externalLinksAllowed: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEnabled).toBe(true);
  });

  // A4. Update daily limit
  test('A4. Update daily limit - Expected success', async () => {
    const res = await request(app)
      .put(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ dailyLimit: 120 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dailyLimit).toBe(120);
  });

  // A5. Update session limit
  test('A5. Update session limit - Expected success', async () => {
    const res = await request(app)
      .put(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ sessionLimit: 60 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionLimit).toBe(60);
  });

  // A6. Validate invalid daily/session limits
  test('A6. Validate invalid daily limit - Expected 400', async () => {
    const res = await request(app)
      .put(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ dailyLimit: -10 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // A7. Validate invalid HH:mm access hours
  test('A7. Validate invalid access hours format - Expected 400', async () => {
    const res = await request(app)
      .put(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ allowedStartTime: '25:00' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // A8. Enable controls
  test('A8. Enable controls - Expected success', async () => {
    const res = await request(app)
      .patch(`/api/parental-controls/${testChildA._id}/enable`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEnabled).toBe(true);
  });

  // A9. Disable controls
  test('A9. Disable controls - Expected success', async () => {
    const res = await request(app)
      .patch(`/api/parental-controls/${testChildA._id}/disable`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEnabled).toBe(false);

    // Re-enable for subsequent tests
    await request(app)
      .patch(`/api/parental-controls/${testChildA._id}/enable`)
      .set('Authorization', `Bearer ${parentTokenA}`);
  });

  // A10. Student attempting to modify parental controls
  test('A10. Student cannot modify parental controls - Expected 403', async () => {
    const res = await request(app)
      .put(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${studentTokenA}`)
      .send({ dailyLimit: 200 });

    expect(res.status).toBe(403);
  });

  // A11. Admin oversight
  test('A11. Admin can access parental controls - Expected success', async () => {
    const res = await request(app)
      .get(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // A12. Missing child
  test('A12. Missing child - Expected 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/parental-controls/${fakeId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  // A13. External-link permission retrieval
  test('A13. Get external links permission - Expected success', async () => {
    const res = await request(app)
      .get(`/api/parental-controls/${testChildA._id}/external-links`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.externalLinksAllowed).toBe('boolean');
  });

  // A14. Cross-family external-link access
  test('A14. Cross-family external-link access - Expected 403', async () => {
    const res = await request(app)
      .get(`/api/parental-controls/${testChildB._id}/external-links`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(403);
  });
});

// ============================================
// B. READING SESSION TESTS
// ============================================

describe('B. Reading Session Tests', () => {

  // These tests are about sessions and limits, not the time of day, so open
  // the reading window all day. B27 and B28 test the window itself.
  beforeAll(async () => {
    await ParentalControl.updateMany(
      { childId: { $in: [testChildA._id, testChildB._id] } },
      { $set: { allowedStartTime: '00:00', allowedEndTime: '23:59' } }
    );
  });

  // B15. Student starts reading an active book
  test('B15. Student starts reading an active book - Expected 201', async () => {
    const res = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentTokenA}`)
      .send({ bookId: testActiveBook._id });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.session).toBeDefined();
  });

  // B16. Student attempts to start inactive/archived book
  test('B16. Student attempts to start inactive book - Expected 403', async () => {
    const res = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentTokenA}`)
      .send({ bookId: testInactiveBook._id });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Book is not active');
  });

  // B17. Student attempts to start nonexistent book
  test('B17. Student attempts to start nonexistent book - Expected 404', async () => {
    const fakeBookId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentTokenA}`)
      .send({ bookId: fakeBookId });

    expect(res.status).toBe(404);
  });

  // B18. Student starts a second active session
  test('B18. Student starts second active session - Expected rejection', async () => {
    // First session already exists from B15
    const res = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentTokenA}`)
      .send({ bookId: testActiveBook._id });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('already exists');
  });

  // B19. End an active session
  test('B19. End an active session - Expected success', async () => {
    // Get the active session
    const session = await ReadingSession.findOne({ childId: testChildA._id, status: 'active' });

    const res = await request(app)
      .post(`/api/reading-sessions/${session._id}/end`)
      .set('Authorization', `Bearer ${studentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.session.status).not.toBe('active');
    expect(res.body.session.duration).toBeGreaterThanOrEqual(0);
  });

  // B20. Ending nonexistent session
  test('B20. End nonexistent session - Expected 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`/api/reading-sessions/${fakeId}/end`)
      .set('Authorization', `Bearer ${studentTokenA}`);

    expect(res.status).toBe(404);
  });

  // B21. Ending another student's session
  test('B21. End another student\'s session - Expected 403', async () => {
    // Create a session for Student A
    const session = await ReadingSession.create({
      childId: testChildA._id,
      bookId: testActiveBook._id,
      startTime: new Date(),
      date: todayKey(),
      status: 'active',
    });

    // Student B tries to end it
    const res = await request(app)
      .post(`/api/reading-sessions/${session._id}/end`)
      .set('Authorization', `Bearer ${studentTokenB}`);

    expect(res.status).toBe(403);

    // Clean up
    await ReadingSession.findByIdAndDelete(session._id);
  });

  // B22. Daily usage calculation
  test('B22. Daily usage calculation - Expected usage calculated', async () => {
    const res = await request(app)
      .get('/api/reading-sessions/usage/today')
      .set('Authorization', `Bearer ${studentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(typeof res.body.data.usedMinutes).toBe('number');
    expect(typeof res.body.data.remainingMinutes).toBe('number');
  });

  // B23. Remaining-time calculation
  test('B23. Remaining-time calculation - Expected correct calculation', async () => {
    const res = await request(app)
      .get(`/api/reading-sessions/remaining-time/${testChildA._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.dailyLimit).toBeDefined();
    expect(res.body.data.remainingMinutes).toBeGreaterThanOrEqual(0);
  });

  // B24. Daily limit exceeded
  test('B24. Daily limit exceeded - Expected rejection', async () => {
    // Set a very low daily limit
    await ParentalControl.findOneAndUpdate(
      { childId: testChildB._id },
      { $set: { dailyLimit: 1 } }
    );

    // Create a completed session that exceeds the limit
    await ReadingSession.create({
      childId: testChildB._id,
      bookId: testActiveBook._id,
      startTime: new Date(Date.now() - 5 * 60000),
      endTime: new Date(),
      duration: 5,
      date: todayKey(),
      status: 'completed',
    });

    const res = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentTokenB}`)
      .send({ bookId: testActiveBook._id });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('limit');
  });

// B25. Session limit exceeded
  test('B25. Session limit enforcement - Expected session duration capped', async () => {
    // Reset the daily limit to allow reading
    await ParentalControl.findOneAndUpdate(
      { childId: testChildB._id },
      { $set: { dailyLimit: 120, sessionLimit: 5 } } // Set session limit to 5 minutes
    );

    // Delete existing sessions for clean test
    await ReadingSession.deleteMany({ childId: testChildB._id });

    // Start a session
    const startRes = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentTokenB}`)
      .send({ bookId: testActiveBook._id });

    expect(startRes.status).toBe(201);

    // Backdate the session to exercise elapsed-time enforcement deterministically.
    await ReadingSession.updateOne(
      { childId: testChildB._id, status: 'active' },
      { $set: { startTime: new Date(Date.now() - 6 * 60000) } }
    );

    // End the session
    const session = await ReadingSession.findOne({ childId: testChildB._id, status: 'active' });
    const endRes = await request(app)
      .post(`/api/reading-sessions/${session._id}/end`)
      .set('Authorization', `Bearer ${studentTokenB}`);

    expect(endRes.status).toBe(200);
    // Verify duration is capped at session limit
    expect(endRes.body.session.duration).toBeLessThanOrEqual(5);
    expect(endRes.body.session.duration).toBeGreaterThanOrEqual(4);
  });

  // B26. Server-side elapsed-time enforcement
  test('B26. Server-side elapsed-time enforcement', async () => {
    // Set reasonable limits
    await ParentalControl.findOneAndUpdate(
      { childId: testChildA._id },
      { $set: { dailyLimit: 120, sessionLimit: 60 } }
    );

    // Create a session that started 5 minutes ago
    const session = await ReadingSession.create({
      childId: testChildA._id,
      bookId: testActiveBook._id,
      startTime: new Date(Date.now() - 5 * 60000),
      date: todayKey(),
      status: 'active',
    });

    const res = await request(app)
      .post(`/api/reading-sessions/${session._id}/end`)
      .set('Authorization', `Bearer ${studentTokenA}`);

    expect(res.status).toBe(200);
    // Server calculates ~5 minutes
    expect(res.body.session.duration).toBeGreaterThanOrEqual(4);
    expect(res.body.session.duration).toBeLessThanOrEqual(6);
  });

// B27. Allowed access hours - Inside window
  test('B27. Allowed access hours - Inside window - Expected reading permitted', async () => {
    // A window from an hour ago to an hour from now, so "now" is inside it.
    // (Faking the clock here stalled the database driver, so the real clock is used.)
    await ParentalControl.findOneAndUpdate(
      { childId: testChildA._id },
      { $set: { allowedStartTime: hhmm(-60), allowedEndTime: hhmm(60) } }
    );

    // Clean up existing sessions
    await ReadingSession.deleteMany({ childId: testChildA._id });

    const res = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentTokenA}`)
      .send({ bookId: testActiveBook._id });

    expect(res.status).toBe(201);
  });

// B28. Blocked access hours - Outside window
  test('B28. Blocked access hours - Outside window - Expected reading rejected', async () => {
    // A window that opens an hour from now, so "now" is outside it.
    await ParentalControl.findOneAndUpdate(
      { childId: testChildB._id },
      { $set: { allowedStartTime: hhmm(60), allowedEndTime: hhmm(120) } }
    );

    await ReadingSession.deleteMany({ childId: testChildB._id });

    const res = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentTokenB}`)
      .send({ bookId: testActiveBook._id });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('not allowed');
  });

// B29. Missing parental controls
  test('B29. Missing parental controls - Expected 403', async () => {
    // A student of their own, linked to a child that has no controls
    // (signing in needs a real email and password)
    const studentNoControls = await User.create({
      name: `Test Student No Controls ${testId}`,
      email: `test.studentnocontrols${testId}@test.com`,
      password: await bcrypt.hash('TestPass123!', 10),
      role: 'student',
      parentId: testParentA._id,
      testId,
    });

    const childNoControls = await Child.create({
      name: `Test Child No Controls ${testId}`,
      age: 6,
      band: 'A',
      parent: testParentA._id,
      student: studentNoControls._id,
      testId,
    });

    const studentNoControlsToken = await generateToken(studentNoControls);

    // Verify the student cannot start a reading session
    const res = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentNoControlsToken}`)
      .send({ bookId: testActiveBook._id });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('controls');

    // Verify the student cannot get remaining time
    const timeRes = await request(app)
      .get('/api/reading-sessions/remaining-time')
      .set('Authorization', `Bearer ${studentNoControlsToken}`);

    expect(timeRes.status).toBe(403);

    // Verify the student cannot get history
    const historyRes = await request(app)
      .get('/api/reading-sessions/history')
      .set('Authorization', `Bearer ${studentNoControlsToken}`);

    expect(historyRes.status).toBe(403);

    await Child.findByIdAndDelete(childNoControls._id);
  });

  // B30. Student history
  test('B30. Student can see own history - Expected success', async () => {
    const res = await request(app)
      .get('/api/reading-sessions/history')
      .set('Authorization', `Bearer ${studentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // B31. Parent history
  test('B31. Parent can see children\'s history - Expected success', async () => {
    const res = await request(app)
      .get('/api/reading-sessions/history')
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // B32. Cross-family history
  test('B32. Parent cannot access another family\'s history - Expected empty/unauthorized', async () => {
    // Get history for test child B's sessions as parent A
    const res = await request(app)
      .get('/api/reading-sessions/history')
      .set('Authorization', `Bearer ${parentTokenA}`);

    // Verify no child B data in the results
    const childBInResults = res.body.data.some(
      session => session.childId && session.childId._id === testChildB._id.toString()
    );

    expect(childBInResults).toBe(false);
  });

  // B33. Admin history
  test('B33. Admin can access all history - Expected success', async () => {
    const res = await request(app)
      .get('/api/reading-sessions/history')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // B34. Date filter
  test('B34. Date filter works correctly', async () => {
    const today = todayKey();
    const res = await request(app)
      .get(`/api/reading-sessions/history?date=${today}`)
      .set('Authorization', `Bearer ${studentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify all returned sessions have the correct date
    res.body.data.forEach(session => {
      expect(session.date).toBe(today);
    });
  });

  // B35. Invalid date filter
  test('B35. Invalid date filter - Expected validation response', async () => {
    const res = await request(app)
      .get('/api/reading-sessions/history?date=invalid-date')
      .set('Authorization', `Bearer ${studentTokenA}`);

    // The API should either return 200 with empty results or handle gracefully
    expect(res.status).toBe(200);
  });
});

// ============================================
// C. AUTHORIZATION / SECURITY REGRESSION TESTS
// ============================================

describe('C. Authorization / Security Regression Tests', () => {

  // C36. Missing JWT on protected parental-control endpoint
  test('C36. Missing JWT on parental-control endpoint - Expected 401', async () => {
    const res = await request(app)
      .get(`/api/parental-controls/${testChildA._id}`);

    expect(res.status).toBe(401);
  });

  // C37. Invalid JWT
  test('C37. Invalid JWT - Expected 401', async () => {
    const res = await request(app)
      .get(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', 'Bearer invalid_token_here');

    expect(res.status).toBe(401);
  });

  // C38. Missing JWT on reading-session endpoint
  test('C38. Missing JWT on reading-session endpoint - Expected 401', async () => {
    const res = await request(app)
      .post('/api/reading-sessions/start')
      .send({ bookId: testActiveBook._id });

    expect(res.status).toBe(401);
  });

  // C39. Student cannot access another student's data
  test('C39. Student cannot access another student\'s data', async () => {
    // Student B tries to get Student A's remaining time
    const res = await request(app)
      .get(`/api/reading-sessions/remaining-time/${testChildA._id}`)
      .set('Authorization', `Bearer ${studentTokenB}`);

    expect(res.status).toBe(403);
  });

  // C40. Client cannot override ownership
  test('C40. Client cannot override ownership - Expected server enforcement', async () => {
    // Parent A creates controls for their child - cannot claim another parent's child
    const res = await request(app)
      .post(`/api/parental-controls/${testChildB._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({
        dailyLimit: 60,
        sessionLimit: 30,
        allowedStartTime: '08:00',
        allowedEndTime: '20:00',
        externalLinksAllowed: false,
      });

    // Should be rejected due to ownership check
    expect(res.status).toBe(403);
  });
});

// ============================================
// D. REGRESSION TESTS
// ============================================

describe('D. Regression Tests', () => {

  test('D41. Inactive book returns 403 with correct message', async () => {
    // This is a critical regression test
    const res = await request(app)
      .post('/api/reading-sessions/start')
      .set('Authorization', `Bearer ${studentTokenA}`)
      .send({ bookId: testInactiveBook._id });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Book is not active');
  });

  test('D42. Health endpoint returns success', async () => {
    const healthApp = express();
    const healthRoutes = require('../src/routes/health.routes');
    healthApp.use('/api/health', healthRoutes);

    const res = await request(healthApp)
      .get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('D43. Cross-family isolation enforced', async () => {
    // Parent A cannot access Parent B's child controls
    const res = await request(app)
      .get(`/api/parental-controls/${testChildB._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(403);
  });

  test('D44. Admin can access any child\'s controls', async () => {
    const res = await request(app)
      .get(`/api/parental-controls/${testChildB._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  test('D45. Duplicate controls creation rejected', async () => {
    // First delete any existing controls for child A
    await ParentalControl.deleteOne({ childId: testChildA._id });

    // Create controls for child A
    const createRes = await request(app)
      .post(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({
        dailyLimit: 60,
        sessionLimit: 30,
        allowedStartTime: '08:00',
        allowedEndTime: '20:00',
        externalLinksAllowed: false,
      });

    // Verify creation was successful
    expect(createRes.status).toBe(201);

    // Try to create again
    const res = await request(app)
      .post(`/api/parental-controls/${testChildA._id}`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({
        dailyLimit: 60,
        sessionLimit: 30,
        allowedStartTime: '08:00',
        allowedEndTime: '20:00',
        externalLinksAllowed: false,
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('already exist');
  });
});