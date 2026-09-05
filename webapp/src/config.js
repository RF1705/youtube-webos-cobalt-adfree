const CONFIG_KEY = 'ytaf-configuration-cobalt-adfree-v2';
const defaultConfig = {
  enableAdBlock: true,
  startupPage: 'home',
  enableSponsoredQrCodeBlock: true,
  enableSponsorBlock: true,
  enableSponsorBlockSponsor: true,
  enableSponsorBlockIntro: true,
  enableSponsorBlockOutro: true,
  enableSponsorBlockInteraction: true,
  enableSponsorBlockSelfPromo: true,
  enableSponsorBlockMusicOfftopic: true,
  enableSponsorBlockPreview: false,
  enableSponsorBlockFiller: false,
  enableSponsorBlockHook: false,
  enableAutoLogin: true,
  enableReturnYouTubeDislike: true,
  enableShorts: true
};

let localConfig = window.__ytafConfigState;

if (!localConfig || typeof localConfig !== 'object') {
  try {
    localConfig = JSON.parse(
      window.localStorage[CONFIG_KEY] || JSON.stringify(defaultConfig)
    );
  } catch (err) {
    console.warn('Config read failed:', err);
    localConfig = { ...defaultConfig };
  }

  window.__ytafConfigState = localConfig;
}

export function configRead(key) {
  if (localConfig[key] === undefined) {
    console.warn(
      'Populating key',
      key,
      'with default value',
      defaultConfig[key]
    );
    localConfig[key] = defaultConfig[key];
  }

  return localConfig[key];
}

function dispatchConfigChanged(target, key, value) {
  try {
    target.dispatchEvent(
      new CustomEvent('ytaf-config-changed', {
        detail: { key, value }
      })
    );
  } catch (err) {
    const event = document.createEvent('Event');
    event.initEvent('ytaf-config-changed', true, true);
    event.detail = { key, value };
    target.dispatchEvent(event);
  }
}

export function configWrite(key, value) {
  console.info('Setting key', key, 'to', value);
  localConfig[key] = value;
  window.__ytafConfigState = localConfig;
  window.localStorage[CONFIG_KEY] = JSON.stringify(localConfig);

  if (
    key === 'enableShorts' &&
    typeof window.__ytafApplyShortsState === 'function'
  ) {
    try {
      window.__ytafApplyShortsState();
    } catch (err) {
      console.warn('Failed to apply Shorts state:', err);
    }
  }

  dispatchConfigChanged(document, key, value);
  dispatchConfigChanged(window, key, value);
}
