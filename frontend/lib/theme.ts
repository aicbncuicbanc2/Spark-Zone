// Extracted directly from the Figma logo export (assets/brand/logo.png):
// navy sampled from the wordmark ink, cream from its background.
export const colors = {
  navy: '#111F79',
  navyMuted: '#3A4694',
  cream: '#F6F4F0',
  creamCard: '#EFEDE7',
  white: '#FFFFFF',
  textMuted: '#767573',
  border: '#DEDBD3',
  danger: '#C0392B',
  // From the Sep-11 Figma mockups: the featured-item tip card and calendar
  // "in range" day fill both use this same soft blue-gray.
  tipCard: '#DDE1E8',
  calendarFill: '#E4E6EA',
};

// Per-urgency colors, per exact spec: Expired-Dark Red, Critical-Red,
// Soon-Orange, Upcoming-Dirty green, Good-Healthy green. Single source of
// truth for UrgencyBadge, the dashboard bucket cards, and the tip card's
// date text — all three should always agree on what each urgency looks like.
export const urgencyColors = {
  expired: '#7A0C0C',
  critical: '#D62828',
  soon: '#E07A1F',
  upcoming: '#6B8E23',
  ok: '#2E8B57',
};

export const statusColors = {
  active: '#1E8449',
  consumed: '#9A7D0A',
  discarded: '#D35400',
  expired: '#C0392B',
};

// Shared text-size tiers so the same kind of text — a page/section heading,
// a secondary sub-heading, ordinary body copy, or a small caption/label —
// reads at the same size on every screen, instead of each screen picking
// its own nearby number (screens built independently had headings ranging
// 17-24px and small helper text ranging 11-15px, for no reason tied to
// what the text actually was). Doesn't cover UI-control text (buttons,
// chips, badges, form inputs) — those are sized for their control, not for
// reading hierarchy, so they're intentionally left out of this scale.
export const fontSize = {
  heading: 20,
  subheading: 16,
  body: 14,
  caption: 12,
};

// The wordmark's on-screen box in every tab header (Home/Pantry/Scan) —
// previously each screen had picked its own size (110x36, then 90x30
// elsewhere), which is exactly why the logo looked like a different size
// on every screen. Sign-in's logo is deliberately not on this constant:
// it's a centered splash-style logo on its own screen, not a header logo,
// so it's sized for that different context instead.
export const logoSize = {
  width: 104,
  height: 36,
};
