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

async function sweep(spec, port) {
  const profile = mkdtempSync(join(tmpdir(), `campusos-${spec.role}-`));
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

  browser.kill();
  await sleep(300);
  return failures;
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
  for (const spec of ROLES) {
    failures += await sweep(spec, port++);
  }

  console.log(
    failures === 0
      ? "\n  PASS  every page behaved as its role's permissions require"
      : `\n  FAIL  ${failures} page(s) did not behave as expected`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
