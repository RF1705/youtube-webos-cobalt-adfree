/*global navigate*/

// import './spatial-navigation-polyfill.js';
import './navigation-checkbox.js';

import './ui.css';

import { configRead, configWrite } from './config.js';
import { checkboxTools } from './checkboxTools.js';
import { choiceTools } from './choiceTools.js';
import { text as languageText } from './languages/index.js';
import { sponsorBlockCategoryColors } from './sponsorblock-categories.js';
import {
  isSubtitleShortcut,
  toggleSubtitles
} from './subtitle-shortcut.js';

let lastTabIndex = 0;

function text(key) {
  return languageText('ui', key);
}

export function userScriptStartUI() {
  if (window.__ytafUiInitialized && document.querySelector('.ytaf-ui-container')) {
    return;
  }
  window.__ytafUiInitialized = true;
  console.info('[ytaf] userScriptStartUI() called');

  const ARROW_KEY_CODE = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  let lastGreenKeyAt = 0;
  let currentFocusIndex = -1;
  let menuScrollFrame = null;
  let menuOffset = 0;
  let menuContent = null;
  let menuViewport = null;
  let heldDirection = null;
  let heldDirectionAt = 0;
  let directionMoveFrame = null;

  function getDirectionFromEvent(evt) {
    const key = (evt.key || '').toLowerCase();
    const code = (evt.code || '').toLowerCase();
    const keyCode = evt.keyCode ?? evt.which ?? evt.charCode;

    if (code === 'arrowup' || key === 'arrowup' || key === 'up' || keyCode === 38) {
      return 'up';
    }
    if (code === 'arrowdown' || key === 'arrowdown' || key === 'down' || keyCode === 40) {
      return 'down';
    }
    if (code === 'arrowleft' || key === 'arrowleft' || key === 'left' || keyCode === 37) {
      return 'left';
    }
    if (code === 'arrowright' || key === 'arrowright' || key === 'right' || keyCode === 39) {
      return 'right';
    }

    return null;
  }

  function getRemoteKeyCode(evt) {
    return evt.keyCode || evt.which || evt.charCode || 0;
  }

  function isGreenKey(evt) {
    const keyCode = getRemoteKeyCode(evt);
    return keyCode === 404 || keyCode === 172;
  }

  function getPlaybackRateShortcut(evt) {
    const keyCode = getRemoteKeyCode(evt);
    const key = evt.key || '';

    if (key === '1' || evt.code === 'Digit1' || keyCode === 49) return -1;
    if (key === '3' || evt.code === 'Digit3' || keyCode === 51) return 1;
    return 0;
  }

  function adjustPlaybackRate(direction) {
    const video = document.querySelector('video');
    if (!video) return false;

    const currentRate = Number(video.playbackRate) || 1;
    const currentIndex = PLAYBACK_RATES.findIndex(
      (rate) => Math.abs(rate - currentRate) < 0.01
    );
    const nearestIndex = PLAYBACK_RATES.reduce(
      (nearest, rate, index) =>
        Math.abs(rate - currentRate) < Math.abs(PLAYBACK_RATES[nearest] - currentRate)
          ? index
          : nearest,
      0
    );
    const nextIndex = Math.max(
      0,
      Math.min(
        PLAYBACK_RATES.length - 1,
        (currentIndex === -1 ? nearestIndex : currentIndex) + direction
      )
    );
    const nextRate = PLAYBACK_RATES[nextIndex];

    if (nextRate === currentRate) return true;

    video.playbackRate = nextRate;
    showNotification(`Playback speed: ${nextRate}x`, 1800, 'green');
    return true;
  }

  function scrollMenuItemIntoView(item) {
    if (!item || !menuContent || !menuViewport || !uiContainer.contains(item)) return;

    // Cobalt resets an overflow container's scrollTop after programmatic focus.
    // Keep the viewport fixed and move its inner panel instead.
    uiContainer.scrollTop = 0;

    const visibleMargin = 8;
    const row = item.parentElement && uiContainer.contains(item.parentElement)
      ? item.parentElement
      : item;
    const viewportRect = menuViewport.getBoundingClientRect();
    const itemRect = row.getBoundingClientRect();
    const visibleTop = viewportRect.top + visibleMargin;
    const visibleBottom = viewportRect.bottom - visibleMargin;

    if (itemRect.top < visibleTop) {
      menuOffset += itemRect.top - visibleTop;
    } else if (itemRect.bottom > visibleBottom) {
      menuOffset += itemRect.bottom - visibleBottom;
    }

    const viewportHeight = Math.max(0, visibleBottom - visibleTop);
    const maximumOffset = Math.max(0, menuContent.scrollHeight - viewportHeight);
    menuOffset = Math.max(0, Math.min(maximumOffset, menuOffset));
    menuContent.style.top = `${-menuOffset}px`;
  }

  function queueMenuItemScroll(item) {
    if (menuScrollFrame !== null) {
      window.cancelAnimationFrame(menuScrollFrame);
    }
    menuScrollFrame = window.requestAnimationFrame(() => {
      menuScrollFrame = null;
      scrollMenuItemIntoView(item);
    });
  }

  function moveFocus(dir) {
    const focusableItems = Array.from(
      uiContainer.querySelectorAll('[tabindex]')
    ).filter((item) => item.tabIndex > 0);

    if (focusableItems.length === 0) {
      return;
    }

    if (currentFocusIndex < 0 || currentFocusIndex >= focusableItems.length) {
      const activeIndex = focusableItems.findIndex(
        (item) => item === document.activeElement
      );
      currentFocusIndex = activeIndex === -1 ? 0 : activeIndex;
    }

    if (dir === 'down' || dir === 'right') {
      currentFocusIndex = (currentFocusIndex + 1) % focusableItems.length;
    } else if (dir === 'up' || dir === 'left') {
      currentFocusIndex =
        (currentFocusIndex - 1 + focusableItems.length) % focusableItems.length;
    }

    const nextItem = focusableItems[currentFocusIndex];
    if (nextItem) {
      nextItem.focus();
      queueMenuItemScroll(nextItem);
      lastTabIndex = nextItem.tabIndex;
    }
  }

  function queueDirectionMove(direction) {
    if (directionMoveFrame !== null) return;

    const focusBeforeEvent = document.activeElement;
    directionMoveFrame = window.requestAnimationFrame(() => {
      directionMoveFrame = null;
      const focusAfterEvent = document.activeElement;

      // Some Cobalt versions perform native spatial navigation before the
      // cancelled key event settles. Accept that move instead of adding one.
      if (
        focusAfterEvent &&
        focusAfterEvent !== focusBeforeEvent &&
        uiContainer.contains(focusAfterEvent) &&
        focusAfterEvent.tabIndex > 0
      ) {
        const focusableItems = Array.from(
          uiContainer.querySelectorAll('[tabindex]')
        ).filter((item) => item.tabIndex > 0);
        currentFocusIndex = focusableItems.indexOf(focusAfterEvent);
        lastTabIndex = focusAfterEvent.tabIndex;
        queueMenuItemScroll(focusAfterEvent);
        return;
      }

      moveFocus(direction);
    });
  }

  const uiContainer = document.createElement('div');
  uiContainer.classList.add('ytaf-ui-container');
  uiContainer.style.display = 'none';
  uiContainer.style.visibility = 'hidden';
  uiContainer.setAttribute('tabindex', 0);
  uiContainer.addEventListener(
    'focus',
    (event) => {
      console.info('uiContainer focused!');
      const focusedElement = event.target;
      if (
        focusedElement &&
        focusedElement !== uiContainer &&
        focusedElement.tabIndex !== null &&
        focusedElement.tabIndex > 0
      ) {
        lastTabIndex = focusedElement.tabIndex;
        queueMenuItemScroll(focusedElement);
      }
    },
    true
  );
  uiContainer.addEventListener(
    'blur',
    () => console.info('uiContainer blured!'),
    true
  );

  // Key handling is done globally in the document handler to ensure a single
  // interception point and avoid duplicate handling across capture/bubble phases.

  const callbackConfig = (configName) => {
    return (newState) => {
      configWrite(configName, newState);
    };
  };

  const divTitle = document.createElement('div');
  divTitle.classList.add('center');
  const title = document.createElement('h1');
  title.textContent = text('title');
  divTitle.appendChild(title);
  uiContainer.appendChild(divTitle);

  uiContainer.appendChild(
    checkboxTools.add(
      '__adblock',
      text('adblock'),
      configRead('enableAdBlock'),
      callbackConfig('enableAdBlock')
    )
  );
  uiContainer.appendChild(
    choiceTools.add(
      '__startup_page',
      text('startupPage'),
      configRead('startupPage'),
      [
        { value: 'home', label: text('startupPageHome') },
        { value: 'subscriptions', label: text('startupPageSubscriptions') },
        { value: 'shorts', label: text('startupPageShorts') },
        { value: 'library', label: text('startupPageLibrary') }
      ],
      callbackConfig('startupPage')
    )
  );
  uiContainer.appendChild(
    checkboxTools.add(
      '__auto_login',
      text('autoLogin'),
      configRead('enableAutoLogin'),
      callbackConfig('enableAutoLogin')
    )
  );
  uiContainer.appendChild(
    checkboxTools.add(
      '__return_youtube_dislike',
      text('ryd'),
      configRead('enableReturnYouTubeDislike'),
      callbackConfig('enableReturnYouTubeDislike')
    )
  );
  uiContainer.appendChild(
    checkboxTools.add(
      '__shorts',
      text('shorts'),
      configRead('enableShorts'),
      callbackConfig('enableShorts')
    )
  );
  uiContainer.appendChild(
    checkboxTools.add(
      '__sponsorblock',
      text('sponsorblock'),
      configRead('enableSponsorBlock'),
      callbackConfig('enableSponsorBlock')
    )
  );

  const sponsorBlock = document.createElement('div');
  sponsorBlock.classList.add('blockquote');
  sponsorBlock.appendChild(
    checkboxTools.add(
      '__sponsorblock_sponsor',
      text('sponsor'),
      configRead('enableSponsorBlockSponsor'),
      callbackConfig('enableSponsorBlockSponsor'),
      { color: sponsorBlockCategoryColors.sponsor }
    )
  );
  sponsorBlock.appendChild(
    checkboxTools.add(
      '__sponsorblock_intro',
      text('intro'),
      configRead('enableSponsorBlockIntro'),
      callbackConfig('enableSponsorBlockIntro'),
      { color: sponsorBlockCategoryColors.intro }
    )
  );
  sponsorBlock.appendChild(
    checkboxTools.add(
      '__sponsorblock_outro',
      text('outro'),
      configRead('enableSponsorBlockOutro'),
      callbackConfig('enableSponsorBlockOutro'),
      { color: sponsorBlockCategoryColors.outro }
    )
  );
  sponsorBlock.appendChild(
    checkboxTools.add(
      '__sponsorblock_interaction',
      text('interaction'),
      configRead('enableSponsorBlockInteraction'),
      callbackConfig('enableSponsorBlockInteraction'),
      { color: sponsorBlockCategoryColors.interaction }
    )
  );
  sponsorBlock.appendChild(
    checkboxTools.add(
      '__sponsorblock_selfpromo',
      text('selfpromo'),
      configRead('enableSponsorBlockSelfPromo'),
      callbackConfig('enableSponsorBlockSelfPromo'),
      { color: sponsorBlockCategoryColors.selfpromo }
    )
  );
  sponsorBlock.appendChild(
    checkboxTools.add(
      '__sponsorblock_music_offtopic',
      text('musicOfftopic'),
      configRead('enableSponsorBlockMusicOfftopic'),
      callbackConfig('enableSponsorBlockMusicOfftopic'),
      { color: sponsorBlockCategoryColors.music_offtopic }
    )
  );
  sponsorBlock.appendChild(
    checkboxTools.add(
      '__sponsorblock_preview',
      text('preview'),
      configRead('enableSponsorBlockPreview'),
      callbackConfig('enableSponsorBlockPreview'),
      { color: sponsorBlockCategoryColors.preview }
    )
  );
  sponsorBlock.appendChild(
    checkboxTools.add(
      '__sponsorblock_filler',
      text('filler'),
      configRead('enableSponsorBlockFiller'),
      callbackConfig('enableSponsorBlockFiller'),
      { color: sponsorBlockCategoryColors.filler }
    )
  );
  sponsorBlock.appendChild(
    checkboxTools.add(
      '__sponsorblock_hook',
      text('hook'),
      configRead('enableSponsorBlockHook'),
      callbackConfig('enableSponsorBlockHook'),
      { color: sponsorBlockCategoryColors.hook }
    )
  );
  uiContainer.appendChild(sponsorBlock);

  menuContent = document.createElement('div');
  menuContent.classList.add('ytaf-ui-content');
  menuContent.style.position = 'relative';
  menuContent.style.top = '0';
  while (uiContainer.children.length > 1) {
    menuContent.appendChild(uiContainer.children[1]);
  }
  menuViewport = document.createElement('div');
  menuViewport.classList.add('ytaf-ui-viewport');
  menuViewport.style.position = 'relative';
  menuViewport.style.overflow = 'hidden';
  menuViewport.style.boxSizing = 'border-box';
  menuViewport.style.paddingLeft = '4px';
  menuViewport.style.paddingRight = '4px';
  menuViewport.appendChild(menuContent);
  uiContainer.appendChild(menuViewport);

  (document.body || document.documentElement).appendChild(uiContainer);

  let latestFocus = null;
  let focusGuardFrame = null;
  let spatialNavigationState = null;

  function suspendSpatialNavigation() {
    const spatialNavigation =
      window.__spatialNavigation__ || (window.__spatialNavigation__ = {});
    spatialNavigationState = {
      target: spatialNavigation,
      hadKeyMode: Object.prototype.hasOwnProperty.call(spatialNavigation, 'keyMode'),
      keyMode: spatialNavigation.keyMode
    };
    spatialNavigation.keyMode = 'NONE';
  }

  function restoreSpatialNavigation() {
    if (!spatialNavigationState) return;

    const { target, hadKeyMode, keyMode } = spatialNavigationState;
    if (hadKeyMode) {
      target.keyMode = keyMode;
    } else {
      delete target.keyMode;
    }
    spatialNavigationState = null;
  }

  function isContainerOpen() {
    return uiContainer.style.display !== 'none' && uiContainer.style.visibility !== 'hidden';
  }

  function applyVisibleContainerStyles() {
    Object.assign(uiContainer.style, {
      position: 'fixed',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      left: '64px',
      top: '64px',
      right: 'auto',
      bottom: 'auto',
      width: '720px',
      maxWidth: '80vw',
      height: '80vh',
      maxHeight: '80vh',
      boxSizing: 'border-box',
      overflow: 'hidden',
      zIndex: '2147483647',
      pointerEvents: 'auto',
      background: '#05080c',
      color: '#ffffff',
      border: '6px solid #37ff77',
      borderRadius: '12px',
      padding: '24px',
      fontSize: '22px',
      lineHeight: '1.25',
      transform: 'none',
      animation: 'none',
      boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)'
    });

    const viewportHeight = Math.max(
      0,
      uiContainer.clientHeight - 48 - divTitle.offsetHeight - 12
    );
    menuViewport.style.height = `${viewportHeight}px`;
  }

  function focusMenuItem(preferredTabIndex = lastTabIndex) {
    const focusableItems = Array.from(
      uiContainer.querySelectorAll('[tabindex]')
    ).filter((item) => item.tabIndex > 0);

    let target = null;
    if (preferredTabIndex > 0) {
      target =
        focusableItems.find((item) => item.tabIndex === preferredTabIndex) ||
        focusableItems[0];
    } else {
      target = focusableItems[0];
    }

    if (target) {
      target.focus();
      queueMenuItemScroll(target);
      currentFocusIndex = focusableItems.indexOf(target);
      if (target.tabIndex !== null && target.tabIndex > 0) {
        lastTabIndex = target.tabIndex;
      }
      return true;
    }

    uiContainer.focus();
    return false;
  }

  function openContainer() {
    console.info('Container: Showing & Focusing!');
    latestFocus =
      document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    suspendSpatialNavigation();
    applyVisibleContainerStyles();
    menuOffset = 0;
    menuContent.style.top = '0';
    uiContainer.scrollTop = 0;

    setTimeout(() => {
      focusMenuItem(1);
    }, 0);
  }

  function menuHasFocus() {
    return Boolean(
      document.activeElement &&
      (document.activeElement === uiContainer || uiContainer.contains(document.activeElement))
    );
  }

  function captureMenuFocus() {
    if (!isContainerOpen() || menuHasFocus()) {
      return;
    }
    focusMenuItem();
  }

  function queueMenuFocusGuard() {
    if (!isContainerOpen() || focusGuardFrame !== null) return;

    focusGuardFrame = window.requestAnimationFrame(() => {
      focusGuardFrame = null;
      captureMenuFocus();
    });
  }

  function guardMenuFocus(evt) {
    if (
      isContainerOpen() &&
      evt.target &&
      evt.target !== uiContainer &&
      !uiContainer.contains(evt.target)
    ) {
      queueMenuFocusGuard();
    }
  }

  function closeContainer() {
    console.info('Container: Hiding!');
    if (menuScrollFrame !== null) {
      window.cancelAnimationFrame(menuScrollFrame);
      menuScrollFrame = null;
    }
    if (focusGuardFrame !== null) {
      window.cancelAnimationFrame(focusGuardFrame);
      focusGuardFrame = null;
    }
    if (directionMoveFrame !== null) {
      window.cancelAnimationFrame(directionMoveFrame);
      directionMoveFrame = null;
    }
    uiContainer.style.display = 'none';
    uiContainer.style.visibility = 'hidden';
    uiContainer.style.pointerEvents = 'none';
    heldDirection = null;
    const menuFocus = document.activeElement;
    if (menuFocus && uiContainer.contains(menuFocus) && typeof menuFocus.blur === 'function') {
      menuFocus.blur();
    }
    restoreSpatialNavigation();

    const focusBeforeMenu = latestFocus;
    latestFocus = null;
    const restoreFocus = () => {
      if (
        focusBeforeMenu?.isConnected &&
        typeof focusBeforeMenu.focus === 'function' &&
        !uiContainer.contains(focusBeforeMenu)
      ) {
        focusBeforeMenu.focus();
      }
    };
    restoreFocus();
    // Some Cobalt versions update focus once more after the colour-key keydown.
    setTimeout(restoreFocus, 0);
  }

  const eventHandler = (evt) => {
    const menuOpen = isContainerOpen();
    const focusInsideMenu = menuOpen && menuHasFocus();
    const eventDirection = menuOpen ? getDirectionFromEvent(evt) : null;

    if (evt.type === 'keyup' && eventDirection) {
      if (heldDirection === eventDirection) {
        heldDirection = null;
      }
      evt.preventDefault();
      evt.stopPropagation();
      return false;
    }

    if (evt.type === 'keydown' && menuOpen) {
      if (!focusInsideMenu) {
        evt.preventDefault();
        evt.stopPropagation();
        captureMenuFocus();
      }

      const direction = eventDirection;
      if (direction) {
        evt.preventDefault();
        evt.stopPropagation();
        const now = Date.now();
        if (
          evt.repeat ||
          (heldDirection === direction && now - heldDirectionAt < 400)
        ) {
          return false;
        }
        heldDirection = direction;
        heldDirectionAt = now;
        queueDirectionMove(direction);
        return false;
      }

      if (
        evt.key === 'Enter' ||
        evt.key === ' ' ||
        evt.code === 'Space' ||
        evt.keyCode === 13 ||
        evt.keyCode === 32 ||
        evt.which === 13 ||
        evt.which === 32
      ) {
        evt.preventDefault();
        evt.stopPropagation();
        const focusedElement = document.querySelector(':focus');
        if (focusedElement && focusedElement.id) {
          // prevent the synthetic click from toggling again
          const wrapper = focusedElement.parentElement;
          if (wrapper) {
            wrapper.dataset.ytafIgnoreClickUntil = String(Date.now() + 1000);
          }
          if (focusedElement.dataset.ytafControl === 'choice') {
            choiceTools.cycle(focusedElement.id);
          } else {
            checkboxTools.toggleCheck(focusedElement.id);
          }
        }
        return false;
      }

      if (evt.key === 'Escape' || evt.keyCode === 27 || evt.keyCode === 461 || evt.keyCode === 8) {
        evt.preventDefault();
        evt.stopPropagation();
        closeContainer();
        return false;
      }
    }

    if (isGreenKey(evt)) {
      console.info('Taking over!');
      evt.preventDefault();
      evt.stopPropagation();
      const now = Date.now();
      if (evt.type === 'keydown' && !evt.repeat && now - lastGreenKeyAt > 350) {
        lastGreenKeyAt = now;
        if (!isContainerOpen()) {
          openContainer();
        } else {
          closeContainer();
        }
      }
      return false;
    }

    if (
      !menuOpen &&
      isSubtitleShortcut(evt) &&
      toggleSubtitles((state, trackName) => {
        const messageKey = {
          on: 'subtitleOn',
          off: 'subtitleOff',
          unavailable: 'subtitleUnavailable'
        }[state];
        let message = text(messageKey || 'subtitleUnavailable');
        if (state === 'on' && trackName) {
          message += ` (${trackName})`;
        }
        showNotification(message, 1800, 'green');
      })
    ) {
      evt.preventDefault();
      evt.stopPropagation();
      return false;
    }

    const playbackRateShortcut = getPlaybackRateShortcut(evt);
    if (
      evt.type === 'keydown' &&
      !evt.repeat &&
      !menuOpen &&
      playbackRateShortcut !== 0 &&
      adjustPlaybackRate(playbackRateShortcut)
    ) {
      evt.preventDefault();
      evt.stopPropagation();
      return false;
    } else if (
      evt.type === 'keydown' &&
      evt.charCode == 0 &&
      evt.keyCode == 187
    ) {
      // char '='
      if (!isContainerOpen()) {
        openContainer();
        evt.preventDefault();
        evt.stopPropagation();
      } else {
        closeContainer();
        evt.preventDefault();
        evt.stopPropagation();
      }
    }
    return true;
  };

  // Red, Green, Yellow, Blue
  // 403, 404, 405, 406
  // ---, 172, 170, 191
  document.addEventListener('keydown', eventHandler, true);
  document.addEventListener('keypress', eventHandler, true);
  document.addEventListener('keyup', eventHandler, true);
  // YouTube's visible player controls can reclaim focus after handling a key.
  // While our menu is open, keep focus modal and restore the last menu item.
  document.addEventListener('focus', guardMenuFocus, true);

  setTimeout(() => {
    showNotification(text('openHint'), 3000, 'green');
  }, 2000);
}

export function showNotification(text, time = 3000, variant = 'yellow') {
  console.info('Show notification: ' + text);
  if (!document.querySelector('.ytaf-notification-container')) {
    console.info('Adding notification container');
    const c = document.createElement('div');
    c.classList.add('ytaf-notification-container');
    document.body.appendChild(c);
  }

  const elm = document.createElement('div');
  const elmInner = document.createElement('div');
  elmInner.textContent = text;
  elmInner.classList.add('message');
  elmInner.classList.add(`message-${variant}`);
  elmInner.classList.add('message-hidden');
  elm.appendChild(elmInner);
  const notificationContainer = document.querySelector('.ytaf-notification-container');
  if (!notificationContainer) return;
  notificationContainer.appendChild(elm);

  setTimeout(() => {
    elmInner.classList.remove('message-hidden');
  }, 100);
  setTimeout(() => {
    elmInner.classList.add('message-hidden');
    setTimeout(() => {
      if (elm.parentNode) elm.parentNode.removeChild(elm);
    }, 1000);
  }, time);
}
