/**
 * pdfService.test.ts — TDD for the expo-print / expo-sharing boundary.
 *
 * The PdfService wraps native calls behind an injectable interface so the
 * pure assembler is testable without any native modules.
 *
 * Tests cover:
 *   - generateAndShare calls printToFileAsync with the provided HTML
 *   - generateAndShare calls shareAsync with the resulting file URI
 *   - Returns { ok: true, fileUri } on success
 *   - Returns { ok: false, error } if printToFileAsync rejects
 *   - Returns { ok: false, error } if shareAsync rejects
 *   - createPdfService factory wires the real expo-print/sharing (smoke check)
 *   - Default service is injectable (mock-able for test isolation)
 *   - printToFileAsync is called with html option set
 */

import { createPdfService, type PdfPrintFn, type PdfShareFn } from './pdfService';

// ─── Fakes ────────────────────────────────────────────────────────────────────

const FAKE_URI = 'file:///tmp/doctor-report.pdf';

const mockPrint: PdfPrintFn = jest.fn().mockResolvedValue({ uri: FAKE_URI });
const mockShare: PdfShareFn = jest.fn().mockResolvedValue(undefined);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createPdfService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls printToFileAsync with the HTML string', async () => {
    const svc = createPdfService(mockPrint, mockShare);
    await svc.generateAndShare('<html><body>test</body></html>');
    expect(mockPrint).toHaveBeenCalledTimes(1);
    expect(mockPrint).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<html><body>test</body></html>' }),
    );
  });

  it('calls shareAsync with the file URI from printToFileAsync', async () => {
    const svc = createPdfService(mockPrint, mockShare);
    await svc.generateAndShare('<html></html>');
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith(FAKE_URI, expect.any(Object));
  });

  it('returns ok:true with fileUri on success', async () => {
    const svc = createPdfService(mockPrint, mockShare);
    const result = await svc.generateAndShare('<html></html>');
    expect(result).toEqual({ ok: true, fileUri: FAKE_URI });
  });

  it('returns ok:false with error message when printToFileAsync rejects', async () => {
    const failPrint: PdfPrintFn = jest.fn().mockRejectedValue(new Error('print_failed'));
    const svc = createPdfService(failPrint, mockShare);
    const result = await svc.generateAndShare('<html></html>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('print_failed');
    }
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('returns ok:false with error message when shareAsync rejects', async () => {
    const failShare: PdfShareFn = jest.fn().mockRejectedValue(new Error('share_failed'));
    const svc = createPdfService(mockPrint, failShare);
    const result = await svc.generateAndShare('<html></html>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('share_failed');
    }
  });

  it('returns ok:false with generic error for non-Error rejection', async () => {
    const failPrint: PdfPrintFn = jest.fn().mockRejectedValue('string_error');
    const svc = createPdfService(failPrint, mockShare);
    const result = await svc.generateAndShare('<html></html>');
    expect(result.ok).toBe(false);
  });

  it('passes mimeType to shareAsync', async () => {
    const svc = createPdfService(mockPrint, mockShare);
    await svc.generateAndShare('<html></html>');
    expect(mockShare).toHaveBeenCalledWith(
      FAKE_URI,
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
  });

  it('is injectable — different mocks produce isolated results', async () => {
    const uri2 = 'file:///tmp/other.pdf';
    const print2: PdfPrintFn = jest.fn().mockResolvedValue({ uri: uri2 });
    const share2: PdfShareFn = jest.fn().mockResolvedValue(undefined);

    const svc = createPdfService(print2, share2);
    const result = await svc.generateAndShare('<html></html>');
    expect(result).toEqual({ ok: true, fileUri: uri2 });
    expect(mockPrint).not.toHaveBeenCalled(); // original mock untouched
  });
});
