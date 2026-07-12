import './returnyoutubedislike.css';
import { configRead } from './config';

const RYD_API = 'https://returnyoutubedislikeapi.com/votes';

const DESCRIPTION_SELECTORS = {
    panel: 'ytlr-structured-description-content-renderer',
    standardContainer: '.ytLrVideoDescriptionHeaderRendererFactoidContainer',
    compactContainer: '.rznqCe',
    stdFactoid: '.ytLrVideoDescriptionHeaderRendererFactoid',
    stdValue: '.ytLrVideoDescriptionHeaderRendererValue',
    stdLabel: '.ytLrVideoDescriptionHeaderRendererLabel',
    cptFactoid: '.nOJlw',
    cptValue: '.axf6h',
    cptLabel: '.Ph2lNb'
};

const BUTTON_RETRY_DELAYS = [0, 120, 300, 700, 1500, 3000, 6000];

function getVideoIDFromLocation() {
    try {
        const candidates = [location.hash, location.search, location.href];

        for (const candidate of candidates) {
            if (!candidate) continue;
            const normalized = candidate.startsWith('#') ? candidate.substring(1) : candidate;
            const questionMarkIndex = normalized.indexOf('?');
            const query = questionMarkIndex >= 0 ? normalized.substring(questionMarkIndex) : normalized;
            const fromParams = new URLSearchParams(query).get('v');
            if (fromParams) return fromParams;

            const match = normalized.match(/(?:[?&]|^)v=([^&]+)/);
            if (match) return decodeURIComponent(match[1]);
        }

        const playerResponse = window.ytInitialPlayerResponse;
        if (playerResponse?.videoDetails?.videoId) return playerResponse.videoDetails.videoId;

        const playerResponseText = window.ytplayer?.config?.args?.player_response;
        if (playerResponseText) {
            const parsed = JSON.parse(playerResponseText);
            if (parsed?.videoDetails?.videoId) return parsed.videoDetails.videoId;
        }

        return window.__ytafLastVideoId || null;
    } catch (err) {
        const match = location.hash.match(/(?:[?&]|^)v=([^&]+)/);
        return match ? decodeURIComponent(match[1]) : window.__ytafLastVideoId || null;
    }
}

function formatCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
    return `${number}`;
}

function requestJSON(url, timeout, onSuccess, onFailure) {
    const xhr = new XMLHttpRequest();

    xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
            onFailure(new Error(`RYD returned ${xhr.status}`));
            return;
        }

        try {
            onSuccess(JSON.parse(xhr.responseText || '{}'));
        } catch (err) {
            onFailure(new Error(`RYD parse failed: ${err.message || err}`));
        }
    };

    xhr.onerror = () => onFailure(new Error('RYD request failed'));
    xhr.ontimeout = () => onFailure(new Error('RYD request timed out'));
    xhr.open('GET', url);
    xhr.timeout = timeout;
    xhr.send();
}

function findDislikeButton() {
    return document.querySelector('[idomkey="dislike-button"]');
}

function findDislikeLabel(button) {
    if (!button) return null;
    return button.querySelector('yt-formatted-string');
}

function setButtonDisplayState(button, state) {
    if (!button) return;

    button.classList.remove(
        'ytaf-ryd-loading',
        'ytaf-ryd-show-native',
        'ytaf-ryd-show-count'
    );

    button.classList.add(`ytaf-ryd-${state}`);
}

function clearCountSpan(label) {
    if (!label) return;

    const countSpan = label.querySelector('.ytaf-ryd-count-span');
    if (countSpan?.parentElement) {
        countSpan.parentElement.removeChild(countSpan);
    }
}

function ensureCountSpan(label, count) {
    let countSpan = label.querySelector('.ytaf-ryd-count-span');

    if (!countSpan) {
        countSpan = document.createElement('span');
        countSpan.className = 'ytaf-ryd-count-span';
        countSpan.setAttribute('data-ytaf-ryd-count-span', 'true');
    }

    if (label.firstChild !== countSpan) {
        label.insertBefore(countSpan, label.firstChild);
    }

    if (countSpan.textContent !== count) {
        countSpan.textContent = count;
    }
}

