/**
 * SQL files imported as text.
 *
 * Vite serves any file as a string with the `?raw` suffix, which lets a test
 * read a migration without Node's filesystem types. That matters here: the app
 * project deliberately restricts its ambient `types`, and a test should not be
 * the reason to widen them.
 */
declare module '*.sql?raw' {
  const content: string
  export default content
}
