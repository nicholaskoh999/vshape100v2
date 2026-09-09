import { createContext, useContext, useEffect } from 'react'

/**
 * SUPPRESSING THE APP CHROME, FOR ONE SCREEN THAT EARNS IT.
 *
 * Round 24 correction (Blocker 3). Focused workout mode puts Complete set at
 * the bottom of a phone, under the thumb, and the five-item bottom navigation
 * sits in exactly that place. Two competing targets a few pixels apart, pressed
 * one-handed and mid-set, is a mis-tap waiting to happen — and the mis-tap
 * costs the user their place in the workout.
 *
 * So the focused workspace asks for the chrome to stand down while it is
 * mounted, and the shell obliges. Deliberately narrow:
 *
 *   - it is a REQUEST from a mounted component, released automatically on
 *     unmount, so nothing can leave the app permanently without navigation
 *   - it hides the MOBILE bar only; the tablet rail and desktop sidebar are not
 *     competing for the same space and stay exactly where they are
 *   - the screen that asks for it always renders its own way out — focused mode
 *     has "Back to all exercises" and the session's own back link above it
 *
 * The setter comes from `useState` and is referentially stable, so it lives in
 * its own context: putting it in the same object as the boolean would make the
 * value change on every toggle, and the effect below would then release and
 * re-take immersion forever.
 */

export const ImmersiveSetContext = createContext<((on: boolean) => void) | null>(null)
export const ImmersiveStateContext = createContext(false)

/** Ask the shell to stand its mobile chrome down while this stays mounted. */
export function useImmersive(active: boolean): void {
  const set = useContext(ImmersiveSetContext)
  useEffect(() => {
    if (!set) return
    set(active)
    return () => set(false)
  }, [set, active])
}

/** Is some mounted screen currently asking for immersion? */
export function useImmersiveChrome(): boolean {
  return useContext(ImmersiveStateContext)
}
