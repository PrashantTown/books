// Runs before every test file.
//
// The administrator one-time code is optional and set per environment. The
// test suites sign administrators in directly, so switch it off here; tests
// that cover the code step set it themselves. (dotenv never overrides a
// variable that already exists, so a code in .env won't leak into tests.)
process.env.ADMIN_LOGIN_CODE = "";
