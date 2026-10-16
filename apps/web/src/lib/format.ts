/**
 * Formatting helpers shared across pages (Vietnamese-facing strings).
 */

/** Human-readable uptime: "2 giờ 5 phút", "43 phút 10 giây", or "12 giây". */
export function formatUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours} giờ ${minutes} phút`;
  }
  if (minutes > 0) {
    return `${minutes} phút ${rest} giây`;
  }
  return `${rest} giây`;
}
