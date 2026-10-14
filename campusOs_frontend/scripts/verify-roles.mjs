#!/usr/bin/env node
/**
 * Visit every page as every role, in a real browser.
 *
 *     npm run verify:roles
 *
 * Signs in as a student, a HOD and the Dean, then opens each role's pages and
 * reports what rendered.
 *
 * ## Why this exists
 *
 * Everything else in the suite runs below the browser, so a class of bugs is
 * invisible to it:
 *
 *  - a permission string that does not exist in the server's registry, making
 *    a page unopenable by anyone
 *  - gating a route on the department-scoped permission, which locks out the
 *    institution-scoped roles that legitimately hold only the other variant
 *  - a base URL missing its version segment, so every request 404s
 *
 * All three were found by driving Chrome rather than by any unit test. This
 * script is kept because they will happen again.
 *
 * A page that correctly refuses a role is reported as `refused`, not as a
 * failure: a student reaching a HOD page *should* be turned away.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo@Campus123";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean);

const ROLES = [
  {
    role: "student",
    email: "demo.student.democs001@campusos.local",
    pages: [
      ["dashboard", "/", "ok"],
      // Every role has a profile, so every role is checked on it.
      ["profile", "/profile", "ok"],
      ["my requests", "/requests", "ok"],
      ["new request", "/requests/new", "ok"],
      ["my complaints", "/complaints", "ok"],
      ["new complaint", "/complaints/new", "ok"],
      ["my certificates", "/certificates", "ok"],
      ["apply for a certificate", "/certificates/new", "ok"],
      ["invoices", "/finance/invoices", "ok"],
      ["refunds", "/finance/refunds", "ok"],
      ["announcements", "/announcements", "ok"],
      // Correctly refused: certificate issuance is not a student page.
      ["audit (staff)", "/audit", "refused"],
    ],
  },
  {
    role: "hod",
    email: "demo.hod@campusos.local",
    pages: [
      ["dashboard", "/", "ok"],
      ["profile", "/profile", "ok"],
      ["assigned requests", "/management/requests", "ok"],
      ["reports", "/reports", "ok"],
      ["audit", "/audit", "ok"],
      ["announcements", "/announcements", "ok"],
      // Correctly refused: own-requests is the student's view.
      ["student requests", "/requests", "refused"],
    ],
  },
  {
    /*
     * The super administrator, because the administration screens are
     * unreachable from every other role. Their absence from this sweep is why a
     * whole section of the application could be broken without anything here
     * turning red.
     */
    role: "admin",
    email: "demo.admin@campusos.local",
    pages: [
      ["dashboard", "/", "ok"],
      ["profile", "/profile", "ok"],
      ["people", "/admin/people", "ok"],
      ["departments", "/admin/departments", "ok"],
      ["programmes", "/admin/programmes", "ok"],
      ["services", "/admin/services", "ok"],
      ["import students", "/admin/students", "ok"],
      ["reports", "/reports", "ok"],
      ["audit", "/audit", "ok"],
    ],
  },
  {
    role: "dean",
    email: "demo.dean@campusos.local",
    pages: [
      ["dashboard", "/", "ok"],
      ["profile", "/profile", "ok"],
      ["reports", "/reports", "ok"],
      ["audit", "/audit", "ok"],
      ["complaints", "/management/complaints", "ok"],
      ["certificates", "/management/certificates", "ok"],
      ["post notice", "/management/announcements", "ok"],
    ],
  },
];

/**
 * The `ErrorState` component marks itself with `role="alert"`.
 *
 * Asking the DOM for that attribute, rather than hunting for prose, is the whole
 * point. This script once reported a profile page as PASS while it was
 * displaying "Profile not available — Route GET /api/v1/profile does not
 * exist": the page rendered, so the script saw text, and the words it happened
 * to look for were not on the page. Widening the word list then made it worse —
 * "not available" turned out to be a perfectly normal value in the audit log,
 * and a healthy page was reported as broken.
 *
 * A word list will always drift from the components. A role attribute will not.
 * A verification script that cannot fail is worse than none, because it gets
 * believed.
 */
