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
