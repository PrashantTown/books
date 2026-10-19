// Runs before every test file.
//
// The administrator one-time code is optional and set per environment. The
// test suites sign administrators in directly, so switch it off here; tests
// that cover the code step set it themselves. (dotenv never overrides a
// variable that already exists, so a code in .env won't leak into tests.)
process.env.ADMIN_LOGIN_CODE = "";

// Sign-in tokens need a secret. Give the tests one when the environment has
// none (on GitHub Actions, or a fresh clone without .env); any value works.
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_key";
