/// <reference types="wxt/vite-builder-env" />

// Migrations are plain SQL files imported as text, so the schema lives in one
// readable place rather than inside a template literal.
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
