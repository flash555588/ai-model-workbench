/// <reference types="obsidian" />

/**
 * Safe wrappers for Node.js built-in modules.
 *
 * These are only available in the Electron desktop environment.
 * On mobile, every function returns a safe fallback or throws a clear error.
 */

type FsPromises = typeof import("node:fs/promises");
type NodePath = typeof import("node:path");
type NodeChildProcess = typeof import("node:child_process");
type NodeOs = typeof import("node:os");
type RuntimeRequire = <T = unknown>(id: string) => T;
type RuntimeWindow = Window & { require?: RuntimeRequire; process?: RuntimeProcess };
type WriteFileOptions = Parameters<FsPromises["writeFile"]>[2];
type WriteFileEncoding = Extract<NonNullable<WriteFileOptions>, { encoding?: unknown }>["encoding"];

export interface RuntimeProcess {
  platform?: string;
  env?: Record<string, string | undefined>;
}

function getRuntimeRequire(): RuntimeRequire | undefined {
  if (!("require" in activeWindow)) {
    return undefined;
  }
  return (activeWindow as RuntimeWindow).require;
}

export function getRuntimeProcess(): RuntimeProcess | undefined {
  if (!("process" in activeWindow)) {
    return undefined;
  }
  return (activeWindow as RuntimeWindow).process;
}

// Node.js builtins must be loaded dynamically — unavailable on mobile/web
function tryRequire<T>(id: string): T | null {
  const runtimeRequire = getRuntimeRequire();
  if (!runtimeRequire) {
    return null;
  }
  try {
    return runtimeRequire<T>(id);
  } catch {
    return null;
  }
}

const fsPromises = tryRequire<FsPromises>("node:fs/promises");
const fsMod = tryRequire<typeof import("node:fs")>("node:fs");
const pathMod = tryRequire<NodePath>("node:path");
const cpMod = tryRequire<NodeChildProcess>("node:child_process");
const osMod = tryRequire<NodeOs>("node:os");

function throwIfNull<T>(value: T | null, moduleName: string): T {
  if (value === null) {
    throw new Error(`${moduleName} is not available in this environment (mobile or web).`);
  }
  return value;
}

// ── fs/promises ──────────────────────────────────────────────────

export function access(path: string, mode?: number): Promise<void> {
  return throwIfNull(fsPromises, "node:fs/promises").access(path, mode);
}

export function readFile(path: string): Promise<Uint8Array> {
  return throwIfNull(fsPromises, "node:fs/promises").readFile(path);
}

export function writeFile(path: string, data: string, encoding: WriteFileEncoding): Promise<void> {
  return throwIfNull(fsPromises, "node:fs/promises").writeFile(path, data, { encoding });
}

export function mkdir(path: string, opts: { recursive: boolean }): Promise<string | undefined> {
  return throwIfNull(fsPromises, "node:fs/promises").mkdir(path, opts);
}

export function rm(path: string, opts: { force: boolean }): Promise<void> {
  return throwIfNull(fsPromises, "node:fs/promises").rm(path, opts);
}

export function stat(path: string): Promise<import("node:fs").Stats> {
  return throwIfNull(fsPromises, "node:fs/promises").stat(path);
}

// ── fs constants ─────────────────────────────────────────────────

export const F_OK: number = fsMod?.constants.F_OK ?? 0;
export const X_OK: number = fsMod?.constants.X_OK ?? 0;

// ── path ─────────────────────────────────────────────────────────

export function pathJoin(...segments: string[]): string {
  return throwIfNull(pathMod, "node:path").join(...segments);
}

export function pathDirname(p: string): string {
  return throwIfNull(pathMod, "node:path").dirname(p);
}

export function pathBasename(p: string, ext?: string): string {
  return throwIfNull(pathMod, "node:path").basename(p, ext);
}

export function pathExtname(p: string): string {
  return throwIfNull(pathMod, "node:path").extname(p);
}

export function pathNormalize(p: string): string {
  return throwIfNull(pathMod, "node:path").normalize(p);
}

export function pathIsAbsolute(p: string): boolean {
  return throwIfNull(pathMod, "node:path").isAbsolute(p);
}

export const pathDelimiter: string = pathMod?.delimiter ?? ":";

// ── child_process ────────────────────────────────────────────────

export function execFile(
  command: string,
  args: string[],
  opts: Record<string, unknown>,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
): void {
  throwIfNull(cpMod, "node:child_process").execFile(command, args, opts, callback);
}

// ── os ───────────────────────────────────────────────────────────

export function osTmpdir(): string {
  return throwIfNull(osMod, "node:os").tmpdir();
}
