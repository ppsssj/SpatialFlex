import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CAMERA, PANEL_SIZE, type HostCameraFrame } from "../contracts/xrHost";
import {
  extractionPosition,
  nativePanelTransform,
  occlusionClipPath,
  pageClipPath,
  projectPoint,
  surfacePoint,
  surfaceTransform,
  type SpatialWebSurfacePose,
} from "./surfaceMath";
import { DEFAULT_SURFACE_POSE, SURFACE_RESOLUTION } from "./surfaceConfig";

const VIEWPORT = { left: 0, top: 0, width: 980, height: 760 };

function frameFrom(camera: PerspectiveCamera): HostCameraFrame {
  camera.updateMatrixWorld();
  const vp = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const eye = camera.getWorldPosition(new Vector3());
  return {
    viewProjection: vp.elements,
    viewport: VIEWPORT,
    eye: [eye.x, eye.y, eye.z],
  };
}

function deskCamera(position = CAMERA.position) {
  const camera = new PerspectiveCamera(
    CAMERA.fov,
    VIEWPORT.width / VIEWPORT.height,
    0.01,
    100,
  );
  camera.position.set(...position);
  camera.lookAt(...CAMERA.target);
  camera.updateProjectionMatrix();
  return camera;
}

/** Independent reference path: Three.js' own projection. */
function threeProject(camera: PerspectiveCamera, p: readonly number[]) {
  const ndc = new Vector3(p[0], p[1], p[2]).project(camera);
  return {
    x: ((ndc.x + 1) / 2) * VIEWPORT.width,
    y: ((1 - ndc.y) / 2) * VIEWPORT.height,
  };
}

/** Applies a CSS matrix3d string to a page point, as the browser does. */
function applyCss(matrix3d: string, u: number, v: number) {
  const m = matrix3d.slice(9, -1).split(",").map(Number);
  const x = m[0]! * u + m[4]! * v + m[12]!;
  const y = m[1]! * u + m[5]! * v + m[13]!;
  const w = m[3]! * u + m[7]! * v + m[15]!;
  return { x: x / w, y: y / w };
}

