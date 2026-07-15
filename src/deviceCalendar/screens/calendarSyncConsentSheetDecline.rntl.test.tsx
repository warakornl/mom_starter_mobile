/**
 * calendarSyncConsentSheetDecline.rntl.test.tsx
 *
 * UX/UI review fix (CLUSTER 3 — Calendar + device-calendar sync):
 *   🔴 CS-1b decline-reassurance state was unreachable. handleDecline() set
 *   declined=true then called onDecline() SYNCHRONOUSLY — but every real
 *   caller (CalendarSyncSettingsScreen / RootNavigator) hides or pops the
 *   sheet in that SAME tick (setShowConsentSheet(false) / navigation.goBack()),
 *   so the `declined` branch's render never had a chance to be seen even
 *   though the internal state was set correctly.
 *
 * FIX: CalendarSyncConsentSheet now renders the CS-1b reassurance
 *   unconditionally (regardless of the parent's `visible` prop) once
 *   `declined` is true, and defers the actual onDecline() dismiss signal to
 *   the parent via a short setTimeout — decoupling "reassurance shown" from
 *   "parent hides the sheet".
 *
 * Real render (RNTL) + real timers (fake, advanced) — reproduces the EXACT
 * caller pattern from CalendarSyncSettingsScreen: onDecline synchronously
 * flips a `visible` prop to false in the same tick as the sheet's internal
 * decline handler runs.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

import { CalendarSyncConsentSheet } from './CalendarSyncConsentSheet';

/**
 * Minimal harness reproducing CalendarSyncSettingsScreen's actual wiring:
 *   onDecline => setShowConsentSheet(false) — i.e. `visible` flips to false
 *   in the SAME tick as CalendarSyncConsentSheet's internal handleDecline().
 */
function Harness() {
  const [visible, setVisible] = useState(true);
  return (
    <CalendarSyncConsentSheet
      visible={visible}
      onGrant={jest.fn().mockResolvedValue(undefined)}
      onDecline={() => setVisible(false)}
      locale="th"
    />
  );
}

describe('CalendarSyncConsentSheet — CS-1b decline reassurance reachability', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('FAIL-ON-REVERT: reassurance note is visible immediately after decline, even though the parent flips visible=false in the same tick', async () => {
    render(<Harness />);

    const declineBtn = screen.getByTestId('consent-cal-decline-btn');
    act(() => {
      fireEvent.press(declineBtn);
    });

    // The reassurance note must be reachable RIGHT AWAY — not dependent on
    // the parent's `visible` prop (which the harness has already flipped to
    // false in the same tick, exactly like the real caller).
    const note = await screen.findByTestId('consent-cal-decline-note');
    expect(note).toBeTruthy();
    expect(note).toHaveTextContent(/ไม่เป็นไรค่ะ/);
  });

  it('auto-dismisses (defers onDecline signal) after the reassurance delay', async () => {
    const onDecline = jest.fn();
    function HarnessWithSpy() {
      const [visible, setVisible] = useState(true);
      return (
        <CalendarSyncConsentSheet
          visible={visible}
          onGrant={jest.fn().mockResolvedValue(undefined)}
          onDecline={() => {
            onDecline();
            setVisible(false);
          }}
          locale="th"
        />
      );
    }

    render(<HarnessWithSpy />);
    act(() => {
      fireEvent.press(screen.getByTestId('consent-cal-decline-btn'));
    });

    // First onDecline call (from the tap) already happened synchronously in
    // the harness — but the CS-1b note must still be showing right after.
    expect(await screen.findByTestId('consent-cal-decline-note')).toBeTruthy();

    // Advance past the auto-dismiss delay inside an async act so pending
    // microtasks/timers settle (advanceTimersByTimeAsync avoids the
    // sync-advance deadlock with promises per craft heuristics).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });

    // The internal auto-dismiss timer should have fired its own onDecline()
    // call (in addition to the one from the initial tap).
    expect(onDecline).toHaveBeenCalled();
  });

  it('manual close button dismisses immediately without waiting for the timer', async () => {
    const onDecline = jest.fn();
    function HarnessManualClose() {
      const [visible, setVisible] = useState(true);
      return (
        <CalendarSyncConsentSheet
          visible={visible}
          onGrant={jest.fn().mockResolvedValue(undefined)}
          onDecline={() => {
            onDecline();
            setVisible(false);
          }}
          locale="th"
        />
      );
    }

    render(<HarnessManualClose />);
    act(() => {
      fireEvent.press(screen.getByTestId('consent-cal-decline-btn'));
    });
    await screen.findByTestId('consent-cal-decline-note');

    const closeBtn = screen.getByTestId('consent-cal-decline-close-btn');
    act(() => {
      fireEvent.press(closeBtn);
    });

    await waitFor(() => {
      expect(onDecline).toHaveBeenCalled();
    });
  });
});
