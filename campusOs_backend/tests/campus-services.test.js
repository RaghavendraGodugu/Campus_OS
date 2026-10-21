/**
 * Hostel, library and placements.
 *
 * The three former "hollow" roles now own a domain. These tests cover the
 * invariants that make each domain real: capacity and one-active-allocation,
 * atomic copy issuing, drive visibility and eligibility, and the fact that the
 * old generic request/complaint grants are gone.
 */
const request = require("supertest");

const {
  getApp,
  resetDatabase,
  createUser,
  createDepartment,
  createProgram,
  createStudent,
  loginAs,
} = require("./helpers/factory");

const AuditLog = require("../src/models/AuditLog");
const Book = require("../src/models/Book");
const hostelService = require("../src/services/hostel.service");
const libraryService = require("../src/services/library.service");
const placementService = require("../src/services/placement.service");
const {
  ROLES,
  AUDIT_ACTION,
  PLACEMENT_DRIVE_STATUS,
} = require("../src/config/constants");
const { permissionsFor, P } = require("../src/utils/permissions");

async function seed() {
  const department = await createDepartment();
  const program = await createProgram(department);
  const admin = await createUser({ role: ROLES.HOSTEL_ADMIN });
  const librarian = await createUser({ role: ROLES.LIBRARY_ADMIN });
  const placement = await createUser({ role: ROLES.PLACEMENT_ADMIN });
  const first = await createStudent({ department, program });
  const second = await createStudent({ department, program });
  return { department, program, admin, librarian, placement, first, second };
}

