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
const MIN_SIZE = 40;

type Corner = 'tl' | 'tr' | 'bl' | 'br' | 'body';

/**
 * A draggable, resizable rectangle over an already-sized image display area.
 * `rect` is in on-screen pixels relative to that area's own top-left corner
 * (not the original photo's pixels, and not a percentage) - the caller
 * converts to/from the original photo's resolution when it actually crops.
 *
 * Everything the pan handlers read (bounds, the live rect, onChange) comes
 * through refs rather than closure captures: each PanResponder is built once
 * via useRef so a fast drag can never act on a stale value from the render
 * that first created it.
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

  function clamp(next: CropRect): CropRect {
    const { displayWidth, displayHeight } = boundsRef.current;
    const width = Math.min(Math.max(next.width, MIN_SIZE), displayWidth);
    const height = Math.min(Math.max(next.height, MIN_SIZE), displayHeight);
    const x = Math.min(Math.max(next.x, 0), displayWidth - width);
    const y = Math.min(Math.max(next.y, 0), displayHeight - height);
    return { x, y, width, height };
  }

  function makeResponder(corner: Corner) {
    return useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = rectRef.current;
        },
        onPanResponderMove: (_evt: GestureResponderEvent, gesture: PanResponderGestureState) => {
          const start = startRef.current;
          let { x, y, width, height } = start;
          if (corner === 'body') {
            x = start.x + gesture.dx;
            y = start.y + gesture.dy;
          } else if (corner === 'tl') {
            x = start.x + gesture.dx;
            y = start.y + gesture.dy;
            width = start.width - gesture.dx;
            height = start.height - gesture.dy;
          } else if (corner === 'tr') {
            y = start.y + gesture.dy;
            width = start.width + gesture.dx;
            height = start.height - gesture.dy;
          } else if (corner === 'bl') {
            x = start.x + gesture.dx;
            width = start.width - gesture.dx;
            height = start.height + gesture.dy;
          } else {
            width = start.width + gesture.dx;
            height = start.height + gesture.dy;
          }
          onChangeRef.current(clamp({ x, y, width, height }));
        },
      })
    ).current;
  }

  const body = makeResponder('body');
  const tl = makeResponder('tl');
  const tr = makeResponder('tr');
  const bl = makeResponder('bl');
  const br = makeResponder('br');

  return (
    <>
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
        {...body.panHandlers}
        style={[styles.frame, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }]}
      >
        <View {...tl.panHandlers} style={[styles.handle, styles.handleTL]} />
        <View {...tr.panHandlers} style={[styles.handle, styles.handleTR]} />
        <View {...bl.panHandlers} style={[styles.handle, styles.handleBL]} />
        <View {...br.panHandlers} style={[styles.handle, styles.handleBR]} />
      </View>
    </>
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