function findDescriptionPanel() {
    return document.querySelector(DESCRIPTION_SELECTORS.panel);
}

function classNameFromSelector(selector) {
    return selector && selector[0] === '.' ? selector.substring(1) : '';
}

class ReturnYouTubeDislike {
    videoID = null;
    dislikes = 'n/a';
    votesLoaded = false;
    dislikeButton = null;
    dislikeButtonObserver = null;
    domObserver = null;
    globalActivateHandler = null;
    retryTimers = [];
    refreshTimer = null;
    domRefreshTimer = null;
    isUpdatingButton = false;
    optimisticDisliked = false;
    lastLocalToggleAt = 0;

    init(videoID) {
        this.videoID = videoID;
        this.votesLoaded = false;
        this.dislikes = 'n/a';

        this.globalActivateHandler = (evt) => this.handleGlobalActivate(evt);
        document.addEventListener('keydown', this.globalActivateHandler, true);
        document.addEventListener('click', this.globalActivateHandler, true);

        this.fetchVotes();
        this.observePageChanges();
        this.scheduleInitialRefreshes();
    }

    fetchVotes() {
        if (!this.videoID) return;

        this.votesLoaded = false;
        this.dislikes = 'n/a';

        const url = `${RYD_API}?videoId=${encodeURIComponent(this.videoID)}`;
        requestJSON(
            url,
            8000,
            (results) => {
                this.votesLoaded = true;
                this.dislikes = Number.isFinite(Number(results.dislikes))
                    ? Number(results.dislikes)
                    : 'n/a';
                this.refresh();
                this.scheduleRefresh(400);
            },
            () => {
                this.votesLoaded = true;
                this.dislikes = 'n/a';
                this.refresh();
            }
        );
    }

    scheduleInitialRefreshes() {
        this.clearRetryTimers();
        BUTTON_RETRY_DELAYS.forEach((delay) => {
            this.retryTimers.push(setTimeout(() => this.refresh(), delay));
        });
    }

    clearRetryTimers() {
        this.retryTimers.forEach((timer) => clearTimeout(timer));
        this.retryTimers = [];
    }

