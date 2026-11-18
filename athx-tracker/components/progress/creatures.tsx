/**
 * Bep the hippo and the gator, redrawn from the 16×16 pixels in hippo-city
 * (`game/sprites.py`). Two frames swap the feet. The bagel is the same crown
 * the game draws when `bagel` is set.
 */

/** Three times the 16×16 source, so the pixels stay whole and the face reads. */
const PIXEL = 3;
const ART = 16;
/** Two rows above the art. The bagel stroke sits on y = 0 and would be cut off without them. */
const ART_HEADROOM = 2;
export const RUNNER_SIZE = PIXEL * ART;
/** Art plus the rows above it. Feet stay on the bottom edge. */
export const RUNNER_BOX = PIXEL * (ART + ART_HEADROOM);
/** Air above the sprite, past the two-pixel bounce, so the track does not shave the crown. */
export const RUNNER_GAP = 6;

const HIPPO = "#a898a8";
const HIPPO_D = "#786880";
const HIPPO_L = "#c8b8c8";
const PINK = "#e8a0b0";
const EYE = "#f8f8f0";
const PUPIL = "#202028";
const GATOR = "#489858";
const GATOR_D = "#286838";
const GATOR_L = "#78b870";
const BELLY = "#c8d078";
const TOOTH = "#f8f8e8";

type Box = [number, number, number, number];

function rects(boxes: Box[], fill: string) {
  return boxes.map(([x, y, width, height]) => (
    <rect key={`${fill}-${x}-${y}-${width}`} x={x} y={y} width={width} height={height} fill={fill} />
  ));
}

function Bagel() {
  return (
    <g data-bagel-crown="true">
      <ellipse cx="8" cy="3" rx="6" ry="3" fill="none" stroke="#c8a060" strokeWidth="1" />
      <ellipse cx="8" cy="3" rx="5" ry="2" fill="none" stroke="#e8c88c" strokeWidth="1" />
      <ellipse cx="8" cy="3" rx="3" ry="1" fill="#a07848" />
    </g>
  );
}

function Pixel({ frame, bagel, className, children }: {
  frame: 0 | 1;
  bagel: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox={`0 ${-ART_HEADROOM} 16 ${ART + ART_HEADROOM}`}
      width={RUNNER_SIZE}
      height={RUNNER_BOX}
      aria-hidden="true"
      shapeRendering="crispEdges"
      className={className}
      data-stride={frame}
    >
      {children}
      {bagel ? <Bagel /> : null}
    </svg>
  );
}

function Hippo({ frame, bagel, className }: { frame: 0 | 1; bagel: boolean; className?: string }) {
  const feet: Box[] = frame === 0 ? [[3, 12, 3, 2], [10, 11, 3, 2]] : [[3, 11, 3, 2], [10, 12, 3, 2]];
  return (
    <Pixel frame={frame} bagel={bagel} className={className}>
      <ellipse cx="8" cy="14.5" rx="6" ry="1.5" fill="rgba(0,0,0,0.35)" />
      {rects([[3, 7, 10, 6]], HIPPO_D)}
      {rects([[4, 7, 8, 5]], HIPPO)}
      {rects([[5, 9, 6, 3]], HIPPO_L)}
      {rects([[3, 3, 10, 6]], HIPPO)}
      {rects([[4, 5, 8, 3]], HIPPO_L)}
      {rects([[9, 5, 6, 4]], HIPPO)}
      {rects([[10, 7, 4, 1]], PINK)}
      {rects([[10, 5, 1, 1], [12, 5, 1, 1], [3, 2, 2, 2], [11, 2, 2, 2]], HIPPO_D)}
      {rects([[3, 3, 1, 1], [12, 3, 1, 1]], PINK)}
      {rects([[5, 4, 2, 2], [9, 4, 2, 2]], EYE)}
      {rects([[6, 4, 1, 2], [10, 4, 1, 2]], PUPIL)}
      {rects(feet, HIPPO_D)}
    </Pixel>
  );
}

function Gator({ frame, bagel, className }: { frame: 0 | 1; bagel: boolean; className?: string }) {
  const feet: Box[] = frame === 0 ? [[3, 12, 2, 2], [10, 11, 2, 2]] : [[3, 11, 2, 2], [10, 12, 2, 2]];
  return (
    <Pixel frame={frame} bagel={bagel} className={className}>
      <ellipse cx="8" cy="14.5" rx="7" ry="1.5" fill="rgba(0,0,0,0.35)" />
      {rects([[3, 7, 9, 5]], GATOR_D)}
      {rects([[4, 7, 7, 4]], GATOR)}
      {rects([[5, 9, 5, 2]], BELLY)}
      {rects([[1, 8, 3, 3]], GATOR_D)}
      {rects([[0, 9, 2, 2], [9, 4, 6, 5]], GATOR)}
      {rects([[10, 5, 4, 2]], GATOR_L)}
      {rects([[11, 8, 1, 1], [13, 8, 1, 1]], TOOTH)}
      {rects([[10, 4, 2, 2]], EYE)}
      {rects([[11, 4, 1, 2]], PUPIL)}
      {rects([[5, 5, 1, 2], [7, 5, 1, 2], [9, 5, 1, 2]], GATOR_D)}
      {rects(feet, GATOR_D)}
    </Pixel>
  );
}

/** Faces right, runs to the end of the bar, and comes back. CSS does the running. */
export function Creature({ kind, bagel }: { kind: "hippos" | "gators"; bagel: boolean }) {
  const Art = kind === "hippos" ? Hippo : Gator;
  return (
    <div
      className="athx-runner"
      style={
        {
          "--runner-size": `${RUNNER_SIZE}px`,
          "--runner-box": `${RUNNER_BOX}px`,
        } as React.CSSProperties
      }
    >
      <div className="athx-runner-bob">
        <div className="athx-runner-face">
          <Art frame={0} bagel={bagel} />
          <Art frame={1} bagel={bagel} className="athx-runner-stride" />
        </div>
      </div>
    </div>
  );
}
