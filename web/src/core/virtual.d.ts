// Served by the `grc-modules` plugin in vite.config.ts: the static part of every module's
// ModuleDef (read from its index.tsx at build time) and a loader for the rest.
declare module 'virtual:grc-modules' {
  export interface ModuleEntry {
    /** Source file, for messages. */
    file: string;
    /** Present when the module's definition could be read at build time. */
    manifest?: {
      key: string;
      nav: unknown[];
      create: unknown[];
      routes: { path: string; permission?: string }[];
      publicRoutes: { path: string }[];
    };
    /** Loads the module's own chunk (with `manifest`). */
    load?: () => Promise<{ default?: unknown }>;
    /** The whole module, loaded at start (when its definition could not be read at build time). */
    eager?: { default?: unknown };
  }
  export const entries: ModuleEntry[];
}
