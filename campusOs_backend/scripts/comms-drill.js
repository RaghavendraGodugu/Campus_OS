#!/usr/bin/env node
/**
 * Live drill: notifications and announcements.
 *
 *     npm run comms:drill
 *
 * Exercises the read side and the audience boundary over real HTTP against a
 * running server, using demo accounts of different roles and departments.
 *
 * The audience checks are the point. A student must not be able to read a notice
 * addressed to faculty — not by listing, and not by pasting the reference
 * straight into the URL.
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
  return body.data.user;
}

async function call(who, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Cookie: jars[who],
      ...(method === "POST" ? { "X-CSRF-Token": csrf[who] } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const post = (who, path, body) => call(who, "POST", path, body ?? {});

(async () => {
  console.log("\nNotifications and announcements drill\n");

  // The return values are unused; each `login` installs the session cookie and
  // CSRF token under its key, which is what the `call` helper reads.
  await Promise.all([
    login("dean", "demo.dean@campusos.local"),
    login("faculty", "demo.faculty@campusos.local"),
    login("accounts", "demo.accounts@campusos.local"),
    login("studentA", "demo.student.democs001@campusos.local"),
    login("studentB", "demo.student.democs002@campusos.local"),
  ]);
  pass("signed in as 5 accounts across roles and departments");

  // ===== 1. The bell finally reads =====
  const unread = await call("studentA", "GET", "/notifications/unread-count");
  if (unread.status === 200) {
    pass(`unread count for a student: ${unread.body.data.unread}`);
  } else {
    fail(`unread count returned ${unread.status}`);
  }

  const inbox = await call("studentA", "GET", "/notifications");
  if (inbox.status === 200) {
    pass(`inbox lists ${inbox.body.meta.total} notification(s)`);
  } else {
    fail(`inbox returned ${inbox.status}`);
  }

  // ===== 2. Only officers may post =====
  const byStudent = await post("studentA", "/announcements", {
    title: "Student trying to post",
    body: "A student should not be able to publish a notice to the college.",
  });
  if (byStudent.status === 403) {
    pass("a student cannot post an announcement");
  } else {
    fail(`student post returned ${byStudent.status}, expected 403`);
  }

  const byFaculty = await post("faculty", "/announcements", {
    title: "Faculty trying to post",
    body: "Faculty may read announcements but should not publish them.",
  });
  if (byFaculty.status === 403) {
    pass("faculty cannot post, though faculty may read");
  } else {
    fail(`faculty post returned ${byFaculty.status}, expected 403`);
  }

  // ===== 3. A notice to everyone =====
  const toAll = await post("dean", "/announcements", {
    title: "Annual day rehearsal",
    body: "Rehearsal for the annual day begins at 4pm in the main auditorium.",
    priority: "IMPORTANT",
  });
  if (toAll.status !== 201) {
    fail(`dean post returned ${toAll.status}: ${toAll.body?.message}`);
    process.exit(1);
  }
  const allRef = toAll.body.data.announcement.reference;
  pass(
    `dean posted ${allRef} to everyone (${toAll.body.data.announcement.notifiedCount} notified)`
  );

  for (const who of ["faculty", "accounts", "studentA", "studentB"]) {
    const list = await call(who, "GET", "/announcements");
    const found = list.body.data?.some((a) => a.reference === allRef);
    if (found) pass(`${who} sees the everyone-notice`);
    else fail(`${who} does not see the everyone-notice`);
  }

  // ===== 4. A notice to accounts only =====
  const toAccounts = await post("dean", "/announcements", {
    title: "Accounts reconciliation window",
    body: "Month-end reconciliation runs on Saturday from 9am to 5pm.",
    audience: { scope: "ROLES", roles: ["ACCOUNTS_ADMIN"] },
  });
  if (toAccounts.status !== 201) {
    fail(
      `accounts-scoped post returned ${toAccounts.status}: ${toAccounts.body?.message}`
    );
    process.exit(1);
  }
  const accountsRef = toAccounts.body.data.announcement.reference;
  pass(`dean posted ${accountsRef} addressed to accounts staff only`);

  // ===== 5. The audience boundary =====
  const accountsList = await call("accounts", "GET", "/announcements");
  if (accountsList.body.data?.some((a) => a.reference === accountsRef)) {
    pass("accounts staff see the accounts notice");
  } else {
    fail("accounts staff cannot see their own notice");
  }

  for (const [who, label] of [
    ["faculty", "faculty"],
    ["studentA", "a student"],
    ["studentB", "another student"],
  ]) {
    const list = await call(who, "GET", "/announcements");
    if (list.body.data?.some((a) => a.reference === accountsRef)) {
      fail(`${label} can see an accounts-only notice`);
    } else {
      pass(`${label} cannot see the accounts-only notice in the list`);
    }
  }

  // The direct-reference fetch must be filtered by the same rule as the list.
  // Otherwise the audience filter is only a list-time convenience.
  for (const [who, label] of [
    ["faculty", "faculty"],
    ["studentA", "a student"],
  ]) {
    const direct = await call(who, "GET", `/announcements/${accountsRef}`);
    if (direct.status === 404) {
      pass(`${label} gets 404 fetching ${accountsRef} directly`);
    } else {
      fail(`${label} fetched ${accountsRef} by reference (status ${direct.status})`);
    }
  }

  // ===== 6. A notice the accounts-only reader can open =====
  const accountsDirect = await call("accounts", "GET", `/announcements/${accountsRef}`);
  if (accountsDirect.status === 200) {
    pass("accounts staff can open their own notice by reference");
  } else {
    fail(`accounts direct fetch returned ${accountsDirect.status}`);
  }

  // ===== 7. The bell, and marking read =====
  const bell = await call("accounts", "GET", "/notifications/unread-count");
  if (bell.body.data?.unread > 0) {
    pass(`accounts inbox shows ${bell.body.data.unread} unread`);

    const list = await call("accounts", "GET", "/notifications?unreadOnly=true");
    const first = list.body.data?.[0];
    if (first) {
      const marked = await post("accounts", `/notifications/${first.id}/read`);
      if (marked.status === 200 && marked.body.data.updated) {
        pass(`marked a notification read; unread now ${marked.body.data.unread}`);
      } else {
        fail(
          `marking read returned ${marked.status} updated=${marked.body.data?.updated}`
        );
      }
    }
  } else {
    fail("accounts inbox has no unread notifications after a direct post");
  }

  // ===== 8. Nobody may read another's inbox =====
  const aInbox = await call("studentA", "GET", "/notifications");
  const bInbox = await call("studentB", "GET", "/notifications");
  const aIds = new Set((aInbox.body.data ?? []).map((n) => n.id));
  const overlap = (bInbox.body.data ?? []).filter((n) => aIds.has(n.id));

  if (overlap.length === 0) {
    pass("two students share no notifications");
  } else {
    fail(`two students share ${overlap.length} notification(s)`);
  }

  // ===== 9. Archive =====
  const archived = await post("dean", `/announcements/${allRef}/archive`);
  if (archived.status === 200) {
    pass(`archived ${allRef}`);
  } else {
    fail(`archive returned ${archived.status}`);
  }

  const afterArchive = await call("studentA", "GET", "/announcements");
  if (afterArchive.body.data?.some((a) => a.reference === allRef)) {
    fail("an archived notice is still listed");
  } else {
    pass("the archived notice is gone from the list");
  }

  const archivedDirect = await call("dean", "GET", `/announcements/${allRef}`);
  if (archivedDirect.status === 404) {
    pass("the archived notice is not readable by reference either");
  } else {
    fail(`archived notice still readable (status ${archivedDirect.status})`);
  }

  console.log("");
})().catch((error) => {
  console.error("  FAIL  drill error:", error.message);
  process.exit(1);
});
