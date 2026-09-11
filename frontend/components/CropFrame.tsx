import { useRef } from 'react';
import { Animated, GestureResponderEvent, PanResponder, PanResponderGestureState, StyleSheet, View } from 'react-native';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const BRACKET_LENGTH = 22;
const BRACKET_THICKNESS = 3;
// A corner is "grabbed" if the touch lands within this radius of it - bigger
// than the visible bracket so a finger doesn't need pixel-perfect placement.
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
 *
 * Every frame of the drag is applied via Animated.Value.setValue() rather
 * than the `onChange` prop, so dragging updates only this view's native
 * props directly - not a React state update on every touch-move, which
 * would re-render the whole scan screen underneath dozens of times a
 * second and felt exactly as janky as that sounds on a real phone.
 * `onChange` fires once, when the finger actually lifts: the caller only
 * ever reads the rect after a gesture ends (when "Use this area" is
 * tapped), so it never needed the live value mid-drag.
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
  const latestRef = useRef<CropRect>(rect);
  const modeRef = useRef<Mode>('move');

  const x = useRef(new Animated.Value(rect.x)).current;
  const y = useRef(new Animated.Value(rect.y)).current;
  const width = useRef(new Animated.Value(rect.width)).current;
  const height = useRef(new Animated.Value(rect.height)).current;
  const right = useRef(Animated.add(x, width)).current;
  const bottom = useRef(Animated.add(y, height)).current;

  function clamp(next: CropRect): CropRect {
    const { displayWidth, displayHeight } = boundsRef.current;
    const w = Math.min(Math.max(next.width, MIN_SIZE), displayWidth);
    const h = Math.min(Math.max(next.height, MIN_SIZE), displayHeight);
    const cx = Math.min(Math.max(next.x, 0), displayWidth - w);
    const cy = Math.min(Math.max(next.y, 0), displayHeight - h);
    return { x: cx, y: cy, width: w, height: h };
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

  function applyNext(next: CropRect) {
    latestRef.current = next;
    x.setValue(next.x);
    y.setValue(next.y);
    width.setValue(next.width);
    height.setValue(next.height);
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Claimed in the capture phase and never surrendered: this view lives
      // inside a ScrollView (the confirm/frame step scrolls on a tall
      // portrait photo), and without this a vertical drag on the frame
      // could get taken over by the ScrollView's own scroll gesture
      // partway through - which felt exactly like "the frame randomly
      // stops responding" on a real device.
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const start = rectRef.current;
        startRef.current = start;
        latestRef.current = start;
        // locationX/Y are relative to this view (it exactly covers the
        // display box), so they land in the same coordinate space as rect.
        const { locationX, locationY } = evt.nativeEvent;
        modeRef.current = pickMode(locationX, locationY, start);
      },
      onPanResponderMove: (_evt: GestureResponderEvent, gesture: PanResponderGestureState) => {
        const start = startRef.current;
        let { x: nx, y: ny, width: nw, height: nh } = start;
        switch (modeRef.current) {
          case 'move':
            nx = start.x + gesture.dx;
            ny = start.y + gesture.dy;
            break;
          case 'tl':
            nx = start.x + gesture.dx;
            ny = start.y + gesture.dy;
            nw = start.width - gesture.dx;
            nh = start.height - gesture.dy;
            break;
          case 'tr':
            ny = start.y + gesture.dy;
            nw = start.width + gesture.dx;
            nh = start.height - gesture.dy;
            break;
          case 'bl':
            nx = start.x + gesture.dx;
            nw = start.width - gesture.dx;
            nh = start.height + gesture.dy;
            break;
          case 'br':
            nw = start.width + gesture.dx;
            nh = start.height + gesture.dy;
            break;
        }
        applyNext(clamp({ x: nx, y: ny, width: nw, height: nh }));
      },
      onPanResponderRelease: () => onChangeRef.current(latestRef.current),
      onPanResponderTerminate: () => onChangeRef.current(latestRef.current),
    })
  ).current;

  return (
    <View {...responder.panHandlers} style={StyleSheet.absoluteFill}>
      {/* Darkens everything outside the frame, built from 4 plain rectangles
          since React Native has no clip-path/mask-with-a-hole primitive. */}
      <Animated.View pointerEvents="none" style={[styles.mask, { left: 0, top: 0, right: 0, height: y }]} />
      <Animated.View pointerEvents="none" style={[styles.mask, { left: 0, top: bottom, right: 0, bottom: 0 }]} />
      <Animated.View pointerEvents="none" style={[styles.mask, { left: 0, top: y, width: x, height }]} />
      <Animated.View pointerEvents="none" style={[styles.mask, { left: right, top: y, right: 0, height }]} />

      <Animated.View pointerEvents="none" style={[styles.frame, { left: x, top: y, width, height }]}>
        {/* Rule-of-thirds grid, the same visual language as a native photo
            cropper - a quiet cue that this box is actively adjustable. */}
        <View style={[styles.gridLineV, { left: '33.333%' }]} />
        <View style={[styles.gridLineV, { left: '66.667%' }]} />
        <View style={[styles.gridLineH, { top: '33.333%' }]} />
        <View style={[styles.gridLineH, { top: '66.667%' }]} />

        {/* Corner brackets rather than filled dots - the touch target
            (HANDLE_HIT_RADIUS above) stays generous even though the mark
            itself is small and precise. */}
        <View style={[styles.bracketBar, styles.barH, { left: -1, top: -1 }]} />
        <View style={[styles.bracketBar, styles.barV, { left: -1, top: -1 }]} />
        <View style={[styles.bracketBar, styles.barH, { right: -1, top: -1 }]} />
        <View style={[styles.bracketBar, styles.barV, { right: -1, top: -1 }]} />
        <View style={[styles.bracketBar, styles.barH, { left: -1, bottom: -1 }]} />
        <View style={[styles.bracketBar, styles.barV, { left: -1, bottom: -1 }]} />
        <View style={[styles.bracketBar, styles.barH, { right: -1, bottom: -1 }]} />
        <View style={[styles.bracketBar, styles.barV, { right: -1, bottom: -1 }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  frame: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  bracketBar: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: BRACKET_THICKNESS / 2,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  barH: { width: BRACKET_LENGTH, height: BRACKET_THICKNESS },
  barV: { width: BRACKET_THICKNESS, height: BRACKET_LENGTH },
});