    scheduleRefresh(delay) {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refresh();
        }, delay);
    }

    observePageChanges() {
        if (this.domObserver || !document.body) return;

        this.domObserver = new MutationObserver(() => {
            if (this.domRefreshTimer) return;

            this.domRefreshTimer = setTimeout(() => {
                this.domRefreshTimer = null;
                this.refresh();
            }, 250);
        });

        this.domObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    refresh() {
        this.updateDislikeButton();
        this.updateDescriptionDislikes();
    }

    updateDislikeButton() {
        const button = this.dislikeButton && document.contains(this.dislikeButton)
            ? this.dislikeButton
            : findDislikeButton();

        if (!button) return;

        this.bindDislikeButton(button);
        this.applyDislikeCount();
    }

    bindDislikeButton(button) {
        if (this.dislikeButton === button && this.dislikeButtonObserver) return;

        if (this.dislikeButtonObserver) {
            this.dislikeButtonObserver.disconnect();
            this.dislikeButtonObserver = null;
        }

        this.dislikeButton = button;
        this.dislikeButtonObserver = new MutationObserver(() => this.applyDislikeCount());
        this.dislikeButtonObserver.observe(button, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    applyDislikeCount() {
        if (this.isUpdatingButton || !this.dislikeButton) return;

        const label = findDislikeLabel(this.dislikeButton);
        if (!label) return;

        const dislikeCount = Number(this.dislikes);
        const count = formatCount(dislikeCount);

        this.isUpdatingButton = true;
        try {
            if (!this.votesLoaded) {
                clearCountSpan(label);
                setButtonDisplayState(this.dislikeButton, 'loading');
                return;
            }

            if (!count || !Number.isFinite(dislikeCount) || dislikeCount <= 0) {
                clearCountSpan(label);
                setButtonDisplayState(this.dislikeButton, 'show-native');
                return;
            }

            ensureCountSpan(label, count);
            setButtonDisplayState(this.dislikeButton, 'show-count');
        } finally {
            this.isUpdatingButton = false;
        }
    }

    handleGlobalActivate(evt) {
        const menuOpen = document.querySelector('.ytaf-ui-container')?.style?.display !== 'none';
        const focusInsideMenu = menuOpen && (
            document.activeElement === document.querySelector('.ytaf-ui-container') ||
            document.querySelector('.ytaf-ui-container')?.contains(document.activeElement)
        );

        if (focusInsideMenu) {
            // Let the custom UI handle Enter/Space while it's open on TV
            return;
        }

        if (evt.type === 'keydown') {
            const keyCode = evt.keyCode || evt.which;
            if (keyCode !== 13 && keyCode !== 32) return;
        }

        const button = this.dislikeButton && document.contains(this.dislikeButton)
            ? this.dislikeButton
            : findDislikeButton();

        if (button) {
            this.bindDislikeButton(button);
            this.applyDislikeCount();

            const target = evt.type === 'keydown' ? document.activeElement : evt.target;
            if (target === button || button.contains(target)) {
                this.handleDislikeToggle();
            }
        }

        // The description panel is created after Enter/click. A delayed refresh is
        // cheaper than observing the whole document permanently.
        this.scheduleRefresh(250);
        setTimeout(() => this.refresh(), 900);
    }

    handleDislikeToggle() {
        const now = Date.now();
        if (now - this.lastLocalToggleAt < 300) return;
        this.lastLocalToggleAt = now;

        const current = Number(this.dislikes);
        const base = Number.isFinite(current) ? current : 0;

        this.votesLoaded = true;
        this.optimisticDisliked = !this.optimisticDisliked;
        this.dislikes = Math.max(0, base + (this.optimisticDisliked ? 1 : -1));

        this.applyDislikeCount();
        this.updateDescriptionDislikes();
    }

    getDescriptionMode(panel) {
        const standardContainer = panel.querySelector(DESCRIPTION_SELECTORS.standardContainer);
        if (standardContainer) {
            return {
                container: standardContainer,
                factoidClass: DESCRIPTION_SELECTORS.stdFactoid,
                valueSelector: DESCRIPTION_SELECTORS.stdValue,
                labelSelector: DESCRIPTION_SELECTORS.stdLabel
            };
        }

        const compactContainer = panel.querySelector(DESCRIPTION_SELECTORS.compactContainer);
        if (compactContainer) {
            return {
                container: compactContainer,
                factoidClass: DESCRIPTION_SELECTORS.cptFactoid,
                valueSelector: DESCRIPTION_SELECTORS.cptValue,
                labelSelector: DESCRIPTION_SELECTORS.cptLabel
            };
        }

        return null;
    }

    findDescriptionLikesElement(mode) {
        return mode.container.querySelector(
            `div[idomkey="factoid-0"]${mode.factoidClass}, div[aria-label*="like"]${mode.factoidClass}, div[aria-label*="Like"]${mode.factoidClass}, div[aria-label*="Gefällt"]${mode.factoidClass}`
        );
    }

    createDescriptionDislikeElement(likesElement, mode) {
        const dislikeElement = document.createElement(likesElement.tagName || 'div');
        dislikeElement.id = 'ytaf-ryd-description-dislikes';
        dislikeElement.className = likesElement.className || classNameFromSelector(mode.factoidClass);
        dislikeElement.removeAttribute('idomkey');

        const sourceValue = likesElement.querySelector(mode.valueSelector);
        const sourceLabel = likesElement.querySelector(mode.labelSelector);

        const valueElement = document.createElement(sourceValue?.tagName || 'div');
        valueElement.className = sourceValue?.className || classNameFromSelector(mode.valueSelector);
        valueElement.setAttribute('data-ytaf-ryd-description-value', 'true');

        const labelElement = document.createElement(sourceLabel?.tagName || 'div');
        labelElement.className = sourceLabel?.className || classNameFromSelector(mode.labelSelector);
        labelElement.setAttribute('data-ytaf-ryd-description-label', 'true');
        labelElement.textContent = 'Dislikes';

        dislikeElement.appendChild(valueElement);
        dislikeElement.appendChild(labelElement);
        return dislikeElement;
    }

    updateDescriptionDislikes() {
        const dislikeCount = Number(this.dislikes);
        if (!Number.isFinite(dislikeCount)) return;

        const panel = findDescriptionPanel();
        if (!panel) return;

        const mode = this.getDescriptionMode(panel);
        if (!mode) return;

        let dislikeElement = document.getElementById('ytaf-ryd-description-dislikes');
        if (!dislikeElement || !mode.container.contains(dislikeElement)) {
            const likesElement = this.findDescriptionLikesElement(mode);
            if (!likesElement) return;

            dislikeElement = this.createDescriptionDislikeElement(likesElement, mode);
            likesElement.insertAdjacentElement('afterend', dislikeElement);
            mode.container.classList.add('ytaf-ryd-ready');
        }

        const dislikeText = formatCount(dislikeCount);
        const valueElement = dislikeElement.querySelector('[data-ytaf-ryd-description-value="true"]');
        const labelElement = dislikeElement.querySelector('[data-ytaf-ryd-description-label="true"]');

        if (valueElement && valueElement.textContent !== dislikeText) {
            valueElement.textContent = dislikeText;
        }
        if (labelElement && labelElement.textContent !== 'Dislikes') {
            labelElement.textContent = 'Dislikes';
        }
        dislikeElement.setAttribute('aria-label', `${dislikeText} Dislikes`);
    }

    destroy() {
        this.clearRetryTimers();

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }

        if (this.domRefreshTimer) {
            clearTimeout(this.domRefreshTimer);
            this.domRefreshTimer = null;
        }

        if (this.globalActivateHandler) {
            document.removeEventListener('keydown', this.globalActivateHandler, true);
            document.removeEventListener('click', this.globalActivateHandler, true);
            this.globalActivateHandler = null;
        }

        if (this.domObserver) {
            this.domObserver.disconnect();
            this.domObserver = null;
        }

        if (this.dislikeButtonObserver) {
            this.dislikeButtonObserver.disconnect();
            this.dislikeButtonObserver = null;
        }

        const descriptionDislikes = document.getElementById('ytaf-ryd-description-dislikes');
        if (descriptionDislikes?.parentElement) {
            descriptionDislikes.parentElement.removeChild(descriptionDislikes);
        }

        if (this.dislikeButton) {
            this.dislikeButton.classList.remove(
                'ytaf-ryd-loading',
                'ytaf-ryd-show-native',
                'ytaf-ryd-show-count'
            );
        }

        this.dislikeButton = null;
    }
}

function loadReturnYouTubeDislikeForCurrentVideo() {
    const videoID = getVideoIDFromLocation();
    if (!videoID || !configRead('enableReturnYouTubeDislike')) {
        if (window.returnYoutubeDislike) {
            window.returnYoutubeDislike.destroy();
            window.returnYoutubeDislike = null;
        }
        return;
    }

    if (window.returnYoutubeDislike && window.returnYoutubeDislike.videoID === videoID) {
        window.returnYoutubeDislike.scheduleRefresh?.(0);
        return;
    }

    if (window.returnYoutubeDislike) {
        window.returnYoutubeDislike.destroy();
    }

    window.returnYoutubeDislike = new ReturnYouTubeDislike();
    window.returnYoutubeDislike.init(videoID);
}

let initTimeout = null;

function scheduleLoadReturnYouTubeDislike() {
    if (initTimeout) clearTimeout(initTimeout);
    initTimeout = setTimeout(loadReturnYouTubeDislikeForCurrentVideo, 150);
}

export function userScriptStartReturnYouTubeDislike() {
    window.returnYoutubeDislike = window.returnYoutubeDislike || null;
    window.addEventListener('hashchange', scheduleLoadReturnYouTubeDislike, false);

    if (document.readyState === 'loading') {
        window.addEventListener('load', () => setTimeout(scheduleLoadReturnYouTubeDislike, 500), { once: true });
    } else {
        setTimeout(scheduleLoadReturnYouTubeDislike, 500);
    }
}
