/**
 * accountExportFileService — injectable adapter for writing the data-export file
 * and handing it to the OS share sheet.
 *
 * Design mirrors pdfService.ts (createPdfService / createProductionPdfService):
 *  - `createAccountExportFileService(writeFn, shareFn, deleteFn?)` — pure factory,
 *    injectable and Node-testable with no native modules.
 *  - `createProductionAccountExportFileService()` — dynamic-`require()`s
 *    `expo-file-system` and `expo-sharing` so the module can be imported in Jest
 *    without crashing on missing native bridges.
 *
 * Security (AR-AC-22..25):
 *  - The JSON export body is HIGHLY sensitive (SD-1…SD-12 aggregate).
 *    It is NEVER logged (console.log / debug / warn) anywhere in this module.
 *  - The file is written to `cacheDirectory` only — never to Downloads,
 *    documentDirectory, or any public storage (AR-AC-01, E1).
 *  - The filename is a neutral date-stamped name with NO PII (AR-AC-25):
 *    `momstarter-export-<yyyyMMdd>.json`
 *  - Cleanup (deleteAsync) runs BEST-EFFORT after the share promise resolves —
 *    NEVER in a racing finally or before the share (D8, 0f E2, AR-AC-05).
 *    A leftover file is non-fatal; Android may resolve shareAsync before the
 *    target app has fully read the file.
 *  - iOS: cacheDirectory is not included in iCloud backup by default (E3).
 */

// ─── Injected dependency types ─────────────────────────────────────────────────

/**
 * Writes `json` to the app-private cache directory.
 * Returns the `fileUri` of the written file.
 *
 * Production: uses `FileSystem.cacheDirectory` + `writeAsStringAsync`.
 * Tests: returns a fixed stub URI.
 */
export type ExportWriteFn = (json: string) => Promise<string>;

/**
 * Guards sharing availability and invokes the OS share sheet for `fileUri`.
 *
 * Production: calls `Sharing.isAvailableAsync()` first — throws if unavailable
 * (so `saveAndShare` catches it and returns `{ok:false}`), then calls
 * `Sharing.shareAsync()`.
 * Tests: resolves immediately or throws to simulate unavailability/failure.
 */
export type ExportShareFn = (fileUri: string) => Promise<void>;

/**
 * Deletes the temp file (best-effort cleanup, called only after share resolves).
 * Production: `FileSystem.deleteAsync(uri, { idempotent: true })`.
 * Tests: optional spy or no-op.
 *
 * Errors from deleteFn are intentionally swallowed — a leftover cache file is
 * non-fatal and must not surface as an export failure (D8, 0f E2).
 */
export type ExportDeleteFn = (fileUri: string) => Promise<void>;

// ─── Result type ───────────────────────────────────────────────────────────────

export type ExportFileResult =
  | { ok: true; fileUri: string }
  | { ok: false; error: string };

// ─── Service interface ─────────────────────────────────────────────────────────

export interface AccountExportFileService {
  /**
   * Write `json` to a temp file in the app cache and open the OS share sheet.
   *
   * @param json       - raw JSON string from GET /v1/account/export (NOT parsed)
   * @param onSharing  - optional callback fired after write succeeds and share
   *                     has been invoked but before share resolves. Lets the
   *                     orchestration transition to EXPORT_SHARING immediately.
   */
  saveAndShare(
    json: string,
    onSharing?: () => void,
  ): Promise<ExportFileResult>;
}

// ─── Date helper ───────────────────────────────────────────────────────────────

/**
 * Format a Date as 'yyyyMMdd' (UTC) for the export filename.
 * Uses UTC so the filename is stable regardless of device timezone.
 * Exported for unit-test coverage.
 */
export function formatExportDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * createAccountExportFileService — injectable factory.
 *
 * @param writeFn   - writes json to cache, returns fileUri
 * @param shareFn   - guards availability + opens OS share sheet
 * @param deleteFn  - best-effort temp-file cleanup (default: no-op)
 */
