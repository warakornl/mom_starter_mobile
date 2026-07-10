/**
 * fw1Scanner.test.ts — TDD RED → GREEN for the FW-1 Milk-Code firewall scanner.
 *
 * FW-1 (HARD): Zero promotional copy on any surface where formula-feed log,
 * formula item, decrement, low cue, or restock reminder renders.
 *
 * From docs/frontend-spec/auto-stock-decrement-ui.md §7.1:
 *
 * ALLOWLIST (and ONLY this):
 *   - Her verbatim item name (as typed, never parsed, never translated — SP-1)
 *   - Integer quantities
 *   - Neutral Thai verbs: "บันทึก", "เหลือ", "ใกล้หมด", "เติมสต็อก",
 *     "ตัดออก", "กระป๋อง", "มื้อ", "สกูป", "บรรจุภัณฑ์", "ครั้ง"
 *
 * BLOCKLIST (any of these = FW-1 violation):
 *   - "ซื้อ", "สั่ง", "reorder", "order", "cart", "shop", "โปร", "ลด",
 *     "discount", "coupon", "฿ราคา"
 *   - Health claims: "ดีต่อลูก", "ช่วยให้โต", "สูตรนี้"
 *   - Age-based: "สำหรับลูก" (with digit pattern for months/years)
 *
 * QA REQUIREMENTS:
 *   FW-1a: scanForFW1Violations(text) returns zero tokens on clean copy.
 *   FW-1b: snapshot-style: validateFW1Template(text, itemName) asserts rendered
 *     text = only {verbatim name} ∪ {integer} ∪ {allowlist verb} ∪ {punctuation/spacing}.
 *
 * Security: no real product names, no real health data in tests.
 */

import {
  scanForFW1Violations,
  isFW1Clean,
  validateFW1Template,
  FW1_BLOCKLIST_TOKENS,
} from './fw1Scanner';

// ─── FW-1a: scanForFW1Violations ──────────────────────────────────────────────

