export const PWA_PLATFORMS = ['android', 'ios', 'chromium', 'other'] as const;

export type PwaPlatform = (typeof PWA_PLATFORMS)[number];