export function createAccountExportFileService(
  writeFn: ExportWriteFn,
  shareFn: ExportShareFn,
  deleteFn: ExportDeleteFn = async () => {},
): AccountExportFileService {
  return {
    async saveAndShare(
      json: string,
      onSharing?: () => void,
    ): Promise<ExportFileResult> {
      // SECURITY: This module NEVER logs the json content.
      // The json string is the full SD-1…SD-12 health + financial aggregate.
      // Do NOT pass it to console.log, crash reporters, or any logger.
      let fileUri: string;
      try {
        // Step 1: write json to app-private cache file
        fileUri = await writeFn(json);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { ok: false, error };
      }

      // Step 2: notify orchestration that sharing is about to start
      // (lets the screen transition to EXPORT_SHARING state before the
      // OS share sheet opens, per §2.2 step 4c and §2.5)
      onSharing?.();

      try {
        // Step 3: guard availability + open OS share sheet
        await shareFn(fileUri);
      } catch (err) {
        // Write succeeded but share failed (unavailable / sheet error).
        // A failed/partial attempt is NEVER presented as a saved file (§2.3).
        const error = err instanceof Error ? err.message : String(err);
        return { ok: false, error };
      }

      // Step 4: best-effort cleanup AFTER share promise resolves.
      // NEVER in a racing finally — Android may resolve shareAsync before the
      // target app finishes reading the file (D8, 0f E2, AR-AC-05).
      // A leftover file in app-private cache is non-fatal.
      // Promise.resolve() wraps the result defensively in case deleteFn's
      // return value is undefined (e.g. a test spy without an implementation).
      Promise.resolve(deleteFn(fileUri)).catch(() => {
        // Swallow cleanup errors intentionally.
        // A leftover temp file in app-private cache is low-risk (0f E2).
      });

      return { ok: true, fileUri };
    },
  };
}

// ─── Production singleton ──────────────────────────────────────────────────────

/**
 * createProductionAccountExportFileService — wires real expo-file-system
 * and expo-sharing via dynamic require().
 *
 * Dynamic require keeps this module importable in Node/Jest without crashing
 * on missing native modules — identical pattern to pdfService.ts.
 *
 * Call this only in React Native component code, not in pure-logic modules.
 *
 * Deps:
 *  - expo-file-system@~19.0.23 (SDK-54; the new default export dropped the
 *    string-constant/`*Async` legacy API in favor of File/Directory classes —
 *    `expo-file-system/legacy` preserves the exact old API surface used here)
 *  - expo-sharing@~14.0.8 (SDK-54-aligned)
 *
 * Security note (AR-AC-23): dev-only network inspectors (Flipper / Reactotron /
 * RN network inspector) MUST be stripped from release builds. This service does
 * not control that — it is enforced at the build configuration level.
 */
export function createProductionAccountExportFileService(): AccountExportFileService {
  // Dynamic require — keeps this module importable in Node (jest) without
  // crashing on missing native modules.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FileSystem = require('expo-file-system/legacy') as {
    cacheDirectory: string | null;
    writeAsStringAsync: (
      uri: string,
      content: string,
      options?: { encoding?: string },
    ) => Promise<void>;
    deleteAsync: (
      uri: string,
      options?: { idempotent?: boolean },
    ) => Promise<void>;
  };

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Sharing = require('expo-sharing') as {
    isAvailableAsync: () => Promise<boolean>;
    shareAsync: (
      uri: string,
      options?: { mimeType?: string; UTI?: string; dialogTitle?: string },
    ) => Promise<void>;
  };

  const writeFn: ExportWriteFn = async (json: string): Promise<string> => {
    // SECURITY: filename has NO PII (AR-AC-25).
    // File is written to app-private cacheDirectory only (E1, AR-AC-01).
    // cacheDirectory is not included in iCloud/Android auto-backup (E3).
    const dateStr = formatExportDate(new Date());
    const cacheDir = FileSystem.cacheDirectory ?? 'file:///cache/';
    const fileUri = `${cacheDir}momstarter-export-${dateStr}.json`;
    await FileSystem.writeAsStringAsync(fileUri, json, { encoding: 'utf8' });
    return fileUri;
  };

  const shareFn: ExportShareFn = async (fileUri: string): Promise<void> => {
    // Guard sharing availability first (E3 of behavior spec §2.2).
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      throw new Error('sharing_unavailable');
    }
    // SECURITY: content goes only to the OS share sheet — no auto-upload,
    // no logging, no analytics (E4, AR-AC-24). User chooses destination.
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Share your data',
    });
  };

  const deleteFn: ExportDeleteFn = async (fileUri: string): Promise<void> => {
    // idempotent: true — safe to call even if the file was already removed.
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  };

  return createAccountExportFileService(writeFn, shareFn, deleteFn);
}
