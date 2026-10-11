import Image from "next/image";

/** The RUTF-DTAP emblem (people, leaf and circle) from the official logo (DECISIONS R166). Decorative
 *  wherever the name is also written next to it; pass a label where it stands alone. */
export function RutfMark({ size = 44, label }: { size?: number; label?: string }) {
  return (
    <Image src="/brand/rutf-dtap-mark.png" width={size} height={size} alt={label ?? ""} aria-hidden={label ? undefined : true}
      style={{ display: "block", width: size, height: size }} priority />
  );
}

/** The full RUTF-DTAP logo — emblem, wordmark and "Traceability · Accountability · Better Nutrition".
 *  Its blue and green lettering needs a light background. */
export function RutfLogo({ height = 48, maxWidth }: { height?: number; maxWidth?: number }) {
  // The source lockup is 1400 × 356 px.
  const width = Math.round((height * 1400) / 356);
  return (
    <Image src="/brand/rutf-dtap-logo.png" width={width} height={height}
      alt="RUTF-DTAP: Traceability, Accountability, Better Nutrition"
      style={{ display: "block", height: "auto", width: "100%", maxWidth: maxWidth ?? width }} priority />
  );
}
