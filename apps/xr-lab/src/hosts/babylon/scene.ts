import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import "@babylonjs/core/Culling/ray"; // side effect: scene picking
import { Engine } from "@babylonjs/core/Engines/engine";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
// Side effect (Babylon 9 splits modules into pure and side-effect variants):
// registers the built-in "generic-trigger" controller and profile fallbacks.
import "@babylonjs/core/XR/motionController/webXRMotionControllerManager";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRSessionManager } from "@babylonjs/core/XR/webXRSessionManager";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import {
  getProbe,
  recordDrawn,
  recordFrame,
  testHooksEnabled,
  textureCreated,
  textureDisposed,
} from "../../contracts/hostProbe";
import {
  CAMERA,
  handleLayout,
  panelLayout,
  type HostCameraFrame,
  type HostEvents,
  type HostManipulation,
  type HostManipulationMode,
  type HostPanel,
  type HostRay,
  type PanelPart,
} from "../../contracts/xrHost";
import { trackManipulationPointer } from "../shared/manipulationPointer";
import {
  describeBody,
  drawButtonFace,
  drawPanelFace,
  pixelSize,
} from "../shared/panelFace";

/** Metadata on every pickable panel mesh. */
interface PartMeta {
  panelId: string;
  part: string;
  buttonId?: string;
  handle?: HostManipulationMode;
}

interface PartEntry {
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
  layout: PanelPart;
  hovered: boolean;
  /** A manipulation handle in use. */
  pressed: boolean;
}

interface PanelEntry {
  root: TransformNode;
  parts: Map<string, PartEntry>;
  /** Layout signature: rebuild when the set of buttons changes. */
  signature: string;
  drawn: { title: string; body: HostPanel["body"]; selected: boolean } | null;
}

const metaOf = (mesh: AbstractMesh | null | undefined) =>
  (mesh?.metadata ?? null) as PartMeta | null;

export const isVRSupported = () =>
  WebXRSessionManager.IsSessionSupportedAsync("immersive-vr");

/**
 * Babylon.js scene for the XR Lab: engine, scene, camera, lighting, floor
 * and floating panels, plus Babylon's WebXR experience. Plain Babylon.js,
 * no React and no other rendering engine.
 */