const ERROR_SELECTOR = 'main [role="alert"], [role="alert"][class*="red"]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const findChrome = () => CHROME_CANDIDATES.find((path) => existsSync(path));

/**
 * Start a headless Chrome and hand back a small CDP client.
 *
 * Extracted because two callers need it: the per-role sweeps, and the public
 * verification check, which must run with no session and so cannot reuse a
 * browser that has signed in.
 */
async function launchBrowser(name, port) {
  const profile = mkdtempSync(join(tmpdir(), `campusos-${name}-`));
  const browser = spawn(
    findChrome(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let wsUrl;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      const page = targets.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl,
      );
      if (page) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }

  const socket = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();
  await new Promise((resolve) => socket.addEventListener("open", resolve));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = id++;
      pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });

  const evaluate = async (expression) =>
    (
      await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;

  const go = async (url, ms = 4200) => {
    await send("Page.navigate", { url: APP + url });
    await sleep(ms);
  };

  const mainText = () =>
    evaluate(`(document.querySelector('main')||{}).innerText||'(no main)'`);

  await send("Page.enable");

  /**
   * Resize the page. Used by the narrow-width check, which needs the same
   * browser to be a phone and then a desktop without signing out in between.
   */
  const setViewport = async (width, height, mobile) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
  };

  const close = async () => {
    browser.kill();
    await sleep(300);
  };

  return { evaluate, go, mainText, send, setViewport, close };
}

