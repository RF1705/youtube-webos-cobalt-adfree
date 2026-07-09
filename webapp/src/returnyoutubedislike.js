import { configRead } from './config';

const RYD_API = 'https://returnyoutubedislikeapi.com/votes';
const DESCRIPTION_SELECTORS = {
    panel:
        'ytlr-structured-description-content-renderer, ytlr-video-description-header-renderer, ytlr-video-description-header-view-model, ytlr-watch-metadata-renderer',
    standardContainer: '.ytLrVideoDescriptionHeaderRendererFactoidContainer',
    compactContainer: '.rznqCe',
    stdFactoid: '.ytLrVideoDescriptionHeaderRendererFactoid',
    stdValue: '.ytLrVideoDescriptionHeaderRendererValue',
    stdLabel: '.ytLrVideoDescriptionHeaderRendererLabel',
    cptFactoid: '.nOJlw',
    cptValue: '.axf6h',
    cptLabel: '.Ph2lNb'
};

function getVideoIDFromLocation() {
    try {
        const candidates = [location.hash, location.search, location.href];

        for (const candidate of candidates) {
            if (!candidate) continue;
            const normalized = candidate.startsWith('#')
                ? candidate.substring(1)
                : candidate;
            const questionMarkIndex = normalized.indexOf('?');
            const query =
                questionMarkIndex >= 0 ? normalized.substring(questionMarkIndex) : normalized;
            const fromParams = new URLSearchParams(query).get('v');
            if (fromParams) return fromParams;

            const match = normalized.match(/(?:[?&]|^)v=([^&]+)/);
            if (match) return decodeURIComponent(match[1]);
        }

        const playerResponse = window.ytInitialPlayerResponse;
        if (playerResponse?.videoDetails?.videoId) {
            return playerResponse.videoDetails.videoId;
        }

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

function safeJsonSample(value, limit = 180) {
    try {
        return JSON.stringify(value).substring(0, limit);
    } catch (err) {
        return `sample failed: ${err.message || err}`;
    }
}

function formatCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
    return `${number}`;
}

function summarizeDomElement(element) {
    if (!element || !element.getBoundingClientRect) return 'none';

    const rect = element.getBoundingClientRect();
    const cls =
        element.className && typeof element.className === 'string'
            ? `.${element.className.trim().split(/\s+/).slice(0, 4).join('.')}`
            : '';
    const aria = element.getAttribute?.('aria-label') || '';
    const idomkey = element.getAttribute?.('idomkey') || '';
    const text = (element.innerText || element.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 34);
    const suffix = [idomkey && `idom=${idomkey}`, aria && `aria=${aria}`, text]
        .filter(Boolean)
        .join(' ');

    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${cls} ${Math.round(
        rect.width
    )}x${Math.round(rect.height)} @${Math.round(rect.left)},${Math.round(
        rect.top
    )}${suffix ? ` ${suffix}` : ''}`.substring(0, 190);
}

function findDislikeButton() {
    const exact = document.querySelector('[idomkey="dislike-button"]');
    if (exact) return exact;

    const candidates = Array.prototype.slice.call(
        document.querySelectorAll(
            'button, [role="button"], ytlr-button-renderer, yt-button-container, [aria-label], [idomkey]'
        )
    );

    return (
        candidates
            .map((element) => ({ element, score: scoreButtonCandidate(element) }))
            .filter(({ score }) => score > 1000)
            .sort((a, b) => b.score - a.score)[0]?.element || null
    );
}

function findDescriptionPanel() {
    const exactPanels = Array.prototype.slice.call(
        document.querySelectorAll(DESCRIPTION_SELECTORS.panel)
    );
    const exactWithStats = exactPanels.find((element) => {
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        return /(?:likes|gefällt|gefaellt)/i.test(text) && /(?:aufrufe|views)/i.test(text);
    });
    if (exactWithStats) return exactWithStats;

    const elements = Array.prototype.slice.call(document.querySelectorAll('*'));
    return (
        elements.find((element) => {
            const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
            const rect = element.getBoundingClientRect?.();
            return (
                rect &&
                rect.width > 260 &&
                rect.height > 80 &&
                /(?:likes|gefällt|gefaellt)/i.test(text) &&
                /(?:aufrufe|views)/i.test(text)
            );
        }) ||
        exactPanels[0] ||
        null
    );
}

const DISLIKE_LABEL_PATTERN =
    /^(mag ich nicht|gefällt mir nicht|gefaellt mir nicht|dislike|thumbs down|\d+(?:[,.]\d+)?[km]?)$/i;

function compactText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function isVisualTextElement(element) {
    if (!element || !element.tagName) return false;
    const tagName = element.tagName.toLowerCase();
    if (['svg', 'path', 'use', 'img', 'canvas'].includes(tagName)) return false;
    if (element.querySelector?.('svg, path, use, img, canvas')) return false;
    return true;
}

function markDislikeLabel(element) {
    if (!element) return null;
    element.setAttribute('data-ytaf-ryd-label', 'true');
    return element;
}

function findRememberedDislikeLabel(button) {
    const remembered = button.querySelector('[data-ytaf-ryd-label="true"]');
    if (remembered && isVisualTextElement(remembered)) return remembered;

    const original = button.querySelector('[data-ytaf-ryd-original-label]');
    if (original && isVisualTextElement(original)) return markDislikeLabel(original);

    return null;
}

function findExistingDislikeLabel(button) {
    const remembered = findRememberedDislikeLabel(button);
    if (remembered) return remembered;

    const elements = Array.prototype.slice.call(button.querySelectorAll('*'));

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        const text = compactText(element.textContent);
        if (!text || !DISLIKE_LABEL_PATTERN.test(text)) continue;
        if (element.children && element.children.length) continue;
        if (!isVisualTextElement(element)) continue;
        return markDislikeLabel(element);
    }

    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, null);
    let textNode = walker.nextNode();
    while (textNode) {
        const text = compactText(textNode.nodeValue);
        if (DISLIKE_LABEL_PATTERN.test(text) && textNode.parentElement) {
            return markDislikeLabel(textNode.parentElement);
        }
        textNode = walker.nextNode();
    }

    return null;
}

function findEmptyDislikeLabelSlot(button) {
    const elements = Array.prototype.slice.call(button.querySelectorAll('*'));

    return (
        elements.find((element) => {
            if (element.children && element.children.length) return false;
            if (!isVisualTextElement(element)) return false;
            const text = compactText(element.textContent);
            if (text) return false;

            const marker = [
                element.id,
                element.className,
                element.getAttribute?.('idomkey'),
                element.getAttribute?.('aria-label')
            ]
                .filter(Boolean)
                .join(' ');

            return /label|text|value|count/i.test(marker);
        }) || null
    );
}

function findDislikeLabel(button, allowEmptySlot = false) {
    const existing = findExistingDislikeLabel(button);
    if (existing) return existing;

    if (allowEmptySlot) {
        const emptySlot = findEmptyDislikeLabelSlot(button);
        if (emptySlot) return markDislikeLabel(emptySlot);
    }

    return null;
}

function overwriteDislikeLabels(button, text) {
    let changed = 0;
    const target = findDislikeLabel(button, true);

    if (target) {
        const current = compactText(target.textContent);
        if (!target.getAttribute('data-ytaf-ryd-original-label')) {
            target.setAttribute('data-ytaf-ryd-original-label', current || 'Mag ich nicht');
        }
        if (target.textContent !== text) {
            target.textContent = text;
            changed += 1;
        }
        markDislikeLabel(target);
    }

    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, null);
    let textNode = walker.nextNode();
    while (textNode) {
        const current = compactText(textNode.nodeValue);
        if (DISLIKE_LABEL_PATTERN.test(current) && textNode.nodeValue !== text) {
            textNode.nodeValue = text;
            if (textNode.parentElement) markDislikeLabel(textNode.parentElement);
            changed += 1;
        }
        textNode = walker.nextNode();
    }

    button.setAttribute('count', text);
    button.setAttribute('data-ytaf-ryd-count', text);
    try {
        button.count = text;
    } catch (err) {
        // Some custom elements expose read-only properties.
    }
    return changed;
}

function scheduleLabelOverwrite(handler) {
    handler.applyDislikeLabel();
    setTimeout(() => handler.applyDislikeLabel(), 0);
    setTimeout(() => handler.applyDislikeLabel(), 40);
    setTimeout(() => handler.applyDislikeLabel(), 120);
    setTimeout(() => handler.applyDislikeLabel(), 300);
    setTimeout(() => handler.applyDislikeLabel(), 700);
    requestAnimationFrame(() => handler.applyDislikeLabel());
}

function getButtonStateSignature(button) {
    if (!button) return '';
    const values = [
        button.className,
        button.getAttribute?.('aria-pressed'),
        button.getAttribute?.('aria-selected'),
        button.getAttribute?.('selected'),
        button.getAttribute?.('checked')
    ];

    let current = button.parentElement;
    for (let i = 0; i < 3 && current; i++) {
        values.push(current.className);
        values.push(current.getAttribute?.('aria-pressed'));
        values.push(current.getAttribute?.('aria-selected'));
        current = current.parentElement;
    }

    return values.filter(Boolean).join('|');
}

function scoreButtonCandidate(element) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1000;
    if (rect.bottom < window.innerHeight * 0.35) return -300;

    const text = [
        element.id,
        element.className,
        element.getAttribute?.('aria-label'),
        element.getAttribute?.('title'),
        element.getAttribute?.('role'),
        element.getAttribute?.('idomkey'),
        element.innerText,
        element.textContent
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    let score = 0;
    if (/dislike|nicht.?gefall|gefällt mir nicht|thumb.?down|thumbs.?down/.test(text)) {
        score += 1400;
    }
    if (/like|gefällt|thumb/.test(text)) score += 350;
    if (/button|renderer|toggle|segmented/.test(text)) score += 250;
    if (element.matches?.('button, [role="button"], ytlr-button-renderer')) score += 300;
    if (rect.width >= 30 && rect.width <= 220) score += 120;
    if (rect.height >= 20 && rect.height <= 120) score += 120;
    if (rect.top > window.innerHeight * 0.45) score += 80;
    if (element === document.activeElement || element.matches?.(':focus')) score += 700;
    if (element.closest?.('.ytaf-ui-container, #ytaf-player-debug-panel')) score -= 2000;

    return score;
}

function getButtonProbeSummary() {
    const selectors = [
        'button',
        '[role="button"]',
        'ytlr-button-renderer',
        'ytlr-toggle-button-renderer',
        'ytlr-segmented-like-dislike-button-renderer',
        'ytlr-like-dislike-button-renderer',
        '[aria-label]',
        '[idomkey]'
    ];
    const seen = [];
    const elements = [];

    selectors.forEach((selector) => {
        Array.prototype.forEach.call(document.querySelectorAll(selector), (element) => {
            if (!element || seen.includes(element)) return;
            seen.push(element);
            elements.push(element);
        });
    });

    return elements
        .map((element) => ({ element, score: scoreButtonCandidate(element) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ element, score }) => `${score}:${summarizeDomElement(element)}`)
        .join(' | ')
        .substring(0, 900);
}

function xhrJSONWithTimeout(url, timeout, onSuccess, onFailure, handler) {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
        const responseText = xhr.responseText || '';
        handler.lastStatus = xhr.status;
        handler.lastBody = responseText.substring(0, 220);
        handler.lastParsedSample = '';

        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                const parsed = JSON.parse(responseText);
                handler.lastParsedSample = safeJsonSample(parsed);
                onSuccess(parsed);
            } catch (err) {
                onFailure(new Error(`RYD parse failed: ${err.message || err}`));
            }
        } else {
            onFailure(new Error(`RYD returned ${xhr.status}`));
        }
    };
    xhr.onerror = () => onFailure(new Error('RYD request failed'));
    xhr.ontimeout = () => onFailure(new Error('RYD request timed out'));
    xhr.open('GET', url);
    xhr.timeout = timeout;
    xhr.send();
}

function ensureDescriptionStyles() {
    if (document.getElementById('ytaf-ryd-description-styles')) return;

    const style = document.createElement('style');
    style.id = 'ytaf-ryd-description-styles';
    style.textContent = `
${DESCRIPTION_SELECTORS.panel} ${DESCRIPTION_SELECTORS.standardContainer}.ytaf-ryd-ready,
${DESCRIPTION_SELECTORS.panel} ${DESCRIPTION_SELECTORS.compactContainer}.ytaf-ryd-ready {
  display: flex !important;
  flex-wrap: wrap !important;
  justify-content: center !important;
  gap: 1rem !important;
  height: auto !important;
  overflow: visible !important;
}
#ytaf-ryd-description-dislikes.ytaf-ryd-description-factoid {
  flex: 0 0 auto !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  min-width: 56px !important;
  color: inherit !important;
  text-align: center !important;
}
#ytaf-ryd-description-dislikes .ytaf-ryd-description-value {
  color: inherit !important;
  font: inherit !important;
  font-weight: 500 !important;
  line-height: 1.2 !important;
}
#ytaf-ryd-description-dislikes .ytaf-ryd-description-label {
  color: inherit !important;
  font: inherit !important;
  line-height: 1.2 !important;
  opacity: 0.86 !important;
}
`;
    document.head.appendChild(style);
}

function classNameFromSelector(selector) {
    return selector && selector.startsWith('.') ? selector.substring(1) : '';
}

function createDescriptionDislikeElement(mode) {
    const factoidClass = classNameFromSelector(mode?.factoidClass);
    const valueClass = classNameFromSelector(mode?.valueSelector);
    const labelClass = classNameFromSelector(mode?.labelSelector);

    const element = document.createElement('div');
    element.id = 'ytaf-ryd-description-dislikes';
    element.className = ['ytaf-ryd-description-factoid', factoidClass]
        .filter(Boolean)
        .join(' ');

    const value = document.createElement('div');
    value.className = ['ytaf-ryd-description-value', valueClass]
        .filter(Boolean)
        .join(' ');

    const label = document.createElement('div');
    label.className = ['ytaf-ryd-description-label', labelClass]
        .filter(Boolean)
        .join(' ');
    label.textContent = 'Dislikes';

    element.appendChild(value);
    element.appendChild(label);
    return element;
}

class ReturnYouTubeDislikeProbe {
    videoID = null;
    active = true;
    fetchStatus = 'idle';
    fetchError = '';
    requestUrl = '';
    lastStatus = 'n/a';
    lastBody = '';
    lastParsedSample = '';
    likes = 'n/a';
    dislikes = 'n/a';
    rating = 'n/a';
    viewCount = 'n/a';
    focusedElement = 'none';
    targetElement = 'none';
    buttonCandidates = 'none';
    injectedText = 'n/a';
    probeInterval = null;
    dislikeButton = null;
    dislikeButtonActivateHandler = null;
    globalActivateHandler = null;
    focusInHandler = null;
    focusOutHandler = null;
    dislikeButtonObserver = null;
    pendingDislikeToggle = false;
    pendingToggleTimer = null;
    lastButtonStateSignature = '';
    descriptionObserver = null;
    domObserverFrame = null;
    optimisticDisliked = false;
    lastLocalToggleAt = 0;
    isUpdatingLabel = false;

    init(videoID) {
        this.videoID = videoID;
        ensureDescriptionStyles();
        this.globalActivateHandler = (evt) => this.handleGlobalActivate(evt);
        this.focusInHandler = (evt) => this.handleFocusIn(evt);
        this.focusOutHandler = (evt) => this.handleFocusOut(evt);
        document.addEventListener('keydown', this.globalActivateHandler, true);
        document.addEventListener('click', this.globalActivateHandler, true);
        document.addEventListener('focusin', this.focusInHandler, true);
        document.addEventListener('focusout', this.focusOutHandler, true);
        this.fetchVotes();
        this.startButtonProbe();
        this.startDescriptionObserver();
    }

    fetchVotes() {
        if (!this.videoID) return;

        const url = `${RYD_API}?videoId=${encodeURIComponent(this.videoID)}`;
        this.requestUrl = url;
        this.fetchStatus = 'fetching';
        this.fetchError = '';
        this.lastStatus = 'n/a';
        this.lastBody = '';
        this.lastParsedSample = '';
        this.likes = 'n/a';
        this.dislikes = 'n/a';
        this.rating = 'n/a';
        this.viewCount = 'n/a';

        xhrJSONWithTimeout(
            url,
            8000,
            (results) => {
                this.fetchStatus = 'loaded';
                this.fetchError = '';
                this.likes = Number.isFinite(Number(results.likes))
                    ? Number(results.likes)
                    : 'n/a';
                this.dislikes = Number.isFinite(Number(results.dislikes))
                    ? Number(results.dislikes)
                    : 'n/a';
                this.rating = Number.isFinite(Number(results.rating))
                    ? Number(results.rating).toFixed(3)
                    : 'n/a';
                this.viewCount = Number.isFinite(Number(results.viewCount))
                    ? Number(results.viewCount)
                    : 'n/a';
                this.updateDescriptionDislikes();
            },
            (err) => {
                this.fetchStatus = 'fetch-error';
                this.fetchError = err.message || String(err);
            },
            this
        );
    }

    startButtonProbe() {
        this.stopButtonProbe();
        const update = () => {
            this.focusedElement = summarizeDomElement(document.activeElement);
            this.updateDislikeButton();
            this.updateDescriptionDislikes();
            this.buttonCandidates = getButtonProbeSummary() || 'none';
        };
        update();
        this.probeInterval = setInterval(update, 250);
    }

    stopButtonProbe() {
        if (this.probeInterval) {
            clearInterval(this.probeInterval);
            this.probeInterval = null;
        }
    }

    updateDislikeButton() {
        const button = findDislikeButton();
        this.targetElement = summarizeDomElement(button);

        if (!button) {
            this.injectedText = 'button missing';
            return;
        }

        this.bindDislikeButton(button);
        this.applyDislikeLabel();
    }

    applyDislikeLabel() {
        if (this.isUpdatingLabel || !this.dislikeButton) return;

        const count = formatCount(this.dislikes);
        const dislikeCount = Number(this.dislikes);

        let label = findDislikeLabel(this.dislikeButton, true);
        if (!label) {
            this.injectedText = 'label missing';
            return;
        }

        if (!label.getAttribute('data-ytaf-ryd-original-label')) {
            label.setAttribute(
                'data-ytaf-ryd-original-label',
                (label.textContent || '').replace(/\s+/g, ' ').trim()
            );
        }

        const originalLabel =
            label.getAttribute('data-ytaf-ryd-original-label') || 'Mag ich nicht';

        if (!count || !Number.isFinite(dislikeCount) || dislikeCount <= 0) {
            if (label.textContent !== originalLabel) {
                this.isUpdatingLabel = true;
                label.textContent = originalLabel;
                this.isUpdatingLabel = false;
            }
            this.injectedText = 'original';
            return;
        }

        if (label.textContent !== count) {
            this.isUpdatingLabel = true;
            overwriteDislikeLabels(this.dislikeButton, count);
            label = findDislikeLabel(this.dislikeButton, true) || label;
            this.isUpdatingLabel = false;
        }
        this.injectedText = count;
    }

    bindDislikeButton(button) {
        if (this.dislikeButton === button && this.dislikeButtonActivateHandler) return;

        if (this.dislikeButton && this.dislikeButtonActivateHandler) {
            this.dislikeButton.removeEventListener(
                'click',
                this.dislikeButtonActivateHandler,
                true
            );
            this.dislikeButton.removeEventListener(
                'keyup',
                this.dislikeButtonActivateHandler,
                true
            );
        }

        if (this.dislikeButtonObserver) {
            this.dislikeButtonObserver.disconnect();
            this.dislikeButtonObserver = null;
        }

        this.dislikeButton = button;
        this.dislikeButtonActivateHandler = (evt) => this.handleDislikeButtonActivate(evt);
        button.addEventListener('click', this.dislikeButtonActivateHandler, true);
        button.addEventListener('keyup', this.dislikeButtonActivateHandler, true);

        this.lastButtonStateSignature = getButtonStateSignature(button);
        this.dislikeButtonObserver = new MutationObserver((mutations) => {
            const hasAttributeMutation = mutations.some(
                (mutation) => mutation.type === 'attributes'
            );
            if (hasAttributeMutation) {
                const signature = getButtonStateSignature(button);
                if (signature !== this.lastButtonStateSignature) {
                    this.lastButtonStateSignature = signature;
                    this.commitPendingDislikeToggle('state-change');
                }
            }
            scheduleLabelOverwrite(this);
        });
        this.dislikeButtonObserver.observe(button, {
            attributes: true,
            attributeFilter: ['class', 'aria-label', 'aria-pressed', 'aria-selected', 'selected', 'checked', 'count'],
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    handleDislikeButtonActivate(evt) {
        if (evt.type === 'keyup') {
            const keyCode = evt.keyCode || evt.which;
            if (keyCode !== 13 && keyCode !== 32) return;
        }

        const now = Date.now();
        if (now - this.lastLocalToggleAt < 250) return;
        this.lastLocalToggleAt = now;

        this.pendingDislikeToggle = true;
        clearTimeout(this.pendingToggleTimer);
        this.pendingToggleTimer = setTimeout(
            () => this.commitPendingDislikeToggle('timeout'),
            180
        );
    }

    commitPendingDislikeToggle(reason) {
        if (!this.pendingDislikeToggle) return;
        this.pendingDislikeToggle = false;
        clearTimeout(this.pendingToggleTimer);
        this.pendingToggleTimer = null;

        const current = Number(this.dislikes);
        if (!Number.isFinite(current)) return;

        this.optimisticDisliked = !this.optimisticDisliked;
        this.dislikes = Math.max(0, current + (this.optimisticDisliked ? 1 : -1));
        this.injectedText = `${reason} ${this.dislikes}`;
        scheduleLabelOverwrite(this);
        this.updateDescriptionDislikes();
    }

    handleGlobalActivate(evt) {
        const button = this.dislikeButton || findDislikeButton();
        if (!button) return;

        if (evt.type === 'keydown') {
            const keyCode = evt.keyCode || evt.which;
            if (keyCode !== 13 && keyCode !== 32) return;
            const active = document.activeElement;
            if (active !== button && !button.contains(active)) return;
        } else if (evt.type === 'click') {
            const target = evt.target;
            if (target !== button && !button.contains(target)) return;
        } else {
            return;
        }

        this.handleDislikeButtonActivate({ type: 'local' });
    }

    handleFocusIn(evt) {
        const button = findDislikeButton();
        if (!button) return;
        if (evt.target !== button && !button.contains(evt.target)) return;

        this.bindDislikeButton(button);
        scheduleLabelOverwrite(this);
    }

    handleFocusOut(evt) {
        const button = this.dislikeButton || findDislikeButton();
        if (!button) return;
        if (evt.target !== button && !button.contains(evt.target)) return;

        scheduleLabelOverwrite(this);
        setTimeout(() => scheduleLabelOverwrite(this), 180);
    }

    startDescriptionObserver() {
        if (this.descriptionObserver) {
            this.descriptionObserver.disconnect();
        }

        this.descriptionObserver = new MutationObserver(() => {
            if (this.domObserverFrame) return;
            this.domObserverFrame = requestAnimationFrame(() => {
                this.domObserverFrame = null;
                this.focusedElement = summarizeDomElement(document.activeElement);
                this.updateDislikeButton();
                this.updateDescriptionDislikes();
            });
        });
        this.descriptionObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-expanded']
        });
    }

    getDescriptionMode(panel) {
        const standardContainer = panel.querySelector(
            DESCRIPTION_SELECTORS.standardContainer
        );
        if (standardContainer) {
            return {
                container: standardContainer,
                factoidClass: DESCRIPTION_SELECTORS.stdFactoid,
                valueSelector: DESCRIPTION_SELECTORS.stdValue,
                labelSelector: DESCRIPTION_SELECTORS.stdLabel
            };
        }

        const compactContainer = panel.querySelector(
            DESCRIPTION_SELECTORS.compactContainer
        );
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

    findDescriptionLikesElement(panel, mode) {
        if (mode?.container) {
            const classSelector = mode.factoidClass || '';
            const bySelector = mode.container.querySelector(
                `div[idomkey="factoid-0"]${classSelector}, div[aria-label*="like"]${classSelector}, div[aria-label*="Like"]${classSelector}, div[aria-label*="Likes"]${classSelector}, div[aria-label*="Gefällt"]${classSelector}`
            );
            if (bySelector) return bySelector;
        }

        const labelPattern = /(?:^|\s)(likes|gefällt|gefaellt)(?:\s|$)/i;
        const candidates = Array.prototype.slice.call(panel.querySelectorAll('*'));
        for (let i = 0; i < candidates.length; i++) {
            const element = candidates[i];
            const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
            if (!labelPattern.test(text) || !/\d/.test(text)) continue;
            if (/dislikes/i.test(text)) continue;

            let current = element;
            while (current && current !== panel && current.parentElement) {
                const rect = current.getBoundingClientRect?.();
                const currentText = (current.textContent || '').replace(/\s+/g, ' ').trim();
                const looksLikeFactoid =
                    rect &&
                    rect.width > 20 &&
                    rect.height > 20 &&
                    rect.width < 260 &&
                    rect.height < 160 &&
                    /\d/.test(currentText) &&
                    /(?:likes|gefällt|gefaellt)/i.test(currentText) &&
                    !/dislikes/i.test(currentText);

                if (looksLikeFactoid) return current;
                current = current.parentElement;
            }
        }

        return null;
    }

    getFactoidTextElements(factoid, mode) {
        const valueByCustomClass = factoid.querySelector(
            '.ytaf-ryd-description-value'
        );
        const labelByCustomClass = factoid.querySelector(
            '.ytaf-ryd-description-label'
        );

        if (valueByCustomClass && labelByCustomClass) {
            return {
                valueElement: valueByCustomClass,
                labelElement: labelByCustomClass
            };
        }

        const valueByMode = mode?.valueSelector
            ? factoid.querySelector(mode.valueSelector)
            : null;
        const labelByMode = mode?.labelSelector
            ? factoid.querySelector(mode.labelSelector)
            : null;

        if (valueByMode && labelByMode) {
            return { valueElement: valueByMode, labelElement: labelByMode };
        }

        const leaves = Array.prototype.slice
            .call(factoid.querySelectorAll('*'))
            .filter((element) => {
                const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
                return text && (!element.children || element.children.length === 0);
            });

        const labelElement =
            leaves.find((element) =>
                /(?:^|\s)(likes|gefällt|gefaellt)(?:\s|$)/i.test(
                    (element.textContent || '').replace(/\s+/g, ' ').trim()
                )
            ) || null;
        const valueElement =
            leaves.find((element) =>
                /\d/.test((element.textContent || '').replace(/\s+/g, ' ').trim())
            ) || null;

        return { valueElement, labelElement };
    }

    updateDescriptionDislikes() {
        const dislikeCount = Number(this.dislikes);
        if (!Number.isFinite(dislikeCount)) return;

        const panel = findDescriptionPanel();
        if (!panel) return;

        const mode = this.getDescriptionMode(panel) || {
            container: panel,
            factoidClass: '',
            valueSelector: '',
            labelSelector: ''
        };

        let dislikeElement = document.getElementById('ytaf-ryd-description-dislikes');
        if (dislikeElement && !mode.container.contains(dislikeElement)) {
            dislikeElement.remove();
            dislikeElement = null;
        }

        if (!dislikeElement) {
            const likesElement = this.findDescriptionLikesElement(panel, mode);

            if (!likesElement) return;

            dislikeElement = createDescriptionDislikeElement(mode);
            likesElement.insertAdjacentElement('afterend', dislikeElement);
            (mode.container || likesElement.parentElement)?.classList.add('ytaf-ryd-ready');
        }

        const { valueElement, labelElement } = this.getFactoidTextElements(
            dislikeElement,
            mode
        );
        const dislikeText = formatCount(dislikeCount);

        if (valueElement && valueElement.textContent !== dislikeText) {
            valueElement.textContent = dislikeText;
        } else if (!valueElement) {
            dislikeElement.textContent = `${dislikeText} Dislikes`;
        }

        if (labelElement && labelElement.textContent !== 'Dislikes') {
            labelElement.textContent = 'Dislikes';
        }

        dislikeElement.setAttribute('aria-label', `${dislikeText} Dislikes`);
    }

    destroy() {
        this.active = false;
        this.stopButtonProbe();
        if (this.dislikeButton && this.dislikeButtonActivateHandler) {
            this.dislikeButton.removeEventListener(
                'click',
                this.dislikeButtonActivateHandler,
                true
            );
            this.dislikeButton.removeEventListener(
                'keyup',
                this.dislikeButtonActivateHandler,
                true
            );
        }
        if (this.globalActivateHandler) {
            document.removeEventListener('keydown', this.globalActivateHandler, true);
            document.removeEventListener('click', this.globalActivateHandler, true);
            this.globalActivateHandler = null;
        }
        if (this.focusInHandler) {
            document.removeEventListener('focusin', this.focusInHandler, true);
            this.focusInHandler = null;
        }
        if (this.focusOutHandler) {
            document.removeEventListener('focusout', this.focusOutHandler, true);
            this.focusOutHandler = null;
        }
        if (this.dislikeButtonObserver) {
            this.dislikeButtonObserver.disconnect();
            this.dislikeButtonObserver = null;
        }
        if (this.descriptionObserver) {
            this.descriptionObserver.disconnect();
            this.descriptionObserver = null;
        }
        if (this.domObserverFrame) {
            cancelAnimationFrame(this.domObserverFrame);
            this.domObserverFrame = null;
        }
        if (this.pendingToggleTimer) {
            clearTimeout(this.pendingToggleTimer);
            this.pendingToggleTimer = null;
        }
        const descriptionDislikes = document.getElementById(
            'ytaf-ryd-description-dislikes'
        );
        if (descriptionDislikes && descriptionDislikes.parentElement) {
            descriptionDislikes.parentElement.removeChild(descriptionDislikes);
        }
        this.dislikeButton = null;
        this.dislikeButtonActivateHandler = null;
    }
}

function loadProbeForCurrentVideo() {
    const videoID = getVideoIDFromLocation();
    if (!videoID || !configRead('enableReturnYouTubeDislike')) return;

    if (
        window.returnYoutubeDislike &&
        window.returnYoutubeDislike.videoID === videoID
    ) {
        return;
    }

    if (window.returnYoutubeDislike) {
        window.returnYoutubeDislike.destroy();
    }

    window.returnYoutubeDislike = new ReturnYouTubeDislikeProbe();
    window.returnYoutubeDislike.init(videoID);
}

let initTimeout = null;

function scheduleLoadProbe() {
    if (initTimeout) {
        clearTimeout(initTimeout);
    }
    initTimeout = setTimeout(loadProbeForCurrentVideo, 100);
}

export function userScriptStartReturnYouTubeDislike() {
    window.returnYoutubeDislike = window.returnYoutubeDislike || null;
    window.addEventListener('hashchange', scheduleLoadProbe, false);

    if (document.readyState === 'loading') {
        window.addEventListener('load', () => setTimeout(scheduleLoadProbe, 500), {
            once: true
        });
    } else {
        setTimeout(scheduleLoadProbe, 500);
    }
}
