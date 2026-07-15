/**
 * AccentRow — Left-accent-bar list row for HomeTabScreen data rows.
 *
 * Spec: docs/design/mother-room-build-spec.md §4.1
 *
 * Layout:
 *   [3dp accent bar] [label + value area] [optional chevron]
 *
 * Accent bar color by type:
 *   'pregnancy' → T.list.row.accentBar.pregnancy = roselle-500 #B85C78
 *   'health'    → T.list.row.accentBar.health    = jade-800   #2F5042
 *
 * A11y:
 *   - When `onPress` provided: accessibilityRole="button" on the outer Touchable.
 *   - A11y containment rule: the outer Touchable has the role; inner Views are
 *     accessibilityElementsHidden={true} (avoid double-announce from nested text).
 *   - accessibilityLabel = caller-supplied `accessibilityLabel` or title + " " + value.
 *   - minHeight: T.list.row.minHeight (56dp) — ≥48dp tap target (row grows via
 *     minHeight, not a fixed height, so 2-line title/value below still fits).
 *
 * FIX (Thai truncation): title + value now allow up to 2 lines
 * (numberOfLines={2}) with adjustsFontSizeToFit/minimumFontScale={0.85} as an
 * auto-shrink fallback, instead of hard-clipping longer Thai health labels at
 * 1 line with no way to read the rest.
 *
 * Security: never log row values (may contain health data).
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { T } from '../theme/tokens';

export interface AccentRowProps {
  /** Row semantic type — drives accent bar color. */
  type: 'pregnancy' | 'health';
  /** Primary label (left). e.g. "การเตะลูก", "นัดฝากครรภ์" */
  title: string;
  /** Primary value (right). e.g. "8 ครั้ง", "พรุ่งนี้" */
  value: string;
  /** Secondary subtitle line below title (e.g. "วันนี้ · ครั้งล่าสุด 09:14") */
  subtitle?: string;
  /** Secondary value subtitle below value (e.g. "09:30") */
  valueSubtitle?: string;
  /** When provided, the entire row is tappable with this handler. */
  onPress?: () => void;
  /**
   * Accessible label for the row.
   * Default: `${title} ${value}${subtitle ? ' ' + subtitle : ''}`
   */
  accessibilityLabel?: string;
}

export function AccentRow({
  type,
  title,
  value,
  subtitle,
  valueSubtitle,
  onPress,
  accessibilityLabel,
}: AccentRowProps): React.JSX.Element {
  const accentColor =
    type === 'pregnancy'
      ? T.list.row.accentBar.pregnancy   // roselle-500 #B85C78
      : T.list.row.accentBar.health;     // jade-800   #2F5042

  const a11yLabel =
    accessibilityLabel ??
    [title, value, subtitle].filter(Boolean).join(' ');

  const content = (
    // Outer row: accent bar + content zone
    <View style={styles.row}>
      {/* §4.1: 3dp left accent bar — decorative; content carries meaning */}
      <View
        style={[styles.accentBar, { backgroundColor: accentColor }]}
        accessibilityElementsHidden={true}
        // @ts-ignore — importantForAccessibility on View (Android)
        importantForAccessibility="no-hide-descendants"
      />

      {/* Content zone: label column + value column */}
      <View style={styles.contentZone}>
        {/*
          FIX (Thai truncation): title/value were numberOfLines={1}, which
          clips longer Thai health labels (e.g. "นัดฝากครรภ์ครั้งถัดไป") with
          no way to recover the hidden text — silent data loss for the
          mother. Now allow up to 2 lines + adjustsFontSizeToFit as an
          auto-shrink fallback before wrapping exhausts, so a 2-line label
          still fits the row rather than clipping a 3rd line.
        */}
        {/* Label column */}
        <View style={styles.labelCol}>
          <Text
            style={styles.titleText}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitleText} numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>

        {/* Value column (right-aligned) */}
        <View style={styles.valueCol}>
          <Text
            style={styles.valueText}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {value}
          </Text>
          {valueSubtitle ? (
            <Text style={styles.subtitleText} numberOfLines={1}>{valueSubtitle}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={styles.touchable}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        // §4.1: minHeight 56dp — ≥48dp tap target
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={styles.touchable}
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
    >
      {content}
    </View>
  );
}

// ─── Styles (tokens only — no inline hex or px) ───────────────────────────────

const styles = StyleSheet.create({
  touchable: {
    minHeight: T.list.row.minHeight,       // 56dp — ≥48dp tap target
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: T.list.row.minHeight,
    paddingHorizontal: T.spacing[4],       // 16dp
    paddingVertical: T.spacing[3],         // 12dp
  },
  accentBar: {
    width: T.list.row.accentBar.width,     // 3dp
    borderRadius: 2,
    marginRight: T.spacing[3],             // 12dp gap after bar
    alignSelf: 'stretch',
  },
  contentZone: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.spacing[2],                     // 8dp between label and value
  },
  labelCol: {
    flex: 1,
    gap: 2,
  },
  valueCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  titleText: {
    fontFamily: T.type.label.fontFamily,   // Sarabun-SemiBold
    fontSize: T.type.label.size,           // 15sp
    lineHeight: T.type.label.lineHeight,   // 24sp (1.6× — Thai rule)
    color: T.color.text.primary,           // roselle-700 #7A3A52
  },
  valueText: {
    fontFamily: T.type.label.fontFamily,   // Sarabun-SemiBold
    fontSize: T.type.label.size,           // 15sp
    lineHeight: T.type.label.lineHeight,   // 24sp
    color: T.color.text.primary,           // roselle-700 #7A3A52
    textAlign: 'right',
  },
  subtitleText: {
    fontFamily: T.type.caption.fontFamily, // Sarabun-Regular
    // §0 R4: jade-600 is text.secondary — it's ≥15sp constraint is for body text.
    // Caption (13sp) text should use text.primary or a safe dark token.
    // Using caption color via text.botanical (#2F5042) which is jade-800 — safe at any size.
    fontSize: T.type.caption.size,         // 13sp (jade-600 constraint is for text.secondary)
    lineHeight: T.type.caption.lineHeight, // 21sp
    color: T.color.text.botanical,         // jade-800 #2F5042 (7.84:1 AAA — safe at 13sp)
  },
});