describe("spatial web surface projection", () => {
  const pose = DEFAULT_SURFACE_POSE;
  const res = SURFACE_RESOLUTION;

  for (const [name, position] of [
    ["default camera", CAMERA.position],
    ["orbited camera", [1.3, 1.9, 0.4]],
    ["low oblique camera", [-1.5, 0.9, 0.2]],
  ] as const)
    it(`matches the renderer's projection for every page point (${name})`, () => {
      const camera = deskCamera(position);
      const frame = frameFrom(camera);
      const result = surfaceTransform(frame, pose, res);
      expect(result.visibility).toBe("visible");
      if (result.visibility !== "visible") return;
      for (const [u, v] of [
        [0, 0],
        [res.width, 0],
        [0, res.height],
        [res.width, res.height],
        [res.width / 3, (res.height * 2) / 3],
      ] as const) {
        const expected = threeProject(camera, surfacePoint(pose, res, u, v));
        const actual = applyCss(result.matrix3d, u, v);
        expect(actual.x).toBeCloseTo(expected.x, 4);
        expect(actual.y).toBeCloseTo(expected.y, 4);
        expect(
          projectPoint(frame, surfacePoint(pose, res, u, v))!.x,
        ).toBeCloseTo(expected.x, 4);
      }
    });

  it("is a real perspective projection, not an affine screen overlay", () => {
    const frame = frameFrom(deskCamera([1.4, 1.5, 0.6]));
    const result = surfaceTransform(frame, pose, res);
    if (result.visibility !== "visible") throw new Error("not visible");
    const tl = applyCss(result.matrix3d, 0, 0);
    const bl = applyCss(result.matrix3d, 0, res.height);
    const tr = applyCss(result.matrix3d, res.width, 0);
    const br = applyCss(result.matrix3d, res.width, res.height);
    // The nearer (right) edge projects taller than the farther (left) edge.
    expect(br.y - tr.y).toBeGreaterThan((bl.y - tl.y) * 1.05);
  });

  it("hides the surface from behind and when it crosses the camera plane", () => {
    expect(
      surfaceTransform(frameFrom(deskCamera([-0.3, 1.4, -3])), pose, res)
        .visibility,
    ).toBe("back");
    const close: SpatialWebSurfacePose = { ...pose, position: [0, 1.5, 0.95] };
    expect(
      surfaceTransform(frameFrom(deskCamera()), close, res).visibility,
    ).toBe("behind");
  });

  it("cuts out only 3D rectangles in front of the surface", () => {
    const frame = frameFrom(deskCamera());
    const front = {
      center: surfacePoint(pose, res, res.width / 2, res.height / 2),
      width: 0.3,
      height: 0.2,
    };
    const inFront = {
      ...front,
      center: [
        front.center[0],
        front.center[1],
        front.center[2] + 0.3,
      ] as const,
    };
    const behind = {
      ...front,
      center: [
        front.center[0],
        front.center[1],
        front.center[2] - 0.3,
      ] as const,
    };
    expect(occlusionClipPath(frame, pose, res, [behind])).toBe("none");
    const clip = occlusionClipPath(frame, pose, res, [inFront]);
    expect(clip).toMatch(/^polygon\(evenodd, 0px 0px, 720px 0px/);
    // The hole lies inside the page.
    const points = [...clip.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)]
      .slice(5)
      .map((m) => [Number(m[1]), Number(m[2])]);
    for (const [u, v] of points.slice(0, 4)) {
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(res.width);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(res.height);
    }
  });

  it("places extracted panels beside the surface without overlapping it", () => {
    const camera = deskCamera();
    const frame = frameFrom(camera);
    const rightEdge = Math.max(
      threeProject(camera, surfacePoint(pose, res, res.width, 0)).x,
      threeProject(camera, surfacePoint(pose, res, res.width, res.height)).x,
    );
    for (let index = 0; index < 3; index++) {
      const [x, y, z] = extractionPosition(pose, index, PANEL_SIZE);
      const left = projectPoint(frame, [x - PANEL_SIZE.width / 2, y, z])!;
      const right = projectPoint(frame, [x + PANEL_SIZE.width / 2, y, z])!;
      const bottom = projectPoint(frame, [x, y - PANEL_SIZE.height / 2, z])!;
      expect(left.x).toBeGreaterThan(rightEdge + 10);
      expect(right.x).toBeLessThan(VIEWPORT.width);
      expect(bottom.y).toBeLessThan(VIEWPORT.height);
      // In front of the surface plane: never hidden behind the page.
      expect(z).toBeGreaterThan(pose.position[2]);
    }
  });

  for (const [name, position] of [
    ["default camera", CAMERA.position],
    ["orbited camera", [1.2, 1.8, 0.5]],
  ] as const)
    it(`native panel: page transform × panel transform = its own world projection (${name})`, () => {
      const camera = deskCamera(position);
      const frame = frameFrom(camera);
      const page = surfaceTransform(frame, pose, res);
      if (page.visibility !== "visible") throw new Error("page hidden");
      const panelRes = { width: 276, height: 152 };
      const mpp = pose.width / res.width;
      const panelPose: SpatialWebSurfacePose = {
        position: extractionPosition(pose, 0, {
          width: panelRes.width * mpp,
          height: panelRes.height * mpp,
        }),
        rotation: pose.rotation,
        width: panelRes.width * mpp,
        height: panelRes.height * mpp,
      };
      const border = 2;
      const placed = nativePanelTransform(
        frame,
        { pose, resolution: res, border },
        { pose: panelPose, resolution: panelRes },
      );
      if (placed.visibility !== "visible") throw new Error("not placed");
      expect(placed.behindPage).toBe(false);
      for (const [u, v] of [
        [0, 0],
        [panelRes.width, 0],
        [0, panelRes.height],
        [panelRes.width, panelRes.height],
        [100, 40],
      ] as const) {
        // The element's own transform, then the containing-block offset,
        // then the page's transform: what the browser composes.
        const inPage = applyCss(placed.matrix3d, u, v);
        const screen = applyCss(
          page.matrix3d,
          inPage.x + border,
          inPage.y + border,
        );
        const expected = threeProject(
          camera,
          surfacePoint(panelPose, panelRes, u, v),
        );
        expect(screen.x).toBeCloseTo(expected.x, 3);
        expect(screen.y).toBeCloseTo(expected.y, 3);
      }
      // Outside the page: the element extends beyond the page's own box.
      expect(Math.min(...placed.pageQuad.map(([x]) => x))).toBeGreaterThan(
        res.width,
      );
      // The page clip keeps that footprint (nonzero union).
      const clip = pageClipPath(frame, pose, res, [], [placed.pageQuad]);
      expect(clip).toMatch(
        /^path\(nonzero, "M 0 0 L 720 0 L 720 \d+ L 0 \d+ Z M /,
      );
    });

  it("native panel behind the page plane is reported for occlusion", () => {
    const frame = frameFrom(deskCamera());
    const panelRes = { width: 200, height: 100 };
    const placed = nativePanelTransform(
      frame,
      { pose, resolution: res, border: 2 },
      {
        pose: {
          position: [
            pose.position[0],
            pose.position[1],
            pose.position[2] - 0.5,
          ],
          rotation: pose.rotation,
          width: 0.4,
          height: 0.2,
        },
        resolution: panelRes,
      },
    );
    expect(placed).toMatchObject({ visibility: "visible", behindPage: true });
    expect(pageClipPath(frame, pose, res, [], [])).toBe("none");
  });
});
