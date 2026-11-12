import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { cruise, type ICruiseOptions } from "dependency-cruiser";
import { beforeAll, describe, expect, it } from "vitest";
import { surfacePaths } from "./surface.mjs";

const ROOT = resolve(import.meta.dirname, "..");

/**
 * The entry points whose imports decide what is signed, what the approval
 * preview shows, where keys live, what a page can reach, and what the
 * main wallet UI shows.
 */
const ROOTS = [
  "apps/extension/entrypoints/background/index.ts",
  "apps/extension/entrypoints/keyring/main.ts",
  "apps/mobile/src/worker/index.ts",
  "packages/runtime/src/handlers/approval.ts",
  "packages/runtime/src/handlers/transfer.ts",
  "packages/runtime/src/handlers/key-session.ts",
  "packages/runtime/src/dispatch/methods.ts",
  "packages/app/src/approval/ApprovalRoot.tsx",
  "packages/provider/src/index.ts",
  "apps/extension/entrypoints/content/index.ts",
  "apps/extension/entrypoints/approval/index.tsx",
  "apps/extension/entrypoints/passkey/index.tsx",
  "apps/extension/entrypoints/connect/index.tsx",
  "apps/extension/entrypoints/popup/index.tsx",
  "apps/extension/entrypoints/sidepanel/index.tsx",
  "apps/mobile/src/main.tsx",
];

interface Exemption {
  line: string;
  path: string;
  reason: string;
}

function parseExemptions(text: string): Exemption[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [path = "", ...reason] = line.split(/\s+/);
      return { line, path, reason: reason.join(" ") };
    });
}

const surface = surfacePaths(readFileSync(resolve(ROOT, "security/surface.txt"), "utf8"));
const exemptions = parseExemptions(readFileSync(resolve(ROOT, "security/surface-exempt.txt"), "utf8"));
const covers = (path: string, file: string) => (path.endsWith("/") ? file.startsWith(path) : file === path);

let closure: string[] = [];

beforeAll(async () => {
  const config = createRequire(import.meta.url)(resolve(ROOT, ".dependency-cruiser.cjs")) as { options: ICruiseOptions };
  const result = await cruise(ROOTS, { ...config.options, baseDir: ROOT, validate: false });
  if (typeof result.output === "string") throw new Error("dependency-cruiser returned text, not modules");
  closure = result.output.modules.map((module) => module.source).filter((source) => /^(packages|apps)\//.test(source));
});

describe("security surface completeness", () => {
  it("lists or exempts every file the entry points import", () => {
    expect(closure.length).toBeGreaterThan(300);
    const unplaced = closure.filter(
      (file) => !surface.some((path) => covers(path, file)) && !exemptions.some(({ path }) => covers(path, file)),
    );
    expect(unplaced.sort(), "add each file to security/surface.txt (and CODEOWNERS) or to surface-exempt.txt with a reason").toEqual([]);
  });

  it("gives every exemption a reason, an existing path and no overlap with the surface", () => {
    for (const { line, path, reason } of exemptions) {
      expect(reason, line).not.toBe("");
      const full = resolve(ROOT, path);
      expect(existsSync(full), `${path} does not exist`).toBe(true);
      expect(statSync(full).isDirectory(), `${path}: trailing / must match being a directory`).toBe(path.endsWith("/"));
      expect(surface.filter((listed) => covers(listed, path) || covers(path, listed)), line).toEqual([]);
    }
  });

  it("exempts only files the entry points import", () => {
    const stale = exemptions.filter(({ path }) => !closure.some((file) => covers(path, file)));
    expect(stale.map(({ line }) => line)).toEqual([]);
  });
});