async function sweep(spec, port) {
  const { evaluate, go, mainText, send, close } = await launchBrowser(
    spec.role,
    port,
  );

  await send("Runtime.enable");

  await go("/", 3800);
  await evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const email = document.querySelector('input[type="email"]');
    const password = document.querySelector('input[type="password"]');
    if (!email || !password) return 'no form';
    set.call(email, ${JSON.stringify(spec.email)});
    email.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(password, ${JSON.stringify(PASSWORD)});
    password.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').requestSubmit();
    return 'ok';
  })()`);
  await sleep(5000);

  const signedIn = await evaluate(
    `/Hello|Sign out/i.test(document.body.innerText)`,
  );
  console.log(
    `\n${spec.role.toUpperCase()} — ${signedIn ? "signed in" : "SIGN-IN FAILED"}`,
  );

  let failures = signedIn ? 0 : 1;

  if (signedIn) {
    for (const [label, url, expected] of spec.pages) {
      await go(url);
      const text = (await mainText()).replace(/\s+/g, " ");
      const refused = /do not have access/i.test(text);
      const alertText = await evaluate(
        `Array.from(document.querySelectorAll(${JSON.stringify(ERROR_SELECTOR)}))
           .map((node) => node.innerText.replace(/\\s+/g, " ").trim())
           .join(" | ")`,
      );
      const broken = alertText.length > 0;
      const heading =
        (text.match(/^([A-Z][\w' ]{3,44})/) || [])[1] || text.slice(0, 44);

      const actual = broken ? "error" : refused ? "refused" : "ok";
      const good = actual === expected;

      if (!good) failures += 1;
      console.log(
        `   ${good ? "PASS" : "FAIL"}  ${label.padEnd(16)} [${actual}] ${heading}`,
      );
      if (process.env.VERIFY_DEBUG && alertText) {
        console.log(`        alert: ${alertText.slice(0, 160)}`);
      }
    }
  }

  await close();
  return failures;
}

/**
 * Overflow at phone widths.
 *
 * Nothing about a page breaks loudly when it is too wide for a phone: the card
 * just runs off the side and the reader scrolls sideways, with nothing
 * indicating there is more. And `scrollWidth > clientWidth` is exactly the
 * signal a CSS layout review misses — a `flex` row without `min-w-0` looks
 * fine at 1440px and is broken at 375.
 *
 * The threshold is 375 because that is the narrowest phone this is likely to
 * meet, and 320 is checked too: a page that only fits 375 usually fails 320 by
 * a handful of pixels that nobody looks at until someone opens it on an old
 * handset.
 */
async function checkNarrowWidths(port) {
  const widths = [375, 320];
  const pages = [
    "/",
    "/requests",
    "/complaints",
    "/certificates",
    "/certificates/new",
  ];

  const { evaluate, go, setViewport, close } = await launchBrowser(
    "narrow",
    port,
  );
  const problems = [];

  for (const width of widths) {
    await setViewport(width, 900, false);

    for (const path of pages) {
      await go(path, 1800);

      const result = await evaluate(`(() => {
        const doc = document.documentElement;
        const overflow = doc.scrollWidth > doc.clientWidth + 1;
        if (!overflow) return JSON.stringify({ overflow: false });
        // Name the widest offenders, so the failure is actionable.
        const wide = [];
        document.querySelectorAll('main *').forEach((el) => {
          const box = el.getBoundingClientRect();
          if (getComputedStyle(el).position === 'fixed') return;
          if (box.right > doc.clientWidth + 1) {
            wide.push(el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 60));
          }
        });
        return JSON.stringify({
          overflow: true,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          wide: wide.slice(0, 3),
        });
      })()`);

      const parsed = JSON.parse(result);
      if (parsed.overflow) {
        problems.push(
          `${path} at ${width}px: scrolls to ${parsed.scrollWidth} in ${parsed.clientWidth}`,
        );
        for (const wide of parsed.wide) problems.push(`    ${wide}`);
      }
    }
  }

  await close();

  console.log("\nNARROW — 375px and 320px");
  if (problems.length === 0) {
    console.log(
      `   PASS  ${pages.length} pages fit with no sideways scrolling`,
    );
    return 0;
  }

  console.log(`   FAIL  ${problems.length} problem(s):`);
  for (const problem of problems) console.log(`     ${problem}`);
  return problems.length;
}

/**
 * The public verification page, checked with no session at all.
 *
 * This is the one page a non-user can reach, and its whole purpose is being
 * usable by someone holding a piece of paper who will never sign in. A guard
 * added here "for consistency" would break it invisibly: the route is outside
 * the shell, so no role sweep would notice, and the page would simply redirect
 * to a login that person cannot pass.
 */
async function checkPublicVerification(port) {
  const { evaluate, go, mainText, close } = await launchBrowser("public", port);

  await go("/verify");
  const text = (await mainText()).replace(/\s+/g, " ");

  const reachable = await evaluate(
    `/genuine|verification code/i.test(document.body.innerText)`,
  );
  const stayedOnVerify = await evaluate(`location.pathname === "/verify"`);

  // The second public page. Structurally the same risk as /verify: it sits
  // outside the shell, so a guard added to it "for consistency" would be
  // invisible to every role sweep and would quietly lock out exactly the people
  // it is for.
  await go("/grievance");
  const grievanceReachable = await evaluate(
    `/what anonymity costs|tracking code/i.test(document.body.innerText)`,
  );
  const stayedOnGrievance = await evaluate(
    `location.pathname === "/grievance"`,
  );
  const signInShown = await evaluate(
    `/password/i.test(document.body.innerText)`,
  );

  await close();

  const good =
    reachable &&
    stayedOnVerify &&
    !signInShown &&
    grievanceReachable &&
    stayedOnGrievance;

  console.log(
    `\nPUBLIC — no session\n   ${reachable && stayedOnVerify && !signInShown ? "PASS" : "FAIL"}  verify (public) [ok] reachable without signing in` +
      `\n   ${grievanceReachable && stayedOnGrievance ? "PASS" : "FAIL"}  grievance (public) [ok] reachable without signing in`,
  );

  if (!good) console.log(`        saw: ${text.slice(0, 120)}`);

  return good ? 0 : 1;
}

async function main() {
  if (!findChrome()) {
    console.log("  FAIL  no Chrome or Chromium found — set CHROME_PATH");
    process.exitCode = 1;
    return;
  }

  console.log(`\nBrowser sweep against ${APP}`);

  let failures = 0;
  let port = 9360;
  failures += await checkPublicVerification(port++);
  failures += await checkNarrowWidths(port++);
  for (const spec of ROLES) {
    failures += await sweep(spec, port++);
  }

  console.log(
    failures === 0
      ? "\n  PASS  every page behaved as its role's permissions require, and the public page needs no account"
      : `\n  FAIL  ${failures} page(s) did not behave as expected`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
