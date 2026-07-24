import { configRead } from './config.js';
import './auto-login.css';

const RECURRING_ACTIONS_KEY = 'yt.leanback.default::recurring_actions';
const LAST_IDENTITY_KEY = 'yt.leanback.default::last-identity-used';
const AUTONAV_KEY = 'yt.leanback.default::AUTONAV_FOR_LIVING_ROOM';
const ACCOUNT_SELECTOR_CLASS = 'WEB_PAGE_TYPE_ACCOUNT_SELECTOR';
const BYPASS_BODY_CLASS = 'ytaf-bypassing-login';
const TARGET_ACTIONS = [
  'startup-screen-account-selector-with-guest',
  'whos_watching_fullscreen_zero_accounts',
  'startup-screen-signed-out-welcome-back'
];
const REMOTE_KEYS = {
  ENTER: { code: 13, key: 'Enter' },
  DOWN: { code: 40, key: 'ArrowDown' }
};

let hasBypassed = false;
let observer = null;
let startupTimer = null;
let cleanupTimer = null;

function updateRecurringActions(disable) {
  try {
    const storedData = window.localStorage.getItem(RECURRING_ACTIONS_KEY);
    if (!storedData) {
      console.info('[Auto Login] No recurring actions found yet');
      return;
    }

    const json = JSON.parse(storedData);
    const actions = json && json.data && json.data.data;
    if (!actions) return;

    const targetDate = disable
      ? Date.now() + 7 * 24 * 60 * 60 * 1000
      : Date.now();
    let modified = false;

    TARGET_ACTIONS.forEach((key) => {
      if (!actions[key]) return;
      actions[key].lastFired = targetDate;
      modified = true;
    });

    if (modified) {
      window.localStorage.setItem(RECURRING_ACTIONS_KEY, JSON.stringify(json));
      console.info(
        `[Auto Login] "Who's watching" screens ${
          disable ? 'disabled' : 'enabled'
        }`
      );
    }
  } catch (err) {
    console.warn('[Auto Login] Failed to update recurring actions:', err);
  }
}

function readStorageData(key) {
  const storedValue = window.localStorage.getItem(key);
  if (!storedValue) return null;

  const parsed = JSON.parse(storedValue);
  return parsed && parsed.data;
}

function isGuestMode() {
  try {
    const lastIdentity = readStorageData(LAST_IDENTITY_KEY);
    if (lastIdentity) {
      return (
        lastIdentity.identityType ===
        'UNAUTHENTICATED_IDENTITY_TYPE_GUEST'
      );
    }

    const autoNav = readStorageData(AUTONAV_KEY);
    return Boolean(autoNav && autoNav.guest === true);
  } catch (err) {
    console.warn('[Auto Login] Failed to read the last identity:', err);
    return false;
  }
}

function createKeyboardEvent(type, keyDefinition) {
  let event;

  try {
    event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key: keyDefinition.key,
      code: keyDefinition.key,
      keyCode: keyDefinition.code,
      which: keyDefinition.code
    });
  } catch (err) {
    event = document.createEvent('Event');
    event.initEvent(type, true, true);
  }

  ['keyCode', 'which'].forEach((property) => {
    try {
      Object.defineProperty(event, property, {
        configurable: true,
        get: () => keyDefinition.code
      });
    } catch (err) {
      try {
        event[property] = keyDefinition.code;
      } catch (assignmentError) {
        console.warn(
          `[Auto Login] Could not set keyboard event property ${property}:`,
          assignmentError
        );
      }
    }
  });

  return event;
}

function sendKey(keyDefinition) {
  const target = document.body;
  if (!target) return;

  target.dispatchEvent(createKeyboardEvent('keydown', keyDefinition));
  target.dispatchEvent(createKeyboardEvent('keyup', keyDefinition));
}

function finishBypass() {
  window.clearTimeout(cleanupTimer);
  cleanupTimer = window.setTimeout(() => {
    if (document.body) {
      document.body.classList.remove(BYPASS_BODY_CLASS);
    }
  }, 2000);
}

export function attemptAutoLogin(force = false) {
  if (!document.body) return;

  const isAccountSelector =
    document.body.classList.contains(ACCOUNT_SELECTOR_CLASS);

  if ((!isAccountSelector && !force) || (hasBypassed && !force)) return;

  hasBypassed = true;
  document.body.classList.add(BYPASS_BODY_CLASS);
  console.info('[Auto Login] Account selector detected, bypassing it');

  window.setTimeout(() => {
    if (!configRead('enableAutoLogin')) {
      finishBypass();
      return;
    }

    if (isGuestMode()) {
      sendKey(REMOTE_KEYS.DOWN);
      window.setTimeout(() => {
        if (!configRead('enableAutoLogin')) {
          finishBypass();
          return;
        }
        sendKey(REMOTE_KEYS.ENTER);
        finishBypass();
      }, 200);
      return;
    }

    sendKey(REMOTE_KEYS.ENTER);
    finishBypass();
  }, 500);
}

function attachObserver() {
  if (observer || !document.body) return;

  observer = new MutationObserver(() => {
    attemptAutoLogin();
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });
}

function stopAutoLogin() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  window.clearTimeout(startupTimer);
  window.clearTimeout(cleanupTimer);
  startupTimer = null;
  cleanupTimer = null;
  hasBypassed = false;

  if (document.body) {
    document.body.classList.remove(BYPASS_BODY_CLASS);
  }
}

export function resetAutoLogin() {
  hasBypassed = false;
  window.clearTimeout(startupTimer);

  if (configRead('enableAutoLogin')) {
    startupTimer = window.setTimeout(() => {
      hasBypassed = true;
    }, 15000);
  }
}

export function initAutoLogin() {
  if (!configRead('enableAutoLogin')) return;

  console.info('[Auto Login] Initializing');
  resetAutoLogin();
  updateRecurringActions(true);
  attachObserver();
  attemptAutoLogin();
}

function startWhenReady() {
  if (document.body) {
    initAutoLogin();
  } else {
    document.addEventListener('DOMContentLoaded', initAutoLogin, {
      once: true
    });
  }
}

document.addEventListener(
  'ytaf-config-changed',
  (event) => {
    if (!event.detail || event.detail.key !== 'enableAutoLogin') return;

    if (event.detail.value) {
      stopAutoLogin();
      initAutoLogin();
    } else {
      stopAutoLogin();
      updateRecurringActions(false);
    }
  },
  true
);

startWhenReady();
