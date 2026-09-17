const TERMINAL_SEGMENT_TOLERANCE_SECONDS = 1;
const NATURAL_END_TAIL_SECONDS = 0.25;

export function getSponsorBlockSkipTarget(
  segmentEnd,
  duration,
  currentTime = 0
) {
  if (!Number.isFinite(segmentEnd)) return null;

  if (!Number.isFinite(duration) || duration <= 0) {
    return segmentEnd;
  }

  if (segmentEnd >= duration - TERMINAL_SEGMENT_TOLERANCE_SECONDS) {
    const naturalEndTarget = Math.max(0, duration - NATURAL_END_TAIL_SECONDS);
    return currentTime < naturalEndTarget ? naturalEndTarget : null;
  }

  return Math.min(segmentEnd, duration);
}
