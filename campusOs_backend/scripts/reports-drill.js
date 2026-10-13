#!/usr/bin/env node
/**
 * Live drill: reports and the audit trail.
 *
 *     npm run reports:drill
 *
 * Checks the thing that matters about reports, which is not the numbers but the
 * scoping: a HOD must see one department, a dean must see the college, and
 * neither may widen their own scope by asking nicely.
 */

const BASE = process.env.API_BASE ?? "http://localhost:5000/api/v1";

const jars = {};
const csrf = {};

const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => console.log(`  FAIL  ${m}`);

async function login(who, email, password = "Demo@Campus123") {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`login ${email}: ${body.message}`);
  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  jars[who] = jar;
  csrf[who] = (jar.match(/cos_ct=([^;]*)/) ?? [])[1];
}

const call = (who, method, path, body) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Cookie: jars[who],
      ...(method === "POST" ? { "X-CSRF-Token": csrf[who] } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({
    status: res.status,
    body: await res.json().catch(() => null),
  }));

/**
 * A window wide enough to contain the demo data.
 *
 * A narrow one would make the departmental-subset check pass trivially with
 * zero on both sides, which looks like a passing test and proves nothing.
 */
const WIDE = `from=${new Date(Date.now() - 180 * 86400000).toISOString()}&to=${new Date(Date.now() + 86400000).toISOString()}`;

