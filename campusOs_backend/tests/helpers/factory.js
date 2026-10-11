/**
 * Test helpers: factories and an authenticated agent.
 *
 * Factories exist so no test depends on another test's data, and so a schema
 * change breaks every factory at once rather than silently producing invalid
 * fixtures.
 */

const request = require("supertest");
const mongoose = require("mongoose");

const { createApp } = require("../../src/app");
const { ROLES } = require("../../src/config/constants");
const { User, Department, Program, Student } = require("../../src/models");

/** App instance shared across a suite. Built once per file by createTestApp. */
let cachedApp = null;

/**
 * Build (and cache) the Express app under test.
 * @returns {import('express').Express}
 */
function getApp() {
  if (!cachedApp) {
    cachedApp = createApp();
  }
  return cachedApp;
}

/**
 * Remove all documents between tests.
 *
 * `deleteMany` rather than `dropDatabase` so indexes (and therefore the
 * uniqueness constraints the tests rely on) survive.
 */
async function resetDatabase() {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/** Fixed future-ish enrolment date so year/batch derivation is predictable. */
const ENROLMENT_DATE = new Date("2023-08-01T00:00:00.000Z");

let sequence = 0;

/**
 * Unique-per-call suffix.
 *
 * A monotonic counter rather than `Date.now()`: factories are called several
 * times within the same millisecond, and a truncated timestamp collides on the
 * unique indexes these records carry.
 */
const uniqueSuffix = () => {
  sequence += 1;
  return sequence.toString(36).padStart(6, "0");
};

/** Create a department. */
async function createDepartment(overrides = {}) {
  const suffix = uniqueSuffix();
  return Department.create({
    name: overrides.name ?? `Test Department ${suffix}`,
    code: overrides.code ?? `TST${suffix.toUpperCase().slice(0, 8)}`,
    ...overrides,
  });
}

/** Create a programme attached to a department. */
async function createProgram(department, overrides = {}) {
  const suffix = uniqueSuffix();
  return Program.create({
    name: overrides.name ?? `Test Programme ${suffix}`,
    code: overrides.code ?? `PRG${suffix.toUpperCase().slice(0, 8)}`,
    department: department?._id,
    level: overrides.level ?? "UNDERGRADUATE",
    durationYears: overrides.durationYears ?? 4,
    ...overrides,
  });
}

/** Create a user with a known password. */
async function createUser({
  role = ROLES.STUDENT,
  department,
  email,
  fullName,
  isActive = true,
  password = "TestPass123!",
} = {}) {
  const suffix = uniqueSuffix();
  const user = new User({
    email: email ?? `user.${suffix}@test.local`,
    fullName: fullName ?? `Test User ${suffix}`,
    role,
    department: department?._id,
    isActive,
  });
  await user.setPassword(password);
  await user.save();
  return user;
}

/**
 * Create a student: a User with role STUDENT plus a linked Student profile.
 */
async function createStudent({ department, program, ...userOptions } = {}) {
  const dept = department ?? (await createDepartment());
  const prog = program ?? (await createProgram(dept));
  const suffix = uniqueSuffix();

  const user = await createUser({
    ...userOptions,
    role: ROLES.STUDENT,
    department: dept,
  });

  const student = await Student.create({
    user: user._id,
    rollNumber: `ROLL${suffix.toUpperCase()}`,
    program: prog._id,
    department: dept._id,
    semester: 5,
    year: 3,
    section: "A",
    enrolmentDate: ENROLMENT_DATE,
    batchYear: 2021,
    feeStatus: "DUE",
  });

  await User.updateOne({ _id: user._id }, { $set: { student: student._id } });
  user.student = student._id;

  return { user, student, department: dept, program: prog };
}

/**
 * Log in through the real HTTP endpoint and return a supertest agent that
 * carries the session cookies.
 *
 * Deliberately goes through `/auth/login` rather than minting tokens directly:
 * the tests then exercise cookie issuance and CSRF token generation exactly as
 * a browser would.
 *
 * @param {object} user
 * @param {string} password
 * @returns {Promise<{agent: object, csrfToken: string, cookieHeader: string}>}
 */
async function loginAs(user, password = "TestPass123!") {
  const agent = request.agent(getApp());
  const res = await agent
    .post("/api/v1/auth/login")
    .send({ email: user.email, password });

  if (res.status !== 200) {
    throw new Error(
      `loginAs failed for ${user.email}: expected 200, received ${res.status} ${JSON.stringify(res.body)}`
    );
  }

  return {
    agent,
    csrfToken: readCookie(res, "cos_ct"),
    userId: res.body.data.user.id,
    // A raw Cookie header, for tests that mount their own Express app. A
    // supertest agent is bound to the app instance it was created against, so
    // its jar cannot be reused against a different instance.
    cookieHeader: (res.headers["set-cookie"] || [])
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}

/** Log in and return the agent, discarding other return values. */
const agentFor = async (user, password) => (await loginAs(user, password)).agent;

/** Extract a cookie value from a supertest response. */
function readCookie(res, name) {
  const header = res.headers["set-cookie"] || [];
  const match = header.map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

/** Standard error envelope assertion. */
function expectError(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ success: false });
  if (code) {
    expect(res.body.code).toBe(code);
  }
  // No stack traces or internal messages may ever reach a client.
  expect(res.body.stack).toBeUndefined();
}

module.exports = {
  getApp,
  resetDatabase,
  createDepartment,
  createProgram,
  createUser,
  createStudent,
  createRequestType,
  createRequest,
  loginAs,
  agentFor,
  readCookie,
  expectError,
  ENROLMENT_DATE,
};

/**
 * Create a request type — one entry in the catalogue of available services.
 *
 * Defaults to a minimal valid definition, so a test only has to describe the
 * fields its own scenario depends on.
 */
async function createRequestType({ department, fields = [], ...overrides } = {}) {
  const RequestType = require("../../src/models/RequestType");
  const dept = department ?? (await createDepartment());
  const suffix = uniqueSuffix();

  return RequestType.create({
    name: overrides.name ?? `Test Request Type ${suffix}`,
    code: overrides.code ?? `TRT${suffix.toUpperCase()}`,
    department: dept._id,
    fields,
    slaHours: 72,
    ...overrides,
  });
}

/**
 * Create a request.
 *
 * `student` is the record returned by createStudent() — pass its `user` and
 * `student` so ownership links are consistent. Defaults reproduce exactly what
 * request.service.submitRequest() writes, including the initial history entry.
 *
 * @param {object} params
 * @param {object} params.owner  `{ user, student, department, program }` from createStudent()
 * @param {object} [params.requestType]
 * @param {string} [params.status]
 */
async function createRequest({
  owner,
  requestType,
  status = "SUBMITTED",
  ...overrides
} = {}) {
  const Request = require("../../src/models/Request");
  const { REQUEST_STATUS } = require("../../src/config/constants");
  const ObjectId = require("mongoose").Types.ObjectId;

  const ownerUser = owner?.user;
  const ownerStudentId = owner?.student?._id ?? ownerUser?.student;
  const departmentId =
    requestType?.department ?? owner?.department?._id ?? new ObjectId();

  return Request.create({
    reference: `REQ-2026-${String(Math.floor(Math.random() * 1e9)).padStart(6, "0")}`,
    requestType: requestType?._id ?? new ObjectId(),
    student: ownerStudentId ?? new ObjectId(),
    department: departmentId,
    title: "Test request",
    data: {},
    status,
    submittedAt: new Date(),
    dueAt: new Date(Date.now() + 72 * 3600 * 1000),
    statusHistory: [
      {
        from: null,
        to: REQUEST_STATUS.SUBMITTED,
        actor: ownerUser?._id ?? new ObjectId(),
        actorRole: ownerUser?.role ?? "STUDENT",
        at: new Date(),
      },
    ],
    ...overrides,
  });
}
