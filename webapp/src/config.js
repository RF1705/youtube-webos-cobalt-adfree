const CONFIG_KEY = 'ytaf-configuration-cobalt-adfree-v2';
const defaultConfig = {
  enableAdBlock: true,
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
  enableReturnYouTubeDislike: true
};

let localConfig;

try {
  localConfig = JSON.parse(
    window.localStorage[CONFIG_KEY] || JSON.stringify(defaultConfig)
  );
} catch (err) {
  console.warn('Config read failed:', err);
  localConfig = { ...defaultConfig };
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

export function configWrite(key, value) {
  console.info('Setting key', key, 'to', value);
  localConfig[key] = value;
  window.localStorage[CONFIG_KEY] = JSON.stringify(localConfig);

  try {
    document.dispatchEvent(
      new CustomEvent('ytaf-config-changed', {
        detail: { key, value }
      })
    );
  } catch (err) {
    const event = document.createEvent('Event');
    event.initEvent('ytaf-config-changed', true, true);
    event.detail = { key, value };
    document.dispatchEvent(event);
  }
}