(async () => {
  console.log("\nReports and audit drill\n");

  await Promise.all([
    login("dean", "demo.dean@campusos.local"),
    login("hod", "demo.hod@campusos.local"),
    login("accounts", "demo.accounts@campusos.local"),
    login("student", "demo.student.democs001@campusos.local"),
  ]);
  pass("signed in as dean, HOD, accounts and a student");

  // ===== Who may see reports at all =====
  const studentOverview = await call("student", "GET", "/reports/overview");
  if (studentOverview.status === 403) pass("a student is refused reports");
  else fail(`student overview returned ${studentOverview.status}`);

  // ===== Institutional vs departmental =====
  const deanOverview = await call("dean", "GET", "/reports/overview");
  const hodOverview = await call("hod", "GET", "/reports/overview");

  if (deanOverview.status === 200 && deanOverview.body.data.scope === "INSTITUTION") {
    pass(
      `dean sees institution scope: ${deanOverview.body.data.students.total} students, ${deanOverview.body.data.requests.total} requests`
    );
  } else {
    fail(`dean overview: ${deanOverview.status}`);
  }

  if (hodOverview.status === 200 && hodOverview.body.data.scope === "DEPARTMENT") {
    pass(
      `HOD sees department scope: ${hodOverview.body.data.students.total} students, ${hodOverview.body.data.requests.total} requests`
    );
  } else {
    fail(`HOD overview: ${hodOverview.status}`);
  }

  // ===== Sections the HOD may not have =====
  const deanHas = Object.keys(deanOverview.body.data);
  const hodHas = Object.keys(hodOverview.body.data);

  if (deanHas.includes("complaints") && deanHas.includes("finance")) {
    pass("dean receives complaint and finance sections");
  } else {
    fail(`dean overview missing sections: has ${deanHas.join(",")}`);
  }

  if (!hodHas.includes("complaints") && !hodHas.includes("finance")) {
    pass("HOD receives neither complaint nor finance sections — omitted, not zeroed");
  } else {
    fail(`HOD overview leaked sections: ${hodHas.join(",")}`);
  }

  // ===== Institution-only reports =====
  for (const who of ["hod", "dean"]) {
    const complaints = await call(who, "GET", `/reports/complaints?${WIDE}`);
    const finance = await call(who, "GET", `/reports/finance?${WIDE}`);

    if (who === "hod") {
      if (complaints.status === 403 && finance.status === 403) {
        pass("HOD is refused both institution-only reports");
      } else {
        fail(`HOD got complaints=${complaints.status} finance=${finance.status}`);
      }
    } else {
      if (complaints.status === 200 && finance.status === 200) {
        const t = finance.body.data.totals;
        pass(
          `dean reads finance: invoiced ${t.invoicedFormatted}, collected ${t.collectedFormatted}, outstanding ${t.outstandingTotalFormatted}`
        );
      } else {
        fail(`dean reports: complaints=${complaints.status} finance=${finance.status}`);
      }
    }
  }

  // ===== Money is whole paise =====
  const finance = await call("dean", "GET", `/reports/finance?${WIDE}`);
  const totals = finance.body.data.totals;
  const allWhole = [
    "invoiced",
    "collected",
    "refunded",
    "outstandingTotal",
    "netCollected",
  ].every((k) => Number.isInteger(totals[k]));
  if (allWhole)
    pass(`every money total is a whole number of paise (net ${totals.netCollected})`);
  else fail("a money total is not an integer");

  // ===== Departmental scoping cannot be widened =====
  const hodRequests = await call("hod", "GET", `/reports/requests?${WIDE}`);
  const deanRequests = await call("dean", "GET", `/reports/requests?${WIDE}`);

  if (hodRequests.status === 200 && deanRequests.status === 200) {
    const hodTotal = hodRequests.body.data.totals.total;
    const deanTotal = deanRequests.body.data.totals.total;

    if (hodTotal <= deanTotal) {
      pass(
        `HOD sees ${hodTotal} requests, dean sees ${deanTotal} — departmental is a subset`
      );
    } else {
      fail(`HOD saw ${hodTotal} requests but dean saw only ${deanTotal}`);
    }

    // Naming a department must not widen a department-scoped view.
    const widened = await call(
      "hod",
      "GET",
      `/reports/requests?${WIDE}&department=000000000000000000000001`
    );
    if (widened.status === 200 && widened.body.data.totals.total === hodTotal) {
      pass("a HOD naming another department is ignored, not obeyed");
    } else {
      fail(`HOD widened scope: ${widened.body?.data?.totals?.total} vs ${hodTotal}`);
    }
  } else {
    fail(`request reports: HOD=${hodRequests.status} dean=${deanRequests.status}`);
  }

  // ===== Period bounds =====
  const tooWide = await call(
    "dean",
    "GET",
    `/reports/requests?from=${new Date(Date.now() - 900 * 86400000).toISOString()}`
  );
  if (tooWide.status === 400)
    pass("a period beyond the ceiling is refused rather than scanned");
  else fail(`an 900-day period returned ${tooWide.status}`);

  // ===== Audit trail =====
  const deanAudit = await call("dean", "GET", `/audit?${WIDE}&limit=5`);
  if (deanAudit.status === 200) {
    pass(
      `dean reads the trail: ${deanAudit.body.meta.total} entries, scope ${deanAudit.body.meta.scope}`
    );
  } else {
    fail(`dean audit returned ${deanAudit.status}`);
  }

  const hodAudit = await call("hod", "GET", `/audit?${WIDE}&limit=5`);
  if (hodAudit.status === 200 && hodAudit.body.meta.scope === "DEPARTMENT_OWN_ACTIONS") {
    pass(`HOD's trail is narrowed and labelled: ${hodAudit.body.meta.scope}`);
    pass(`  note: ${String(hodAudit.body.meta.scopeNote).slice(0, 78)}…`);
  } else {
    fail(`HOD audit scope: ${hodAudit.body?.meta?.scope}`);
  }

  const hodDenied = await call("hod", "GET", `/audit/denied?${WIDE}`);
  if (hodDenied.status === 403)
    pass("HOD is refused the access-denied investigation trail");
  else fail(`HOD got the denied trail: ${hodDenied.status}`);

  const deanDenied = await call("dean", "GET", `/audit/denied?${WIDE}`);
  if (deanDenied.status === 200)
    pass(`dean reads the denied trail: ${deanDenied.body.meta.total} entries`);
  else fail(`dean denied trail returned ${deanDenied.status}`);

  // A trail for one resource.
  if (deanAudit.body.data?.[0]?.entityRef) {
    const ref = deanAudit.body.data[0].entityRef;
    const trail = await call(
      "dean",
      "GET",
      `/audit/trail?entityRef=${encodeURIComponent(ref)}`
    );
    if (trail.status === 200)
      pass(`resource trail for ${ref}: ${trail.body.data.total} entries`);
    else fail(`resource trail returned ${trail.status}`);
  }

  const studentAudit = await call("student", "GET", `/audit?${WIDE}`);
  if (studentAudit.status === 403) pass("a student is refused the audit trail");
  else fail(`student audit returned ${studentAudit.status}`);

  console.log("");
})().catch((error) => {
  console.error("  FAIL  drill error:", error.message);
  process.exit(1);
});
