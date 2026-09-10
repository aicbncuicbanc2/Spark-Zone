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

// Per-urgency colors, matching the mockups' bucket cards and status chips
// (Expired/Critical red, Soon/Upcoming amber, ok/active green).
export const urgencyColors = {
  expired: '#C0392B',
  critical: '#D35400',
  soon: '#B9770E',
  upcoming: '#9A7D0A',
  ok: '#1E8449',
};

export const statusColors = {
  active: '#1E8449',
  consumed: '#9A7D0A',
  discarded: '#D35400',
  expired: '#C0392B',
};