export class BabylonLabScene {
  readonly #canvas: HTMLCanvasElement;
  readonly #engine: Engine;
  readonly #scene: Scene;
  readonly #camera: ArcRotateCamera;
  readonly #panels = new Map<string, PanelEntry>();
  readonly #resizeObserver: ResizeObserver;
  readonly #disconnectPointerLifecycle: () => void;
  #cameraFrameListener: ((frame: HostCameraFrame) => void) | null = null;
  readonly #cameraFrame = {
    viewProjection: [] as ArrayLike<number>,
    viewport: { left: 0, top: 0, width: 0, height: 0 },
    eye: [0, 0, 0] as [number, number, number],
  };
  #events: HostEvents;
  #manipulation: HostManipulation | null = null;
  /** The manipulation pointer session in progress (ends it when called). */
  #drag: (() => void) | null = null;
  #xr: WebXRDefaultExperience | null = null;
  /** The control under each pointer (mouse, each XR controller). */
  readonly #hoveredBy = new Map<number, PartEntry>();
  #lastFrame: number | null = null;
  #disposed = false;
  onSessionModeChange: (mode: string | null) => void = () => {};

  constructor(canvas: HTMLCanvasElement, events: HostEvents) {
    this.#canvas = canvas;
    this.#events = events;
    this.#engine = new Engine(canvas, true, { stencil: true }, false);
    const scene = new Scene(this.#engine);
    this.#scene = scene;
    // Same world convention as the contract: y up, -z forward.
    scene.useRightHandedSystem = true;
    scene.clearColor = Color4.FromHexString("#dde3eaff");

    this.#camera = new ArcRotateCamera(
      "desktop-camera",
      0,
      0,
      1,
      Vector3.Zero(),
      scene,
    );
    this.#camera.fov = (CAMERA.fov * Math.PI) / 180;
    this.#camera.minZ = 0.01;
    this.#camera.wheelPrecision = 50;
    this.resetView();
    this.#camera.attachControl(canvas, true);

    const hemi = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.7;
    const sun = new DirectionalLight("sun", new Vector3(-2, -4, -3), scene);
    sun.intensity = 0.6;

    const ground = CreateGround("ground", { width: 10, height: 10 }, scene);
    const groundMaterial = new StandardMaterial("ground", scene);
    groundMaterial.diffuseColor = Color3.FromHexString("#c8d1dc");
    groundMaterial.specularColor = Color3.Black();
    ground.material = groundMaterial;
    ground.isPickable = false;
    const lines: Vector3[][] = [];
    for (let i = -10; i <= 10; i++) {
      const v = i * 0.5;
      lines.push([new Vector3(v, 0.001, -5), new Vector3(v, 0.001, 5)]);
      lines.push([new Vector3(-5, 0.001, v), new Vector3(5, 0.001, v)]);
    }
    const grid = CreateLineSystem("grid", { lines }, scene);
    grid.color = Color3.FromHexString("#a5adb8");
    grid.isPickable = false;

    // Mouse input and XR controller selects (Babylon's pointer selection
    // feature turns them into scene pointer events) arrive here alike.
    // Desktop actions consume a validated release exactly once. Babylon's
    // tap classifier excludes exactly DoubleClickDelay from both single and
    // double taps. XR/touch keep their existing engine-generated tap path.
    const pressed = new Map<number, PartMeta | null>();
    const mousePressed = new Map<
      number,
      {
        meta: PartMeta;
        mesh: AbstractMesh;
        x: number;
        y: number;
        button: number;
        dragged: boolean;
        events: HostEvents;
      }
    >();
    const activate = (meta: PartMeta, events: HostEvents) => {
      if (meta.buttonId) events.onPanelButton(meta.panelId, meta.buttonId);
      else if (meta.part === "close") events.onPanelClose(meta.panelId);
      else events.onPanelSelect(meta.panelId);
    };
    const trackMovement = (pointer: PointerEvent) => {
      const press = mousePressed.get(pointer.pointerId);
      if (
        press &&
        (Math.abs(pointer.clientX - press.x) > Scene.DragMovementThreshold ||
          Math.abs(pointer.clientY - press.y) > Scene.DragMovementThreshold)
      )
        press.dragged = true;
    };
    const cancel = (event: PointerEvent) => {
      mousePressed.delete(event.pointerId);
      pressed.delete(event.pointerId);
    };
    const blur = () => {
      mousePressed.clear();
      pressed.clear();
    };
    // Babylon synthesizes a button release when the canvas loses focus. That
    // is focus loss, not a user release: clear presses in the window capture
    // phase, which always runs before the engine's own canvas blur listener.
    const canvasBlur = (event: FocusEvent) => {
      if (event.target === canvas) blur();
    };
    canvas.addEventListener("pointercancel", cancel, true);
    // The engine coalesces move picking until a frame; latch native movement
    // too, so a fast out-and-back can never become an accidental activation.
    window.addEventListener("pointermove", trackMovement, true);
    window.addEventListener("blur", blur);
    window.addEventListener("blur", canvasBlur, true);
    this.#disconnectPointerLifecycle = () => {
      canvas.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("pointermove", trackMovement, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("blur", canvasBlur, true);
      blur();
    };
    scene.onPointerObservable.add((info) => {
      const pointer = info.event as PointerEvent;
      const pointerId = pointer.pointerId;
      const mouse = pointer.pointerType === "mouse";
      if (info.type === PointerEventTypes.POINTERDOWN) {
        const mesh = info.pickInfo?.hit ? info.pickInfo.pickedMesh : null;
        const meta = metaOf(mesh);
        if (mouse && meta?.handle) {
          // A handle press starts a manipulation; it never activates.
          mousePressed.delete(pointerId);
          this.#beginManipulation(meta.panelId, meta.handle, pointer);
          return;
        }
        if (mouse) {
          mousePressed.delete(pointerId);
          if (mesh && meta)
            mousePressed.set(pointerId, {
              meta,
              mesh,
              x: pointer.clientX,
              y: pointer.clientY,
              button: pointer.button,
              dragged: false,
              events: this.#events,
            });
        } else pressed.set(pointerId, meta);
      } else if (
        info.type === PointerEventTypes.POINTERTAP ||
        info.type === PointerEventTypes.POINTERDOUBLETAP
      ) {
        if (mouse) return;
        // A tap is a press and release without dragging: activate what the
        // pointer was pressed on. Babylon reports a second quick tap as a
        // double tap instead (never both), and each one is a real click.
        const meta = pressed.get(pointerId) ?? null;
        pressed.delete(pointerId);
        if (!meta) return;
        activate(meta, this.#events);
      } else if (info.type === PointerEventTypes.POINTERUP) {
        if (mouse) {
          trackMovement(pointer);
          const press = mousePressed.get(pointerId);
          // Consume before dispatch, including cancelled/removed-target releases.
          mousePressed.delete(pointerId);
          if (
            press &&
            !press.dragged &&
            pointer.type !== "pointercancel" &&
            pointer.button === press.button &&
            !press.mesh.isDisposed() &&
            info.pickInfo?.hit &&
            info.pickInfo.pickedMesh === press.mesh
          )
            activate(press.meta, press.events);
          return;
        }
        // Released after a drag (no tap): forget the press.
        queueMicrotask(() => pressed.delete(pointerId));
      } else if (info.type === PointerEventTypes.POINTERMOVE) {
        if (mouse) trackMovement(pointer);
        // Controls opt in to move picking (enablePointerMoveEvents).
        const meta = metaOf(
          info.pickInfo?.hit ? info.pickInfo.pickedMesh : null,
        );
        this.#setHovered(
          pointerId,
          meta && meta.part !== "background" ? meta : null,
        );
      }
    });

    // While a panel is manipulated the camera must not orbit or zoom: its
    // pointer input never sees the moves (or wheel) of that drag. Presses
    // and releases still reach it, so its own state stays consistent.
    scene.onPrePointerObservable.add((info) => {
      if (
        this.#drag &&
        (info.type === PointerEventTypes.POINTERMOVE ||
          info.type === PointerEventTypes.POINTERWHEEL)
      )
        info.skipOnPointerObservable = true;
    });

    scene.onAfterRenderObservable.add(() => {
      this.#reportCameraFrame();
      const now = performance.now();
      recordFrame(this.#lastFrame === null ? null : now - this.#lastFrame);
      this.#lastFrame = now;
    });
    this.#engine.runRenderLoop(() => scene.render());

    this.#resizeObserver = new ResizeObserver(() => this.#engine.resize());
    this.#resizeObserver.observe(canvas);
    this.#bindProbe();
  }

  setEvents(events: HostEvents) {
    this.#events = events;
  }

  #rayAt(clientX: number, clientY: number): HostRay {
    const rect = this.#canvas.getBoundingClientRect();
    const ray = this.#scene.createPickingRay(
      clientX - rect.left,
      clientY - rect.top,
      Matrix.Identity(),
      this.#camera,
    );
    return {
      origin: [ray.origin.x, ray.origin.y, ray.origin.z],
      direction: [ray.direction.x, ray.direction.y, ray.direction.z],
    };
  }

  #beginManipulation(
    panelId: string,
    mode: HostManipulationMode,
    pointer: PointerEvent,
  ) {
    const manipulation = this.#manipulation;
    if (!manipulation || pointer.button !== 0 || this.#drag) return;
    const token = manipulation.begin(
      panelId,
      mode,
      pointer.pointerId,
      this.#rayAt(pointer.clientX, pointer.clientY),
    );
    if (token === null) return;
    pointer.preventDefault();
    this.#drag = trackManipulationPointer({
      token,
      pointerId: pointer.pointerId,
      manipulation,
      toRay: (x, y) => this.#rayAt(x, y),
      onRelease: () => {
        this.#drag = null;
      },
    });
  }

  /** Receives the final camera of every rendered frame (see HostCameraFrame). */
  setCameraFrameListener(listener: ((frame: HostCameraFrame) => void) | null) {
    this.#cameraFrameListener = listener;
  }

  #reportCameraFrame() {
    const listener = this.#cameraFrameListener;
    const camera = this.#scene.activeCamera;
    if (!listener || !camera) return;
    const rect = this.#canvas.getBoundingClientRect();
    const frame = this.#cameraFrame;
    // Babylon stores matrices for row vectors, which is the same memory
    // layout as column-major matrices for column vectors (WebGL convention).
    frame.viewProjection = this.#scene.getTransformMatrix().m;
    frame.viewport.left = rect.left;
    frame.viewport.top = rect.top;
    frame.viewport.width = rect.width;
    frame.viewport.height = rect.height;
    const eye = camera.globalPosition;
    frame.eye[0] = eye.x;
    frame.eye[1] = eye.y;
    frame.eye[2] = eye.z;
    listener(frame);
  }

  /** Reconciles the scene with the given panels and manipulation handles. */
  setPanels(
    panels: readonly HostPanel[],
    manipulation: HostManipulation | null = null,
  ) {
    this.#manipulation = manipulation;
    const handles = new Set(manipulation?.panels ?? []);
    const ids = new Set(panels.map((panel) => panel.id));
    for (const [id, entry] of this.#panels) {
      if (!ids.has(id)) this.#disposePanel(id, entry);
    }
    for (const panel of panels) {
      const signature =
        panel.buttons.map((b) => `${b.id}:${b.label}`).join("|") +
        (handles.has(panel.id) ? "|handles" : "");
      let entry = this.#panels.get(panel.id);
      if (entry && entry.signature !== signature) {
        this.#disposePanel(panel.id, entry);
        entry = undefined;
      }
      entry ??= this.#createPanel(panel, signature, handles.has(panel.id));
      const [x, y, z] = panel.position;
      const [qx, qy, qz, qw] = panel.rotation ?? [0, 0, 0, 1];
      const scale = panel.scale ?? 1;
      const rotation = entry.root.rotationQuaternion!;
      if (
        !entry.root.position.equalsToFloats(x, y, z) ||
        !(
          rotation.x === qx &&
          rotation.y === qy &&
          rotation.z === qz &&
          rotation.w === qw
        ) ||
        !entry.root.scaling.equalsToFloats(scale, scale, scale)
      ) {
        entry.root.position.set(x, y, z);
        rotation.set(qx, qy, qz, qw);
        entry.root.scaling.setAll(scale);
        // Babylon caches world matrices until the next render. Refresh them
        // now so picking and probes use the new position immediately.
        entry.root.computeWorldMatrix(true);
        for (const part of entry.parts.values())
          part.mesh.computeWorldMatrix(true);
      }
      const drawn = entry.drawn;
      if (
        !drawn ||
        drawn.title !== panel.title ||
        drawn.body !== panel.body ||
        drawn.selected !== panel.selected
      ) {
        const background = entry.parts.get("background")!;
        const ctx =
          background.texture.getContext() as unknown as CanvasRenderingContext2D;
        const { width, height } = background.texture.getSize();
        drawPanelFace(
          ctx,
          width,
          height,
          panel.title,
          panel.body,
          panel.selected,
        );
        background.texture.update();
        entry.drawn = {
          title: panel.title,
          body: panel.body,
          selected: panel.selected,
        };
        recordDrawn(panel.id, describeBody(panel.body));
      }
      for (const part of entry.parts.values()) {
        if (!part.layout.handle) continue;
        const pressed =
          manipulation?.active?.panelId === panel.id &&
          manipulation.active.mode === part.layout.handle;
        if (pressed !== part.pressed) {
          part.pressed = pressed;
          this.#drawControl(part);
        }
      }
    }
    getProbe().panels = panels.map((panel) => panel.id);
  }

  resetView() {
    // Stop any orbit still coasting from a drag (camera inertia).
    this.#camera.inertialAlphaOffset = 0;
    this.#camera.inertialBetaOffset = 0;
    this.#camera.inertialRadiusOffset = 0;
    this.#camera.inertialPanningX = 0;
    this.#camera.inertialPanningY = 0;
    this.#camera.setTarget(new Vector3(...CAMERA.target));
    this.#camera.setPosition(new Vector3(...CAMERA.position));
  }

  /** Enters immersive VR. Must be called from a user gesture. */
  async enterVR() {
    const xr = await this.#ensureXR();
    await xr.baseExperience.enterXRAsync("immersive-vr", "local-floor");
  }

  async exitVR() {
    await this.#xr?.baseExperience.exitXRAsync();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#drag?.();
    this.#disconnectPointerLifecycle();
    this.#resizeObserver.disconnect();
    for (const [id, entry] of this.#panels) this.#disposePanel(id, entry);
    this.#xr?.dispose();
    this.#engine.stopRenderLoop();
    this.#scene.dispose();
    this.#engine.dispose();
  }

  async #ensureXR() {
    this.#xr ??= await WebXRDefaultExperience.CreateAsync(this.#scene, {
      // The lab's own toolbar enters XR; no teleportation, hands or near
      // interaction: panels are used with the controller ray only.
      disableDefaultUI: true,
      disableTeleportation: true,
      disableHandTracking: true,
      disableNearInteraction: true,
      // Every controller has its own active ray, as in the Three.js host
      // (Babylon's default lets only one controller point at a time).
      pointerSelectionOptions: { enablePointerSelectionOnAllControllers: true },
      inputOptions: {
        // Controller models and profiles would load from a remote CDN.
        doNotLoadControllerMeshes: true,
        disableOnlineControllerRepository: true,
        // Without the online repository, use WebXR's standard generic
        // trigger profile (built into Babylon) for every controller, so the
        // trigger drives selection on any device. No device-specific profile
        // is needed: panels use the ray and the trigger only.
        forceInputProfile: "generic-trigger",
      },
    });
    const xr = this.#xr;
    // On entering XR, Babylon copies the desktop camera's position and yaw
    // into the XR camera, and the first XR frame turns that into a
    // reference-space offset (the user starts where the desktop camera
    // was). The host contract shares one world frame across engines (XR
    // origin = world origin, as in the Three.js host), so reset the initial
    // pose in the documented hook, before the first frame applies it.
    xr.baseExperience.onInitialXRPoseSetObservable.add((xrCamera) => {
      xrCamera.position.set(0, 0, 0);
      xrCamera.rotationQuaternion.set(0, 0, 0, 1);
    });
    xr.baseExperience.onStateChangedObservable.add((state) => {
      const mode = state === WebXRState.IN_XR ? "immersive-vr" : null;
      if (state === WebXRState.IN_XR || state === WebXRState.NOT_IN_XR) {
        getProbe().sessionMode = mode;
        this.onSessionModeChange(mode);
      }
    });
    return xr;
  }

  #createPanel(
    panel: HostPanel,
    signature: string,
    handles: boolean,
  ): PanelEntry {
    const root = new TransformNode(`panel:${panel.id}`, this.#scene);
    root.rotationQuaternion = Quaternion.Identity();
    const parts = new Map<string, PartEntry>();
    for (const layout of [
      ...panelLayout(panel),
      ...(handles ? handleLayout() : []),
    ]) {
      const mesh = CreatePlane(
        `${panel.id}:${layout.part}`,
        { width: layout.width, height: layout.height },
        this.#scene,
      );
      mesh.parent = root;
      mesh.position.set(...layout.center);
      // In a right-handed scene the plane's front face points down -z, away
      // from the viewer; turn it to face +z (towards the user).
      mesh.rotation.y = Math.PI;
      const meta: PartMeta = {
        panelId: panel.id,
        part: layout.part,
        ...(layout.buttonId && { buttonId: layout.buttonId }),
        ...(layout.handle && { handle: layout.handle }),
      };
      mesh.metadata = meta;
      // Hover feedback: Babylon picks on pointer move only for meshes that
      // opt in.
      mesh.enablePointerMoveEvents = layout.part !== "background";
      const texture = new DynamicTexture(
        `${panel.id}:${layout.part}`,
        { width: pixelSize(layout.width), height: pixelSize(layout.height) },
        this.#scene,
        true,
      );
      // The plane is turned to face +z, which mirrors its UVs: flip back
      // (u -> 1 - u; the texture clamps, so the offset is required).
      texture.uScale = -1;
      texture.uOffset = 1;
      textureCreated();
      const material = new StandardMaterial(
        `${panel.id}:${layout.part}`,
        this.#scene,
      );
      material.emissiveTexture = texture;
      material.disableLighting = true;
      mesh.material = material;
      const entry: PartEntry = {
        mesh,
        material,
        texture,
        layout,
        hovered: false,
        pressed: false,
      };
      if (layout.part !== "background") this.#drawControl(entry);
      parts.set(layout.part, entry);
    }
    const entry: PanelEntry = { root, parts, signature, drawn: null };
    this.#panels.set(panel.id, entry);
    return entry;
  }

  #drawControl(entry: PartEntry) {
    const ctx =
      entry.texture.getContext() as unknown as CanvasRenderingContext2D;
    const { width, height } = entry.texture.getSize();
    drawButtonFace(
      ctx,
      width,
      height,
      entry.layout.label ?? "",
      entry.hovered || entry.pressed,
    );
    entry.texture.update();
  }

  /** A control is hovered while any pointer is over it. */
  #setHovered(pointerId: number, meta: PartMeta | null) {
    const next = meta
      ? (this.#panels.get(meta.panelId)?.parts.get(meta.part) ?? null)
      : null;
    const previous = this.#hoveredBy.get(pointerId) ?? null;
    if (next === previous) return;
    if (next) this.#hoveredBy.set(pointerId, next);
    else this.#hoveredBy.delete(pointerId);
    for (const entry of [previous, next]) {
      if (!entry) continue;
      const hovered = [...this.#hoveredBy.values()].includes(entry);
      if (hovered !== entry.hovered) {
        entry.hovered = hovered;
        this.#drawControl(entry);
      }
    }
  }

  #disposePanel(id: string, entry: PanelEntry) {
    for (const part of entry.parts.values()) {
      for (const [pointerId, hovered] of this.#hoveredBy) {
        if (hovered === part) this.#hoveredBy.delete(pointerId);
      }
      part.mesh.dispose();
      part.material.dispose();
      part.texture.dispose();
      textureDisposed();
    }
    entry.root.dispose();
    this.#panels.delete(id);
  }

  #findPart(panelId: string, part: string) {
    return this.#panels.get(panelId)?.parts.get(part);
  }

  #bindProbe() {
    const probe = getProbe();
    probe.locate = (panelId, part) => {
      const entry = this.#findPart(panelId, part);
      if (!entry) return null;
      const world = entry.mesh.getAbsolutePosition();
      const width = this.#engine.getRenderWidth();
      const height = this.#engine.getRenderHeight();
      const projected = Vector3.Project(
        world,
        Matrix.Identity(),
        this.#scene.getTransformMatrix(),
        this.#camera.viewport.toGlobal(width, height),
      );
      if (projected.z < 0 || projected.z > 1) return null;
      const rect = this.#canvas.getBoundingClientRect();
      return {
        x: rect.left + (projected.x * rect.width) / width,
        y: rect.top + (projected.y * rect.height) / height,
      };
    };
    probe.project = ([x, y, z]) => {
      const width = this.#engine.getRenderWidth();
      const height = this.#engine.getRenderHeight();
      const projected = Vector3.Project(
        new Vector3(x, y, z),
        Matrix.Identity(),
        this.#scene.getTransformMatrix(),
        this.#camera.viewport.toGlobal(width, height),
      );
      if (projected.z < 0 || projected.z > 1) return null;
      const rect = this.#canvas.getBoundingClientRect();
      return {
        x: rect.left + (projected.x * rect.width) / width,
        y: rect.top + (projected.y * rect.height) / height,
      };
    };
    probe.worldPosition = (panelId, part) => {
      const entry = this.#findPart(panelId, part);
      return entry
        ? (entry.mesh.getAbsolutePosition().asArray() as [
            number,
            number,
            number,
          ])
        : null;
    };
    probe.hovered = (panelId, part) =>
      this.#findPart(panelId, part)?.hovered === true;
    if (testHooksEnabled)
      probe.setCamera = (position, target) => {
        this.#camera.inertialAlphaOffset = 0;
        this.#camera.inertialBetaOffset = 0;
        this.#camera.inertialRadiusOffset = 0;
        this.#camera.setTarget(new Vector3(...target));
        this.#camera.setPosition(new Vector3(...position));
      };
  }
}
