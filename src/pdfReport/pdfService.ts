/**
 * pdfService — thin injectable wrapper around expo-print + expo-sharing.
 *
 * This module decouples the testable assembly logic from native module calls.
 * In tests, inject mock PdfPrintFn and PdfShareFn via createPdfService().
 * In production, use the default `pdfService` singleton which wires real modules.
 *
 * Design:
 *   - generateAndShare(html) → { ok: true, fileUri } | { ok: false, error }
 *   - expo-print: Print.printToFileAsync({ html }) writes to a temp file.
 *   - expo-sharing: Sharing.shareAsync(fileUri, { mimeType: 'application/pdf' })
 *     opens the system share sheet.
 *   - The temp file lives in the app's cache directory; never persisted.
 *   - PDPA: no health data is transmitted externally by this service.
 *     The user explicitly invokes the OS share sheet to decide where to send it.
 *
 * Security:
 *   - No tokens or credentials are passed to this layer.
 *   - The HTML input is assembled externally (doctorReportAssembler).
 *   - This module has no logging.
 */

// ─── Injected dependency types ────────────────────────────────────────────────

export type PdfPrintFn = (options: { html: string }) => Promise<{ uri: string }>;
export type PdfShareFn = (uri: string, options: { mimeType: string }) => Promise<unknown>;

// ─── Result type ──────────────────────────────────────────────────────────────

export type PdfResult =
  | { ok: true; fileUri: string }
  | { ok: false; error: string };

// ─── Service interface ────────────────────────────────────────────────────────

export interface PdfService {
  generateAndShare(html: string): Promise<PdfResult>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * createPdfService — factory that accepts injectable print/share functions.
 *
 * Use in tests with mocks.
 * Use with real expo modules in production via the `pdfService` singleton.
 */
export function createPdfService(
  printFn: PdfPrintFn,
  shareFn: PdfShareFn,
): PdfService {
  return {
    async generateAndShare(html: string): Promise<PdfResult> {
      try {
        const { uri } = await printFn({ html });
        await shareFn(uri, { mimeType: 'application/pdf' });
        return { ok: true, fileUri: uri };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}

// ─── Production singleton (wires real expo-print + expo-sharing) ──────────────

/**
 * lazily imported to avoid native module errors in the Node/Jest test env.
 * Import this only in React Native component code, not in pure-logic modules.
 */
export function createProductionPdfService(): PdfService {
  // Dynamic require — keeps this module importable in Node (jest) without
  // crashing on missing native modules.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Print = require('expo-print') as {
    printToFileAsync: (opts: { html: string }) => Promise<{ uri: string }>;
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Sharing = require('expo-sharing') as {
    shareAsync: (uri: string, opts: { mimeType: string }) => Promise<void>;
  };

  return createPdfService(
    (opts) => Print.printToFileAsync(opts),
    (uri, opts) => Sharing.shareAsync(uri, opts),
  );
}
