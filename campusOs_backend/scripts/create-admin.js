#!/usr/bin/env node
/**
 * Create the first SUPER_ADMIN account.
 *
 * Run once after the first deployment:
 *
 *   npm run create-admin
 *
 * ## Why a script and not a registration endpoint
 *
 * An open "first user becomes admin" endpoint is a real attack surface: whoever
 * reaches an unconfigured deployment first claims super admin. Reading
 * credentials from the environment keeps account creation entirely out of the
 * HTTP surface, and once one super admin exists this script is only usable by
 * someone with access to `.env` on the server.
 *
 * Refuses to overwrite an existing account.
 */

const readline = require("readline");
const mongoose = require("mongoose");

const { connectDB, disconnectDB } = require("../src/config/db");
const { getEnv } = require("../src/config/env");
const User = require("../src/models/User");
const { ROLES } = require("../src/config/constants");
const { passwordSchema } = require("../src/validators/auth.validator");

/** Validate a password against the shared policy, printing Zod's messages. */
function assertPasswordPolicy(password) {
  const result = passwordSchema.safeParse(password);
  if (result.success) return;

  process.stderr.write("\nPassword does not meet the policy:\n");
  result.error.issues.forEach((issue) => {
    process.stderr.write(`  - ${issue.message}\n`);
  });
  process.exit(1);
}

/**
 * Prompt for a value without echoing it, so a password is not left in the
 * scrollback or a shell history entry.
 */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const onAnswer = (answer) => {
      readline.moveCursor(process.stdout, 0, -1);
      readline.clearLine(process.stdout, 1);
      process.stdout.write(question + "********\n");
      rl.close();
      resolve(answer);
    };
    process.stdout.write(question);
    rl.question("", onAnswer);
    rl._writeToOutput = (str) => {
      if (str.includes(question)) rl.output.write(str);
    };
  });
}

async function main() {
  let env;
  try {
    env = getEnv();
  } catch (error) {
    process.stderr.write(`\n${error.message}\n\n`);
    process.exit(1);
  }

  process.stdout.write("\n=== CampusOS — create SUPER_ADMIN ===\n\n");

  const email = (process.env.ADMIN_EMAIL || env.ADMIN_EMAIL || "").trim().toLowerCase();
  const name = (process.env.ADMIN_NAME || env.ADMIN_NAME || "Super Admin").trim();
  let password = process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || "";

  if (!email) {
    process.stderr.write(
      "ADMIN_EMAIL is not set. Add it to campusOs_backend/.env and retry.\n\n"
    );
    process.exit(1);
  }

  if (!password) {
    password = await askHidden("Password: ");
    const confirm = await askHidden("Confirm password: ");
    if (password !== confirm) {
      process.stderr.write("\nPasswords do not match.\n\n");
      process.exit(1);
    }
  }

  assertPasswordPolicy(password);

  await connectDB();

  const existing = await User.findOne({ email });
  if (existing) {
    process.stderr.write(
      `\nAn account already exists for ${email} (role ${existing.role}).\n` +
        "Nothing was changed. Use this script only for the initial account.\n\n"
    );
    await disconnectDB();
    process.exit(1);
  }

  const user = new User({
    email,
    fullName: name,
    role: ROLES.SUPER_ADMIN,
    isActive: true,
  });
  await user.setPassword(password);
  await user.save();

  process.stdout.write(
    `\nCreated SUPER_ADMIN ${user.email}\n` +
      "Change this password immediately after signing in.\n\n"
  );

  await disconnectDB();
  mongoose.connection.close();
  process.exit(0);
}

main().catch(async (error) => {
  process.stderr.write(`\nFailed to create admin: ${error.message}\n\n`);
  try {
    await disconnectDB();
  } catch {
    // Already disconnected.
  }
  process.exit(1);
});
