import type { FileKind } from '../types.js';
import { matchesAny } from './glob.js';

const CODE_EXT = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /(^|\/)(__tests__|tests?)\//;
const SNAPSHOT = /(^|\/)__snapshots__\/|\.snap$/;
const CI = /^\.github\/workflows\/|^\.gitlab-ci\.ya?ml$|^\.circleci\/|^azure-pipelines\.ya?ml$/;
const CONFIG =
  /(^|\/)(package\.json|tsconfig[^/]*\.json|\.mocharc[^/]*|\.nycrc[^/]*|\.c8rc[^/]*|(vitest|vite|jest|stryker|playwright)\.config\.[cm]?[jt]s)$/;

export function classify(path: string, testPatterns: readonly string[] = []): FileKind {
  if (SNAPSHOT.test(path)) return 'snapshot';
  if (CI.test(path)) return 'ci';
  if (CONFIG.test(path)) return 'config';
  if (matchesAny(path, testPatterns)) return 'test';
  if (CODE_EXT.test(path)) return TEST_FILE.test(path) || TEST_DIR.test(path) ? 'test' : 'source';
  return 'other';
}

export function isJsLike(path: string): boolean {
  return CODE_EXT.test(path);
}
