import { randomBytes, scryptSync } from "node:crypto";

// Supply through stdin to avoid putting a password in process arguments/history.
let password = "";
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, "");
if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password)
  || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
  throw new Error("Admin password must be 12–128 characters with upper/lowercase letters, a digit and a symbol.");
}
const salt = randomBytes(16).toString("hex");
const encoded = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
// Next's dotenv expansion requires escaping dollar signs, even inside quotes.
console.log(process.argv.includes("--dotenv") ? `ADMIN_PASSWORD_HASH=${encoded.replaceAll("$", "\\$")}` : encoded);