async function hostelFixture(world, capacity = 1) {
  const hostel = await hostelService.createHostel({
    user: world.admin,
    payload: {
      name: `Block ${Math.random().toString(36).slice(2, 7)}`,
      code: `H${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      kind: "COED",
    },
  });
  const room = await hostelService.createRoom({
    user: world.admin,
    hostelId: hostel.id,
    payload: { number: "101", capacity },
  });
  return { hostel, room };
}

describe("campus services", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe("hostel", () => {
    it("refuses allocation beyond room capacity", async () => {
      const world = await seed();
      const { room } = await hostelFixture(world, 1);

      await hostelService.allocate({
        user: world.admin,
        payload: {
          student: String(world.first.student._id),
          room: room.id,
          academicYear: "2026-27",
        },
      });

      await expect(
        hostelService.allocate({
          user: world.admin,
          payload: {
            student: String(world.second.student._id),
            room: room.id,
            academicYear: "2026-27",
          },
        })
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("keeps one active allocation per student and frees the room on vacate", async () => {
      const world = await seed();
      const { room } = await hostelFixture(world, 2);
      const other = await hostelFixture(world, 2);

      const allocation = await hostelService.allocate({
        user: world.admin,
        payload: {
          student: String(world.first.student._id),
          room: room.id,
          academicYear: "2026-27",
        },
      });

      await expect(
        hostelService.allocate({
          user: world.admin,
          payload: {
            student: String(world.first.student._id),
            room: other.room.id,
            academicYear: "2026-27",
          },
        })
      ).rejects.toMatchObject({ statusCode: 409 });

      await hostelService.vacate({ user: world.admin, id: allocation.id });
      const again = await hostelService.allocate({
        user: world.admin,
        payload: {
          student: String(world.first.student._id),
          room: other.room.id,
          academicYear: "2026-27",
        },
      });
      expect(again.status).toBe("ACTIVE");

      const audit = await AuditLog.findOne({
        action: AUDIT_ACTION.HOSTEL_ALLOCATED,
      }).lean();
      expect(audit).not.toBeNull();
    });

    it("requires an active allocation for leave and lets only the warden decide", async () => {
      const world = await seed();

      await expect(
        hostelService.requestLeave({
          user: world.first.user,
          payload: {
            fromDate: new Date("2026-10-20"),
            toDate: new Date("2026-10-22"),
            reason: "Family function",
          },
        })
      ).rejects.toMatchObject({ statusCode: 400 });

      const { room } = await hostelFixture(world);
      await hostelService.allocate({
        user: world.admin,
        payload: {
          student: String(world.first.student._id),
          room: room.id,
          academicYear: "2026-27",
        },
      });

      const leave = await hostelService.requestLeave({
        user: world.first.user,
        payload: {
          fromDate: new Date("2026-10-20"),
          toDate: new Date("2026-10-22"),
          reason: "Family function",
        },
      });
      expect(leave.status).toBe("PENDING");

      await expect(
        hostelService.decideLeave({
          user: world.first.user,
          id: leave.id,
          payload: { decision: "APPROVED" },
        })
      ).rejects.toMatchObject({ statusCode: 403 });

      const decided = await hostelService.decideLeave({
        user: world.admin,
        id: leave.id,
        payload: { decision: "APPROVED", note: "Approved" },
      });
      expect(decided.status).toBe("APPROVED");
    });
  });

  describe("library", () => {
    it("issues the last copy atomically and refuses the next borrower", async () => {
      const world = await seed();
      const book = await libraryService.createBook({
        user: world.librarian,
        payload: { title: "Clean Code", author: "Robert Martin", copiesTotal: 1 },
      });

      await libraryService.issueBook({
        user: world.librarian,
        payload: {
          book: book.id,
          student: String(world.first.student._id),
          dueAt: new Date("2026-11-01"),
        },
      });

      await expect(
        libraryService.issueBook({
          user: world.librarian,
          payload: {
            book: book.id,
            student: String(world.second.student._id),
            dueAt: new Date("2026-11-01"),
          },
        })
      ).rejects.toMatchObject({ statusCode: 409 });

      const stored = await Book.findById(book.id).lean();
      expect(stored.copiesIssued).toBe(1);
    });

    it("rolls the copy count back when the same student borrows twice", async () => {
      const world = await seed();
      const book = await libraryService.createBook({
        user: world.librarian,
        payload: { title: "Refactoring", author: "Martin Fowler", copiesTotal: 2 },
      });

      await libraryService.issueBook({
        user: world.librarian,
        payload: {
          book: book.id,
          student: String(world.first.student._id),
          dueAt: new Date("2026-11-01"),
        },
      });

      await expect(
        libraryService.issueBook({
          user: world.librarian,
          payload: {
            book: book.id,
            student: String(world.first.student._id),
            dueAt: new Date("2026-11-02"),
          },
        })
      ).rejects.toMatchObject({ statusCode: 409 });

      const stored = await Book.findById(book.id).lean();
      expect(stored.copiesIssued).toBe(1);
    });

    it("returns a copy exactly once", async () => {
      const world = await seed();
      const book = await libraryService.createBook({
        user: world.librarian,
        payload: { title: "SICP", author: "Abelson", copiesTotal: 1 },
      });
      const issue = await libraryService.issueBook({
        user: world.librarian,
        payload: {
          book: book.id,
          student: String(world.first.student._id),
          dueAt: new Date("2026-11-01"),
        },
      });

      await libraryService.returnBook({ user: world.librarian, id: issue.id });
      await libraryService.returnBook({ user: world.librarian, id: issue.id });

      const stored = await Book.findById(book.id).lean();
      expect(stored.copiesIssued).toBe(0);
    });
  });

  describe("placements", () => {
    async function drive(world, overrides = {}) {
      const company = await placementService.createCompany({
        user: world.placement,
        payload: {
          name: `Acme ${Math.random().toString(36).slice(2, 7)}`,
          sector: "Software",
        },
      });
      return placementService.createDrive({
        user: world.placement,
        payload: {
          company: company.id,
          title: "Graduate Engineer",
          role: "SDE",
          applicationDeadline: new Date("2026-11-01"),
          driveDate: new Date("2026-11-10"),
          ...overrides,
        },
      });
    }

    it("hides draft drives from students until they are opened", async () => {
      const world = await seed();
      const created = await drive(world);

      const before = await placementService.listDrives({ user: world.first.user });
      expect(before).toHaveLength(0);

      await placementService.setDriveStatus({
        user: world.placement,
        id: created.id,
        payload: { status: PLACEMENT_DRIVE_STATUS.OPEN },
      });

      const after = await placementService.listDrives({ user: world.first.user });
      expect(after).toHaveLength(1);
      expect(after[0].status).toBe("OPEN");
    });

    it("applies once, refuses a duplicate and allows withdrawal", async () => {
      const world = await seed();
      const created = await drive(world);
      await placementService.setDriveStatus({
        user: world.placement,
        id: created.id,
        payload: { status: "OPEN" },
      });

      const application = await placementService.apply({
        user: world.first.user,
        driveId: created.id,
      });
      expect(application.status).toBe("APPLIED");

      await expect(
        placementService.apply({ user: world.first.user, driveId: created.id })
      ).rejects.toMatchObject({ statusCode: 409 });

      const withdrawn = await placementService.withdraw({
        user: world.first.user,
        driveId: created.id,
      });
      expect(withdrawn.status).toBe("WITHDRAWN");
    });

    it("refuses a programme that is not eligible", async () => {
      const world = await seed();
      const otherDepartment = await createDepartment();
      const otherProgram = await createProgram(otherDepartment);
      const created = await drive(world, {
        eligiblePrograms: [String(otherProgram._id)],
      });
      await placementService.setDriveStatus({
        user: world.placement,
        id: created.id,
        payload: { status: "OPEN" },
      });

      await expect(
        placementService.apply({ user: world.first.user, driveId: created.id })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("refuses an application after the deadline", async () => {
      const world = await seed();
      const created = await drive(world, {
        applicationDeadline: new Date("2026-01-01"),
        driveDate: new Date("2026-01-10"),
      });
      await placementService.setDriveStatus({
        user: world.placement,
        id: created.id,
        payload: { status: "OPEN" },
      });

      await expect(
        placementService.apply({ user: world.first.user, driveId: created.id })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("lets the placement office move an application forward", async () => {
      const world = await seed();
      const created = await drive(world);
      await placementService.setDriveStatus({
        user: world.placement,
        id: created.id,
        payload: { status: "OPEN" },
      });
      const application = await placementService.apply({
        user: world.first.user,
        driveId: created.id,
      });

      const decided = await placementService.decideApplication({
        user: world.placement,
        id: application.id,
        payload: { status: "SELECTED" },
      });
      expect(decided.status).toBe("SELECTED");
    });
  });

  it("replaces the generic request and complaint grants on the three roles", () => {
    const hostel = permissionsFor(ROLES.HOSTEL_ADMIN);
    expect(hostel).toContain(P.HOSTEL_MANAGE);
    expect(hostel).not.toContain(P.REQUEST_READ_INSTITUTION);
    expect(hostel).not.toContain(P.COMPLAINT_RESOLVE);

    const library = permissionsFor(ROLES.LIBRARY_ADMIN);
    expect(library).toContain(P.LIBRARY_ISSUE);
    expect(library).not.toContain(P.REQUEST_UPDATE_ASSIGNED);

    const placement = permissionsFor(ROLES.PLACEMENT_ADMIN);
    expect(placement).toContain(P.PLACEMENT_MANAGE);
    expect(placement).not.toContain(P.COMPLAINT_INVESTIGATE);
  });

  it("refuses a student scheduling a hostel allocation over HTTP", async () => {
    const world = await seed();
    const { room } = await hostelFixture(world);
    const { agent, csrfToken } = await loginAs(world.first.user);

    const res = await agent
      .post("/api/v1/hostel/allocations")
      .set("X-CSRF-Token", csrfToken)
      .send({
        student: String(world.first.student._id),
        room: room.id,
        academicYear: "2026-27",
      });

    expect(res.status).toBe(403);
  });
});

describe("the company directory over HTTP", () => {
  /**
   * `GET /placement/companies` was implemented in the service and called by the
   * placements page for its drive composer, but the route that serves it never
   * existed — the page 404ed from the moment it loaded. These tests pin the
   * contract: signed-in roles can read the directory, an anonymous client
   * cannot.
   */
  it("returns the directory to a student, who reads drives with the same permission", async () => {
    const world = await seed();
    const name = `Acme ${Math.random().toString(36).slice(2, 7)}`;
    await placementService.createCompany({
      user: world.placement,
      payload: { name, sector: "Software" },
    });
    const { agent } = await loginAs(world.first.user);

    const res = await agent.get("/api/v1/placement/companies");

    expect(res.status).toBe(200);
    const names = res.body.data.companies.map((company) => company.name);
    expect(names).toContain(name);
  });

  it("answers 401 without a session", async () => {
    await seed();
    const res = await request(await getApp()).get("/api/v1/placement/companies");
    expect(res.status).toBe(401);
  });
});