describe('FW-1a: scanForFW1Violations — blocklist scan', () => {
  // ── Clean strings (should return empty array) ──

  it('clean: verbatim item name alone → no violations', () => {
    expect(scanForFW1Violations('Mama Sample Powder')).toEqual([]);
  });

  it('clean: verbatim name + integer → no violations', () => {
    expect(scanForFW1Violations('Mama Sample Powder 2')).toEqual([]);
  });

  it('clean: Thai allowlist verb (บันทึก) → no violations', () => {
    expect(scanForFW1Violations('บันทึก')).toEqual([]);
  });

  it('clean: Thai allowlist verb (เหลือ) → no violations', () => {
    expect(scanForFW1Violations('เหลือ 3 กระป๋อง')).toEqual([]);
  });

  it('clean: Thai allowlist verbs (ใกล้หมด / เติมสต็อก / ตัดออก) → no violations', () => {
    expect(scanForFW1Violations('ใกล้หมด')).toEqual([]);
    expect(scanForFW1Violations('เติมสต็อก')).toEqual([]);
    expect(scanForFW1Violations('ตัดออก 2 มื้อ')).toEqual([]);
  });

  it('clean: allowlist verbs (กระป๋อง / มื้อ / สกูป / บรรจุภัณฑ์ / ครั้ง) → no violations', () => {
    expect(scanForFW1Violations('กระป๋อง')).toEqual([]);
    expect(scanForFW1Violations('มื้อ')).toEqual([]);
    expect(scanForFW1Violations('สกูป')).toEqual([]);
    expect(scanForFW1Violations('บรรจุภัณฑ์')).toEqual([]);
    expect(scanForFW1Violations('ครั้ง')).toEqual([]);
  });

  it('clean: push notification body (generic, no brand) → no violations', () => {
    // Simulates a low-supply push notification body
    const pushBody = 'นมผงของคุณใกล้หมด เหลือ 1 กระป๋อง';
    expect(scanForFW1Violations(pushBody)).toEqual([]);
  });

  it('clean: empty string → no violations', () => {
    expect(scanForFW1Violations('')).toEqual([]);
  });

  // ── Thai blocklist violations ──

  it('FW-1 violation: ซื้อ (buy) detected', () => {
    const violations = scanForFW1Violations('กดซื้อเลย');
    expect(violations).toContain('ซื้อ');
  });

  it('FW-1 violation: สั่ง (order/Thai) detected', () => {
    const violations = scanForFW1Violations('สั่งของทันที');
    expect(violations).toContain('สั่ง');
  });

  it('FW-1 violation: โปร (promo) detected', () => {
    const violations = scanForFW1Violations('โปรพิเศษวันนี้');
    expect(violations).toContain('โปร');
  });

  it('FW-1 violation: ลด (discount) detected', () => {
    const violations = scanForFW1Violations('ลด 20%');
    expect(violations).toContain('ลด');
  });

  it('FW-1 violation: ฿ราคา (price) detected', () => {
    const violations = scanForFW1Violations('฿ราคา 500');
    expect(violations).toContain('฿ราคา');
  });

  // ── English blocklist violations (case-insensitive) ──

  it('FW-1 violation: reorder (English, lowercase) detected', () => {
    const violations = scanForFW1Violations('tap to reorder');
    expect(violations).toContain('reorder');
  });

  it('FW-1 violation: reorder (English, uppercase) detected', () => {
    const violations = scanForFW1Violations('REORDER NOW');
    expect(violations).toContain('reorder');
  });

  it('FW-1 violation: order (English) detected', () => {
    const violations = scanForFW1Violations('place an order');
    expect(violations).toContain('order');
  });

  it('FW-1 violation: cart detected', () => {
    const violations = scanForFW1Violations('add to cart');
    expect(violations).toContain('cart');
  });

  it('FW-1 violation: shop detected', () => {
    const violations = scanForFW1Violations('shop now');
    expect(violations).toContain('shop');
  });

  it('FW-1 violation: discount detected', () => {
    const violations = scanForFW1Violations('10% discount');
    expect(violations).toContain('discount');
  });

  it('FW-1 violation: coupon detected', () => {
    const violations = scanForFW1Violations('use coupon code');
    expect(violations).toContain('coupon');
  });

  // ── Health claim violations ──

  it('FW-1 violation: ดีต่อลูก (good for baby) detected', () => {
    const violations = scanForFW1Violations('ดีต่อลูกของคุณ');
    expect(violations).toContain('ดีต่อลูก');
  });

  it('FW-1 violation: ช่วยให้โต (helps grow) detected', () => {
    const violations = scanForFW1Violations('ช่วยให้โตไว');
    expect(violations).toContain('ช่วยให้โต');
  });

  it('FW-1 violation: สูตรนี้ (this formula) detected', () => {
    const violations = scanForFW1Violations('สูตรนี้ดีที่สุด');
    expect(violations).toContain('สูตรนี้');
  });

  // ── Age-based recommendation violation ──

  it('FW-1 violation: สำหรับลูก+month pattern detected', () => {
    const violations = scanForFW1Violations('สำหรับลูก 6 เดือน');
    expect(violations).toContain('สำหรับลูก');
  });

  it('FW-1 violation: สำหรับลูก without age also blocked', () => {
    // The word itself is banned since any age-based targeting starts with it
    const violations = scanForFW1Violations('สำหรับลูก');
    expect(violations).toContain('สำหรับลูก');
  });

  // ── Multiple violations detected ──

  it('returns ALL violations found (not just the first)', () => {
    const text = 'ซื้อเลยโปรสุดพิเศษ ลด 30% discount coupon';
    const violations = scanForFW1Violations(text);
    expect(violations).toContain('ซื้อ');
    expect(violations).toContain('โปร');
    expect(violations).toContain('ลด');
    expect(violations).toContain('discount');
    expect(violations).toContain('coupon');
  });

  // ── Push notification body (FW-1a explicit) ──

  it('FW-1a: push notification body with reorder CTA → violation', () => {
    // This simulates a non-compliant push notification
    const pushBody = 'นมผงใกล้หมด กด reorder ได้เลย';
    const violations = scanForFW1Violations(pushBody);
    expect(violations).toContain('reorder');
  });

  it('FW-1a: push notification body compliant (generic) → clean', () => {
    const pushBody = 'นมผงของคุณใกล้หมด';
    expect(scanForFW1Violations(pushBody)).toHaveLength(0);
  });
});

