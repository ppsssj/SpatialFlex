import type { HostManipulation, HostRay } from "../../contracts/xrHost";

/**
 * Follows the pointer that pressed a manipulation handle until it is
 * released. Shared by every host and by Native DOM handles, so pointer
 * lifecycle rules are identical everywhere:
 *
 * - pointermove of that pointer: `update` with the ray under the pointer
 * - pointerup: `end(commit)`; a move without the button pressed (a release
 *   missed outside the window) also commits
 * - pointercancel, window blur, the returned dispose function (unmount,
 *   host disposal): `end(cancel)`
 * - Escape: `end(cancel)` while the button stays pressed. The session is
 *   over, but the press still belongs to the handle: `onRelease` (where a
 *   host resumes its camera controls) waits for the actual release, so
 *   the rest of that drag can never orbit the camera.
 *
 * Listeners are on the window in the capture phase, so the stream is
 * followed wherever the pointer goes (canvas, page or chrome), and every
 * listener is removed on release.
 */
export function trackManipulationPointer({
  token,
  pointerId,
  toRay,
  manipulation,
  onRelease,
}: {
  token: number;
  pointerId: number;
  toRay: (clientX: number, clientY: number) => HostRay | null;
  manipulation: Pick<HostManipulation, "update" | "end">;
  onRelease?: () => void;
}): () => void {
  let ended = false;
  let released = false;
  const end = (commit: boolean) => {
    if (ended) return;
    ended = true;
    manipulation.end(token, commit);
  };
  const release = (commit: boolean) => {
    end(commit);
    if (released) return;
    released = true;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    window.removeEventListener("blur", blur);
    window.removeEventListener("keydown", key, true);
    onRelease?.();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if ((event.buttons & 1) === 0) {
      release(true);
      return;
    }
    if (ended) return;
    const ray = toRay(event.clientX, event.clientY);
    if (ray) manipulation.update(token, ray);
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    release(event.type === "pointerup");
  };
  const blur = () => release(false);
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || ended) return;
    event.preventDefault();
    event.stopPropagation();
    end(false);
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
  window.addEventListener("blur", blur);
  window.addEventListener("keydown", key, true);
  return () => release(false);
}
