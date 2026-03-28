export const AUTH_ROLES = {
  SUPER_ADMIN: {
    id: 10001,
    name: 'מנהל על',
  },
  BRANCH_ADMIN: {
    id: 10000,
    name: 'מנהל סניף',
  },
  VOLUNTEER: {
    id: 1,
    name: 'מתנדב',
  },
  TRAINEE: {
    id: 2,
    name: 'חניך',
  },
};

export const BRANCHES = {
  BAT_YAM: { id: 'branch-bat-yam', name: 'סניף בת ים', city: 'בת ים' },
  TEL_AVIV: { id: 'branch-tel-aviv', name: 'סניף תל אביב', city: 'תל אביב' },
  JERUSALEM: { id: 'branch-jerusalem', name: 'סניף ירושלים', city: 'ירושלים' },
  HAIFA: { id: 'branch-haifa', name: 'סניף חיפה', city: 'חיפה' },
  BEER_SHEVA: {
    id: 'branch-beer-sheva',
    name: 'סניף באר שבע',
    city: 'באר שבע',
  },
};

export const EVENT_TYPES = {
  SHABBAT: { id: 'shabbat', name: 'שבת', icon: '🕯️' },
  CAMP: { id: 'camp', name: 'מחנה', icon: '⛺' },
  TRIP: { id: 'trip', name: 'טיול', icon: '🥾' },
  MEETING: { id: 'meeting', name: 'פגישה', icon: '🤝' },
  HOLIDAY: { id: 'holiday', name: 'חג', icon: '🎉' },
  TRAINING: { id: 'training', name: 'הדרכה', icon: '📚' },
  GENERAL: { id: 'general', name: 'כללי', icon: '📌' },
};

export const ROLE_ID_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(AUTH_ROLES).map(([key, r]) => [r.id, key]),
);

// Keep backward compatibility
export const RESOURCE_TYPES = {
  BAT_YAM: {
    id: 1,
    name: 'בת ים',
  },
};

export const RESOURCE_ID_TO_NAME = Object.fromEntries(
  Object.values(RESOURCE_TYPES).map((r) => [r.id, r.name]),
);