// ─── isFW1Clean: convenience boolean wrapper ─────────────────────────────────

describe('isFW1Clean — convenience boolean', () => {
  it('returns true for clean text', () => {
    expect(isFW1Clean('เหลือ 2 กระป๋อง')).toBe(true);
  });

  it('returns false for violating text', () => {
    expect(isFW1Clean('กดซื้อเลย')).toBe(false);
  });

  it('returns true for empty string', () => {
    expect(isFW1Clean('')).toBe(true);
  });
});

// ─── FW-1b: validateFW1Template ───────────────────────────────────────────────
// Verifies that after stripping the verbatim item name, integers, allowlist
// verbs, and punctuation/spacing, nothing extraneous remains.

describe('FW-1b: validateFW1Template — rendered output allowlist check', () => {
  // ── Valid templates ──

  it('valid: "{itemName} {integer} มื้อ" → passes', () => {
    expect(validateFW1Template('Mama Sample 2 มื้อ', 'Mama Sample')).toBe(true);
  });

  it('valid: "ตัดออก {integer} สกูป" → passes', () => {
    expect(validateFW1Template('ตัดออก 1 สกูป', '')).toBe(true);
  });

  it('valid: "เหลือ {integer} กระป๋อง" → passes', () => {
    expect(validateFW1Template('เหลือ 3 กระป๋อง', '')).toBe(true);
  });

  it('valid: item name with spaces and integer → passes', () => {
    expect(validateFW1Template('Test Powder 2 2 ครั้ง', 'Test Powder 2')).toBe(true);
  });

  it('valid: push notification body → passes', () => {
    expect(validateFW1Template('นมผงของคุณใกล้หมด เหลือ 1 กระป๋อง', '')).toBe(true);
  });

  // ── Invalid templates (contain blocklist content) ──

  it('invalid: blocklist token in template → fails', () => {
    expect(validateFW1Template('Mama Sample สั่งซื้อเลย', 'Mama Sample')).toBe(false);
  });

  it('invalid: health claim in template → fails', () => {
    expect(validateFW1Template('Mama Sample ดีต่อลูก', 'Mama Sample')).toBe(false);
  });

  it('invalid: English commerce word in template → fails', () => {
    expect(validateFW1Template('Mama Sample add to cart', 'Mama Sample')).toBe(false);
  });
});

// ─── FW1_BLOCKLIST_TOKENS export ─────────────────────────────────────────────

describe('FW1_BLOCKLIST_TOKENS — exported constant for programmatic use', () => {
  it('exports a non-empty array of blocklist tokens', () => {
    expect(Array.isArray(FW1_BLOCKLIST_TOKENS)).toBe(true);
    expect(FW1_BLOCKLIST_TOKENS.length).toBeGreaterThan(0);
  });

  it('includes the Thai buy verb (ซื้อ)', () => {
    expect(FW1_BLOCKLIST_TOKENS).toContain('ซื้อ');
  });

  it('includes reorder (English)', () => {
    // English tokens may be stored lowercase for case-insensitive matching
    const lower = FW1_BLOCKLIST_TOKENS.map((t) => t.toLowerCase());
    expect(lower).toContain('reorder');
  });

  it('includes health claim (ดีต่อลูก)', () => {
    expect(FW1_BLOCKLIST_TOKENS).toContain('ดีต่อลูก');
  });
});
