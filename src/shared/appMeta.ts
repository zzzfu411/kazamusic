export const APP_VERSION = "2.1.4";

export const appMeta = {
  name: "KAZAM",
  version: APP_VERSION,
} as const;

export type AppMeta = typeof appMeta;
