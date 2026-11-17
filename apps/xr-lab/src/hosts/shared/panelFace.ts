import type { HostPanelBody } from "../../contracts/xrHost";

/**
 * Panel and button faces, drawn with the 2D canvas API and local system
 * fonts. Shared by every host so that all engines show identical pixels;
 * each engine only wraps the canvas in its own texture type. No rendering
 * engine is imported here.
 */

/** Texture resolution: pixels per meter of panel surface. */
export const PIXELS_PER_METER = 1000;

export const pixelSize = (meters: number) =>
  Math.round(meters * PIXELS_PER_METER);

export function drawPanelFace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  body: HostPanelBody,
  selected: boolean,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f6f8fa";
  ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = selected ? 16 : 6;
  ctx.strokeStyle = selected ? "#0969da" : "#8c959f";
  ctx.strokeRect(
    ctx.lineWidth / 2,
    ctx.lineWidth / 2,
    width - ctx.lineWidth,
    height - ctx.lineWidth,
  );

  ctx.fillStyle = "#1f2328";
  ctx.font = "bold 40px sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(title, 28, 24);

  const top = 90;
  const bottom = height - 110; // room for the button row
  switch (body.kind) {
    case "value": {
      ctx.font = "32px sans-serif";
      ctx.fillStyle = "#57606a";
      ctx.fillText(body.label, 28, top);
      ctx.font = "bold 120px sans-serif";
      ctx.fillStyle = "#1f2328";
      ctx.fillText(body.value, 28, top + 44);
      break;
    }
    case "bars": {
      ctx.font = "32px sans-serif";
      ctx.fillStyle = "#57606a";
      ctx.fillText(body.label, 28, top);
      const max = Math.max(1, ...body.values);
      const areaTop = top + 50;
      const slot = (width - 56) / Math.max(1, body.values.length);
      body.values.forEach((value, i) => {
        const h = ((bottom - areaTop) * value) / max;
        ctx.fillStyle = "#2f6fdf";
        ctx.fillRect(28 + i * slot + 4, bottom - h, slot - 8, h);
      });
      break;
    }
    case "swatch": {
      ctx.fillStyle = body.color;
      ctx.fillRect(28, top, width - 56, bottom - top - 50);
      ctx.font = "32px sans-serif";
      ctx.fillStyle = "#1f2328";
      ctx.fillText(body.caption, 28, bottom - 40);
      break;
    }
  }
}

export function drawButtonFace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  label: string,
  hovered: boolean,
) {
  ctx.fillStyle = hovered ? "#0550ae" : "#0969da";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(height * 0.5)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, height / 2);
}

/** Text form of a panel body, reported by the host probe. */
export function describeBody(body: HostPanelBody): string {
  switch (body.kind) {
    case "value":
      return `${body.label}=${body.value}`;
    case "bars":
      return `${body.label}=[${body.values.join(",")}]`;
    case "swatch":
      return `${body.color}:${body.caption}`;
  }
}
