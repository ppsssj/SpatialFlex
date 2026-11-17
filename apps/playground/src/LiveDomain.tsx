import {
  useGalleryDiagnostics,
  useGalleryState,
  useGalleryStore,
} from "./galleryContext";
import { GalleryImage } from "./GalleryImage";
import type { ImageVariant } from "./galleryStore";

export const IMAGE_VARIANTS: Record<ImageVariant, string> = {
  sunrise: "#c2410c",
  night: "#1e3a8a",
  mono: "#57606a",
};

/**
 * Shows the shared domain counter and calls the app's `increment` action.
 * Rendered both in the original UI and inside Image B: both instances call
 * the very same action function of the same store.
 */
export function SharedCounter({ location }: { location: "app" | "image-b" }) {
  const { actions } = useGalleryStore();
  const count = useGalleryState((state) => state.sharedCount);

  return (
    <div className="shared-counter">
      Shared count:{" "}
      <output data-testid={`shared-count-${location}`}>{count}</output>{" "}
      <button
        type="button"
        data-testid={`increment-${location}`}
        onClick={actions.increment}
      >
        Increment
      </button>
    </div>
  );
}

/** Image B, rendered from application-owned state. */
export function DomainImageB() {
  const { variant, caption } = useGalleryState((state) => state.imageB);

  return (
    <GalleryImage
      label={`Image B · ${variant}`}
      color={IMAGE_VARIANTS[variant]}
      caption={caption}
    />
  );
}

/** Original-UI controls for Image B's application-owned data. */
export function ImageBControls() {
  const { actions } = useGalleryStore();
  const { variant, caption } = useGalleryState((state) => state.imageB);

  return (
    <fieldset className="controls">
      <legend>Image B data (app state)</legend>
      <label>
        Variant{" "}
        <select
          data-testid="image-b-variant"
          value={variant}
          onChange={(event) =>
            actions.setImageVariant(event.target.value as ImageVariant)
          }
        >
          {Object.keys(IMAGE_VARIANTS).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Caption{" "}
        <input
          data-testid="image-b-caption"
          value={caption}
          onChange={(event) => actions.setImageCaption(event.target.value)}
        />
      </label>
    </fieldset>
  );
}

/** Developer-facing counters for domain actions and state subscriptions. */
export function DomainDiagnosticsView() {
  const {
    actionCalls,
    activeSubscriptions,
    totalSubscribes,
    totalUnsubscribes,
  } = useGalleryDiagnostics();

  return (
    <section aria-labelledby="domain-heading">
      <h2 id="domain-heading">Domain diagnostics</h2>
      <dl className="diagnostics">
        <dt>increment() calls</dt>
        <dd data-testid="increment-calls">{actionCalls.increment}</dd>
        <dt>Active state subscriptions</dt>
        <dd data-testid="active-subscriptions">{activeSubscriptions}</dd>
        <dt>Subscribes / unsubscribes</dt>
        <dd data-testid="subscription-totals">
          {totalSubscribes} / {totalUnsubscribes}
        </dd>
      </dl>
    </section>
  );
}
