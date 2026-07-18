const originalStringify = JSON.stringify;

function isPrimitive(value) {
  return Object(value) !== value;
}

function stringify(value, replacer, space) {
  if (!isPrimitive(value)) {
    const ctx = value?.playbackContext?.contentPlaybackContext;

    if (!isPrimitive(ctx)) {
      ctx.isInlinePlaybackNoAd = true;
      console.info('[ytaf] Set playbackContext.contentPlaybackContext.isInlinePlaybackNoAd');
    }
  }

  return originalStringify(value, replacer, space);
}

JSON.stringify = stringify;
