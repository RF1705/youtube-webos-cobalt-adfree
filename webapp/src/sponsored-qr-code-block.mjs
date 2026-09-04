const SHOPPING_ACTION_TYPE = 'TIMELY_ACTION_TYPE_SHOPPING';

// YouTube TV exposes sponsored shopping QR popups at this player response
// path. Preserve every other timed action in the same generic container.
export function stripSponsoredQrCodePopups(value) {
  const timelyActions =
    value?.playerOverlays?.playerOverlayRenderer?.timelyActionRenderers;

  if (!Array.isArray(timelyActions)) return false;

  const filteredActions = timelyActions.filter(
    (entry) => entry?.timelyActionRenderer?.type !== SHOPPING_ACTION_TYPE
  );

  if (filteredActions.length === timelyActions.length) return false;

  value.playerOverlays.playerOverlayRenderer.timelyActionRenderers =
    filteredActions;
  return true;
}
