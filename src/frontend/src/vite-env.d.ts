/// <reference types="vite/client" />

// Typing `import.meta.env` properly matters for more than editor comfort: Vite
// only inlines the literal text `import.meta.env.VITE_*` at build time, so
// casting around it (`(import.meta as any).env?.X`) turns a build-time constant
// into a runtime lookup and defeats dead-branch elimination.
interface ImportMetaEnv {
  readonly VITE_WC_PROJECT_ID?: string;
}
