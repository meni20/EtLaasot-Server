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
  TEL_AVIV: { id: 'branch-tel-aviv', name: 'סניף נתניה', city: 'נתניה' },
  JERUSALEM: {
    id: 'branch-jerusalem',
    name: 'סניף צור הדסה',
    city: 'צור הדסה',
  },
  HAIFA: { id: 'branch-haifa', name: 'סניף בית שמש', city: 'בית שמש' },
  BEER_SHEVA: {
    id: 'branch-beer-sheva',
    name: 'סניף חריש',
    city: 'חריש',
  },
};

export const BRANCH_DISPLAY_BY_ID = Object.fromEntries(
  Object.values(BRANCHES).map((branch) => [
    branch.id,
    { name: branch.name, city: branch.city },
  ]),
);

export function applyBranchDisplay<T extends { id: string; name?: string; city?: string }>(
  branch: T | null | undefined,
) {
  if (!branch) {
    return branch;
  }

  const display = BRANCH_DISPLAY_BY_ID[branch.id];

  if (!display) {
    return branch;
  }

  if (typeof (branch as any).setDataValue === 'function') {
    (branch as any).setDataValue('name', display.name);
    if ('city' in branch) {
      (branch as any).setDataValue('city', display.city);
    }
  } else {
    branch.name = display.name;
    if ('city' in branch) {
      branch.city = display.city;
    }
  }

  return branch;
}

export const EVENT_TYPES = {
  SHABBAT: { id: 'shabbat', name: 'שבת', icon: '🕯️' },
  CAMP: { id: 'camp', name: 'מחנה', icon: '⛺' },
  PLAYROOM: { id: 'playroom', name: 'משחקייה', icon: '🧸' },
  TRIP: { id: 'trip', name: 'טיול', icon: '🥾' },
  MEETING: { id: 'meeting', name: 'פגישה', icon: '🤝' },
  HOLIDAY: { id: 'holiday', name: 'חג', icon: '🎉' },
  TRAINING: { id: 'training', name: 'הדרכה', icon: '📚' },
  GENERAL: { id: 'general', name: 'כללי', icon: '📌' },
};

export const EVENT_TYPE_IDS = Object.values(EVENT_TYPES).map((type) => type.id);

export const ROLE_ID_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(AUTH_ROLES).map(([key, role]) => [role.id, key]),
);

export const RESOURCE_TYPES = {
  BAT_YAM: {
    id: 1,
    name: 'בת ים',
  },
};

export const RESOURCE_ID_TO_NAME = Object.fromEntries(
  Object.values(RESOURCE_TYPES).map((resource) => [resource.id, resource.name]),
);
