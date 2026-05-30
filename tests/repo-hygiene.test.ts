import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")) as T;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface PackageLockJson {
  packages?: Record<string, PackageJson>;
}

const packageJson = readJson<PackageJson>("package.json");

describe("package scripts", () => {
  test("local file references exist", () => {
    const missing: string[] = [];

    for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
      const matches = command.matchAll(
        /(?:^|\s)(scripts\/[^\s'"`]+|src\/[^\s'"`]+|tests\/[^\s'"`]+)/g,
      );

      for (const match of matches) {
        const localPath = match[1];
        if (!localPath || localPath.includes("*")) continue;
        if (!fs.existsSync(path.join(root, localPath))) {
          missing.push(`${scriptName}: ${localPath}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("README commands", () => {
  test("npm run examples reference declared scripts", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const scriptNames = [...readme.matchAll(/\bnpm run ([\w:-]+)/g)].map(
      (match) => match[1],
    );
    const missing = scriptNames.filter(
      (scriptName): scriptName is string =>
        scriptName !== undefined && packageJson.scripts?.[scriptName] === undefined,
    );

    expect(missing).toEqual([]);
  });
});

describe("package lock", () => {
  test("is committed and not ignored", () => {
    expect(fs.existsSync(path.join(root, "package-lock.json"))).toBe(true);

    const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    const ignored = gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));

    expect(ignored).not.toContain("package-lock.json");
  });

  test("root dependency metadata matches package.json", () => {
    const lock = readJson<PackageLockJson>("package-lock.json");
    const rootPackage = lock.packages?.[""];

    expect(rootPackage?.dependencies ?? {}).toEqual(packageJson.dependencies ?? {});
    expect(rootPackage?.devDependencies ?? {}).toEqual(
      packageJson.devDependencies ?? {},
    );
  });
});
