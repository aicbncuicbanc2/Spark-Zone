import { useRef } from 'react';
import { GestureResponderEvent, PanResponder, PanResponderGestureState, StyleSheet, View } from 'react-native';

import { colors } from '../lib/theme';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HANDLE_SIZE = 28;
// A corner is "grabbed" if the touch lands within this radius of it - bigger
// than the visible dot so a finger doesn't need pixel-perfect placement.
const HANDLE_HIT_RADIUS = 34;
const MIN_SIZE = 40;

type Mode = 'move' | 'tl' | 'tr' | 'bl' | 'br';

/**
 * A draggable, resizable rectangle over an already-sized image display area.
 * `rect` is in on-screen pixels relative to that area's own top-left corner
 * (not the original photo's pixels, and not a percentage) - the caller
 * converts to/from the original photo's resolution when it actually crops.
 *
 * One PanResponder covers the whole display box, rather than one per corner
 * handle nested inside a moveable body view: real device testing found that
 * a child handle's own PanResponder, nested inside a parent view that also
 * has one, doesn't reliably win the touch over the parent - resize never
 * fired, only move did. A single responder that decides "move a corner or
 * move the whole box" from where the gesture *started* (see pickMode below)
 * has no parent/child to negotiate between, so it can't lose that fight.
 */
export function CropFrame({
  displayWidth,
  displayHeight,
  rect,
  onChange,
}: {
  displayWidth: number;
  displayHeight: number;
  rect: CropRect;
  onChange: (rect: CropRect) => void;
}) {
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const boundsRef = useRef({ displayWidth, displayHeight });
  boundsRef.current = { displayWidth, displayHeight };
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const startRef = useRef<CropRect>(rect);
  const modeRef = useRef<Mode>('move');

  function clamp(next: CropRect): CropRect {
    const { displayWidth, displayHeight } = boundsRef.current;
    const width = Math.min(Math.max(next.width, MIN_SIZE), displayWidth);
    const height = Math.min(Math.max(next.height, MIN_SIZE), displayHeight);
    const x = Math.min(Math.max(next.x, 0), displayWidth - width);
    const y = Math.min(Math.max(next.y, 0), displayHeight - height);
    return { x, y, width, height };
  }

  function pickMode(localX: number, localY: number, start: CropRect): Mode {
    const corners: Array<[Mode, number, number]> = [
      ['tl', start.x, start.y],
      ['tr', start.x + start.width, start.y],
      ['bl', start.x, start.y + start.height],
      ['br', start.x + start.width, start.y + start.height],
    ];
    for (const [mode, cx, cy] of corners) {
      const dx = localX - cx;
      const dy = localY - cy;
      if (dx * dx + dy * dy <= HANDLE_HIT_RADIUS * HANDLE_HIT_RADIUS) return mode;
    }
    return 'move';
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const start = rectRef.current;
        startRef.current = start;
        // locationX/Y are relative to this view (it exactly covers the
        // display box), so they land in the same coordinate space as rect.
        const { locationX, locationY } = evt.nativeEvent;
        modeRef.current = pickMode(locationX, locationY, start);
      },
      onPanResponderMove: (_evt: GestureResponderEvent, gesture: PanResponderGestureState) => {
        const start = startRef.current;
        let { x, y, width, height } = start;
        switch (modeRef.current) {
          case 'move':
            x = start.x + gesture.dx;
            y = start.y + gesture.dy;
            break;
          case 'tl':
            x = start.x + gesture.dx;
            y = start.y + gesture.dy;
            width = start.width - gesture.dx;
            height = start.height - gesture.dy;
            break;
          case 'tr':
            y = start.y + gesture.dy;
            width = start.width + gesture.dx;
            height = start.height - gesture.dy;
            break;
          case 'bl':
            x = start.x + gesture.dx;
            width = start.width - gesture.dx;
            height = start.height + gesture.dy;
            break;
          case 'br':
            width = start.width + gesture.dx;
            height = start.height + gesture.dy;
            break;
        }
        onChangeRef.current(clamp({ x, y, width, height }));
      },
    })
  ).current;

  return (
    <View {...responder.panHandlers} style={StyleSheet.absoluteFill}>
      {/* Darkens everything outside the frame, built from 4 plain rectangles
          since React Native has no clip-path/mask-with-a-hole primitive. */}
      <View pointerEvents="none" style={[styles.mask, { left: 0, top: 0, right: 0, height: rect.y }]} />
      <View
        pointerEvents="none"
        style={[styles.mask, { left: 0, top: rect.y + rect.height, right: 0, bottom: 0 }]}
      />
      <View pointerEvents="none" style={[styles.mask, { left: 0, top: rect.y, width: rect.x, height: rect.height }]} />
      <View
        pointerEvents="none"
        style={[styles.mask, { left: rect.x + rect.width, top: rect.y, right: 0, height: rect.height }]}
      />

      <View
        pointerEvents="none"
        style={[styles.frame, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }]}
      >
        <View style={[styles.handle, styles.handleTL]} />
        <View style={[styles.handle, styles.handleTR]} />
        <View style={[styles.handle, styles.handleBL]} />
        <View style={[styles.handle, styles.handleBR]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  frame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.white,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.navy,
  },
  handleTL: { left: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2 },
  handleTR: { right: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2 },
  handleBL: { left: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2 },
  handleBR: { right: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2 },
});
