import { hashPassword } from "./credentials.js";

async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("Run this command in an interactive terminal.");
  }

  const input = process.stdin;
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();
  process.stdout.write(prompt);

  return new Promise((resolve, reject) => {
    let password = "";
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Password input cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = Array.from(password).slice(0, -1).join("");
        } else if (character >= " ") {
          password += character;
        }
      }
    };
    input.on("data", onData);
  });
}

async function main(): Promise<void> {
  const password = await readPassword("Password (12+ characters): ");
  const confirmation = await readPassword("Confirm password: ");
  if (password !== confirmation) {
    throw new Error("Passwords do not match.");
  }
  console.log(await hashPassword(password));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Could not hash password.");
  process.exitCode = 1;
});
