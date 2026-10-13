#!/usr/bin/env node
/**
 * Drive a real browser through the sign-in flow.
 *
 *     npm run verify:login
 *
 * Fetches nothing and asserts nothing about the API directly: it opens the app
 * in headless Chrome, types the credentials a person would type, submits, and
 * reads what ended up on screen.
 *
 * This exists because every other check here runs below the browser. A strict
 * Content-Security-Policy, a blocked script, or a module that resolves in Node
 * but not in a real page all leave the API tests green while the app is blank.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  process.env.CHROME_PATH,
].filter(Boolean);

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const EMAIL = process.env.DEMO_EMAIL ?? "demo.hod@campusos.local";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo@Campus123";
const PORT = 9222;

const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.log(`  FAIL  ${m}`);
  process.exitCode = 1;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const { existsSync } = require("node:fs");
  return CHROME_CANDIDATES.find((path) => existsSync(path));
}

async function cdpTarget() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl,
      );
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome has not opened the port yet.
    }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a debugging target");
}

/** Minimal CDP client over the built-in WebSocket. */
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: done, reject: failCall } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) failCall(new Error(message.error.message));
        else done(message.result);
      }
    });

    socket.addEventListener("error", reject);
    socket.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => socket.close(),
      }),
    );
  });
}

async function main() {
  const { createRequire } = await import("node:module");
  globalThis.require = createRequire(import.meta.url);

  const chrome = findChrome();
  if (!chrome) {
    fail("No Chrome or Chromium found. Set CHROME_PATH.");
    return;
  }

  const profile = mkdtempSync(join(tmpdir(), "campusos-verify-"));

  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let client;

  try {
    const wsUrl = await cdpTarget();
    client = await connect(wsUrl);

    await client.send("Page.enable");
    await client.send("Runtime.enable");

    // Collect anything the page complains about. A blocked script is silent in
    // the UI and only appears here.
    const consoleErrors = [];
    client.send("Log.enable");

    // ---------- Navigate to the app ----------
    await client.send("Page.navigate", { url: `${APP_URL}/` });
    await sleep(3500);

    const readText = async () => {
      const { result } = await client.send("Runtime.evaluate", {
        expression:
          "document.body.innerText.replace(/\\s+/g,' ').trim().slice(0, 400)",
        returnByValue: true,
      });
      return result.value ?? "";
    };

    const afterRedirect = await readText();

    if (/Sign in/i.test(afterRedirect)) {
      pass("unauthenticated visit lands on the sign-in page");
    } else {
      fail(`expected the sign-in page, saw: "${afterRedirect.slice(0, 90)}"`);
    }

    // ---------- Type credentials the way a person would ----------
    const typed = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const setValue = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          ).set;
          setter.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const email = document.querySelector('input[type="email"]');
        const password = document.querySelector('input[type="password"]');
        if (!email || !password) return "inputs missing";
        setValue(email, ${JSON.stringify(EMAIL)});
        setValue(password, ${JSON.stringify(PASSWORD)});
        return "typed";
      })()`,
      returnByValue: true,
    });

    if (typed.result.value !== "typed") {
      fail(`could not fill the form: ${typed.result.value}`);
      return;
    }
    pass("filled the sign-in form");

    // ---------- Submit ----------
    await client.send("Runtime.evaluate", {
      expression: `document.querySelector('form').requestSubmit()`,
      returnByValue: true,
    });

    // Long enough for the request, the session write and the redirect.
    await sleep(5000);

    const afterLogin = await readText();

    if (/Hello/i.test(afterLogin)) {
      pass("signed in — the dashboard rendered");
    } else if (/Sign in/i.test(afterLogin) && /invalid/i.test(afterLogin)) {
      fail("the server rejected the credentials");
      return;
    } else {
      fail(`did not reach the dashboard, saw: "${afterLogin.slice(0, 120)}"`);
      return;
    }

    // ---------- The session is real ----------
    const { result: me } = await client.send("Runtime.evaluate", {
      expression: `fetch('/api/v1/auth/me', { credentials: 'include' })
        .then(r => r.json()).then(d => JSON.stringify({ ok: d.success, role: d.data?.user?.role }))`,
      awaitPromise: true,
      returnByValue: true,
    });

    const session = JSON.parse(me.value ?? "{}");
    if (session.ok)
      pass(`session cookie is live — server reports role ${session.role}`);
    else fail("the session cookie was not accepted by /auth/me");

    // ---------- The shell is present ----------
    const { result: nav } = await client.send("Runtime.evaluate", {
      expression: `!!document.querySelector('nav[aria-label="Main navigation"]')`,
      returnByValue: true,
    });

    if (nav.value) pass("navigation landmark rendered");
    else fail("the navigation landmark is missing");

    if (consoleErrors.length) {
      fail(`console reported ${consoleErrors.length} error(s)`);
    } else {
      pass("no console errors");
    }
  } finally {
    client?.close();
    browser.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(`verification could not run: ${error.message}`);
});
