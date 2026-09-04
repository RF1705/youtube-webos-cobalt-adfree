// const YT_BASE_URL = new URL('https://www.youtube.com/tv#/');
import { configRead } from './config.js';

const YT_BASE_URL = new URL('https://www.youtube.com/tv#/');
const CONTENT_INTENT_REGEX = /^.+(?=Content)/g;
const STARTUP_PAGE_ENDPOINTS = {
  subscriptions: { browseId: 'FEsubscriptions' },
  shorts: {
    url: '/youtubei/v1/reel/reel_item_watch',
    iconType: 'YOUTUBE_SHORTS_FILL_24',
    title: 'Shorts'
  },
  library: { browseId: 'FElibrary' }
};
const STARTUP_PAGE_RETRY_INTERVAL_MS = 250;
const STARTUP_PAGE_MAX_ATTEMPTS = 80;
let startupPageApplied = false;

export function getStartupPageUrl(page = configRead('startupPage')) {
  const browseId = STARTUP_PAGE_ENDPOINTS[page] &&
    STARTUP_PAGE_ENDPOINTS[page].browseId;
  return browseId
    ? `${YT_BASE_URL.origin}/tv#/browse/${browseId}`
    : YT_BASE_URL.toString();
}

export function extractLaunchParams() {
  if (window.launchParams) {
    return JSON.parse(window.launchParams);
  } else {
    return {};
  }
}

export function handleLaunch(params) {
  console.info('handleLaunch', params);

  // We use our custom "target" param, since launches with "contentTarget"
  // parameter do not respect "handlesRelaunch" appinfo option. We still
  // fallback to "contentTarget" if our custom param is not specified.
  //
  let { target, contentTarget = target } = params;
  let href;

  switch (typeof contentTarget) {
    case 'string': {
      if (contentTarget.indexOf(YT_BASE_URL.origin) === 0) {
        console.info('Launching from direct contentTarget');
        href = contentTarget;
      } else {
        // Out of app dial launch with second screen on home: { contentTarget: 'pairingCode=<UUID>&theme=cl&dialLaunch=watch' }
        console.info('Launching from partial contentTarget');
        if (contentTarget.indexOf('v=v=') === 0)
          contentTarget = contentTarget.substring(2);

        href = YT_BASE_URL.toString() + '?' + contentTarget;
      }
      break;
    }
    case 'object': {
      console.info('Voice launch');

      const { intent, intentParam } = contentTarget;
      // Ctrl+F tvhtml5LaunchUrlComponentChanged & REQUEST_ORIGIN_GOOGLE_ASSISTANT in base.js for info
      // TODO: implement google assistant
      const search = new URLSearchParams();
      // contentTarget.intent's seen so far: PlayContent, SearchContent
      const voiceContentIntent = intent
        .match(CONTENT_INTENT_REGEX)?.[0]
        ?.toLowerCase();

      search.set('inApp', true);
      search.set('vs', 9); // Voice System is VOICE_SYSTEM_LG_THINKQ
      voiceContentIntent && search.set('va', voiceContentIntent);

      // order is important
      search.append('launch', 'voice');
      voiceContentIntent === 'search' && search.append('launch', 'search');

      search.set('vq', intentParam);

      href = YT_BASE_URL + '?' + search.toString();
      break;
    }
    default: {
      console.info('Default launch');
      href = YT_BASE_URL.toString();
    }
  }

  window.location.href = href;
}

export function handleInitialLaunch() {
  const params = extractLaunchParams();
  if (params.target !== undefined || params.contentTarget !== undefined) {
    return;
  }

  const page = configRead('startupPage');
  const startupEndpoint = STARTUP_PAGE_ENDPOINTS[page];
  if (!startupEndpoint || startupPageApplied) return;

  let attempts = 0;
  const applyStartupPage = () => {
    attempts += 1;

    const renderers = document.querySelectorAll('ytlr-guide-entry-renderer');
    for (let index = 0; index < renderers.length; index += 1) {
      const renderer = renderers[index];
      const instance = renderer.__instance;
      const props = instance && instance.props;
      const endpoint = props && props.data && props.data.navigationEndpoint;
      const rendererBrowseId = endpoint && endpoint.browseEndpoint
        && endpoint.browseEndpoint.browseId;
      const rendererUrl = endpoint && endpoint.commandMetadata
        && endpoint.commandMetadata.webCommandMetadata
        && endpoint.commandMetadata.webCommandMetadata.url;
      const rendererIconType = props && props.data && props.data.icon
        && props.data.icon.iconType;
      const rendererTitle = props && props.data && props.data.formattedTitle
        && props.data.formattedTitle.simpleText;
      const endpointMatches = startupEndpoint.browseId
        ? rendererBrowseId === startupEndpoint.browseId
        : rendererUrl === startupEndpoint.url
          || rendererIconType === startupEndpoint.iconType
          || rendererTitle === startupEndpoint.title;

      if (!endpointMatches || typeof props.onSelect !== 'function') {
        continue;
      }

      startupPageApplied = true;
      console.info(`Applying configured startup page: ${page}`);
      props.onSelect();
      return;
    }

    if (attempts < STARTUP_PAGE_MAX_ATTEMPTS) {
      window.setTimeout(applyStartupPage, STARTUP_PAGE_RETRY_INTERVAL_MS);
    } else {
      console.warn(`Configured startup page was not found: ${page}`);
    }
  };

  applyStartupPage();
}

/**
 * Wait for a child element to be added that holds true for a predicate
 * @template T
 * @param {Element} parent
 * @param {(node: Node) => node is T} predicate
 * @param {AbortSignal=} abortSignal
 * @return {Promise<T>}
 */
export async function waitForChildAdd(parent, predicate, abortSignal) {
  return new Promise((resolve, reject) => {
    const obs = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        switch (mut.type) {
          case 'attributes': {
            if (predicate(mut.target)) {
              obs.disconnect();
              resolve(mut.target);
              return;
            }
            break;
          }
          case 'childList': {
            for (const node of mut.addedNodes) {
              if (predicate(node)) {
                obs.disconnect();
                resolve(node);
                return;
              }
            }
            break;
          }
        }
      }
    });

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        obs.disconnect();
        reject(new Error('aborted'));
      });
    }

    obs.observe(parent, { subtree: true, attributes: true, childList: true });
  });
}
