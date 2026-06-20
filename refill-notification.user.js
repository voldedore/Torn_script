// ==UserScript==
// @name         [omo] Refill Notification
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Notify user about daily refills with dots under user points
// @author       Voldedore [3673166]
// @match        https://www.torn.com/*php*
// @exclude      https://www.torn.com/page.php?sid=attack&user2ID=*
// @exclude      https://www.torn.com/preferences*
// @run-at       document-start
// @updateURL    https://github.com/voldedore/Torn_script/raw/main/refill-notification.user.js
// @downloadURL  https://github.com/voldedore/Torn_script/raw/main/refill-notification.user.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    // ─── PDA RELATED ─────────────────────────────────
    // Avoid duplicate injection in TornPDA
    if (window.REFILL_NOITIFICATION_INJECTED) {
        return;
    }
    window.REFILL_NOTIFICATION_INJECTED = true;

    const PDA_API_KEY = '###PDA-APIKEY###';
    function isPDA() {
        const PDATestRegex = !/^(###).+(###)$/.test(PDA_API_KEY);

        return PDATestRegex;
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    const CONFIG = {
        API_BASE: 'https://api.torn.com/user/',
        API_SELECTIONS: 'refills',
        API_COMMENT: 'RefillNotif',
        CACHE_KEY: 'refillData',
        CACHE_TTL_MS: 120_000,           // 2 minute cache
        DEBOUNCE_MS: 500,
        DOT_SELECTOR: '[class*="status-icons___"]',
        DOT_ID: 'refill-notif-dot',
    };

    const COLORS = Object.freeze({
        ENERGY: '#00a500',
        NERVE:  '#d83500',
        TOKEN:  '#6503c6',
        NEUTRAL: '#888',
    });

    const REFILL_SEGMENTS = [
        { key: 'energy_refill_used', color: COLORS.ENERGY },
        { key: 'nerve_refill_used',  color: COLORS.NERVE  },
        { key: 'token_refill_used',  color: COLORS.TOKEN  },
    ];

    // ─── State ────────────────────────────────────────────────────────────────

    let _observer = null;
    let _debounceTimer = null;
    let _isInjected = false;

    // ─── Storage helpers (always use GM storage for userscript isolation) ─────

    const Storage = {
        getApiKey: () => GM_getValue('apiKey', null),
        setApiKey: (v) => GM_setValue('apiKey', v),
        getCache:  () => {
            try {
                return JSON.parse(GM_getValue(CONFIG.CACHE_KEY, 'null'));
            } catch { return null; }
        },
        setCache:  (data) => GM_setValue(CONFIG.CACHE_KEY, JSON.stringify({
            data,
            ts: Date.now(),
        })),
        isCacheFresh: () => {
            const cache = Storage.getCache();
            return cache && (Date.now() - cache.ts) < CONFIG.CACHE_TTL_MS;
        },
        getCachedData: () => Storage.getCache()?.data ?? null,
    };

    // ─── API ──────────────────────────────────────────────────────────────────

    const API = {
        /** Fetch refill data. Throws on network error or API error code. */
        async fetchRefills(apiKey) {
            const url = `${CONFIG.API_BASE}?selections=${CONFIG.API_SELECTIONS}&comment=${CONFIG.API_COMMENT}&key=${apiKey}`;
            const res = await fetch(url);
            const json = await res.json();

            if (json?.error) {
                const err = new Error(json.error.error ?? 'API error');
                err.code = json.error.code;
                throw err;
            }
            return json;
        },

        /** Returns cached data if fresh, otherwise fetches and caches. */
        async getRefillsCached(apiKey) {
            if (Storage.isCacheFresh()) return Storage.getCachedData();
            const data = await API.fetchRefills(apiKey);
            Storage.setCache(data);
            return data;
        },
    };

    // ─── Auth ─────────────────────────────────────────────────────────────────

    const Auth = {
        /** Prompt user for API key. Returns true if key was saved. */
        promptApiKey() {
            if (isPDA()) {
                Storage.setApiKey(PDA_API_KEY);
                return true;
            }

            const key = prompt('Please enter your Torn API key (or Cancel to skip):');
            if (key?.trim()) {
                Storage.setApiKey(key.trim());
                return true;
            }
            alert('[Refill Notifier] No API key provided. Script will not run.');
            Storage.setApiKey(null);
            return false;
        },

        /**
         * Validate the stored API key with a live request.
         * Returns true if valid, false if invalid (prompts re-entry),
         * throws on unrecoverable errors.
         */
        async validate(apiKey) {
            try {
                await API.fetchRefills(apiKey);
                return true;
            } catch (err) {
                // Error codes 2 and 16 = invalid/expired key
                if (err.code === 2 || err.code === 16 ||
                    /incorrect key|access level/i.test(err.message)) {
                    alert(`[Refill Notifier] Invalid API key: ${err.message}`);
                    Storage.setApiKey(null);
                    return false;
                }
                throw err; // network errors etc. — let caller handle
            }
        },
    };

    // ─── UI ───────────────────────────────────────────────────────────────────

    const UI = {
        /** Build conic-gradient from unused refill segments. */
        buildGradient(refills) {
            const active = REFILL_SEGMENTS.filter(s => !refills[s.key]);

            if (active.length === 0) return COLORS.NEUTRAL;
            if (active.length === 1) return active[0].color;

            const stops = active.length === 2
                ? [[0, 180], [180, 360]]
                : [[0, 120], [120, 240], [240, 360]];

            const parts = active.map((s, i) =>
                `${s.color} ${stops[i][0]}deg ${stops[i][1]}deg`
            ).join(',\n');

            return `conic-gradient(${parts})`;
        },

        /** Create the status dot element. */
        createDot(data) {
            const dot = document.createElement('a');
            dot.id = CONFIG.DOT_ID;
            Object.assign(dot.style, {
                width:        '15px',
                height:       '15px',
                borderRadius: '50%',
                marginRight:  '5px',
                display:      'inline-block',
                border:       '1px solid #acacac',
                background:   UI.buildGradient(data.refills),
                cursor:       'default',
                flexShrink:   '0',
            });
            dot.title = UI.buildTooltip(data.refills);
            return dot;
        },

        /** Human-readable tooltip. */
        buildTooltip(refills) {
            const lines = REFILL_SEGMENTS.map(s => {
                const label = s.key.replace('_refill_used', '').toUpperCase();
                return `${label}: ${refills[s.key] ? 'Used' : 'Available'}`;
            });
            return lines.join(' | ');
        },

        /** Inject dot into the status bar. Idempotent. */
        inject(data) {
            // Remove stale dot first (e.g. after SPA navigation rebuilt the DOM)
            document.getElementById(CONFIG.DOT_ID)?.remove();

            const bar = document.querySelector(CONFIG.DOT_SELECTOR);
            if (!bar) return false;

            const li = document.createElement('li');
            li.style.background = 'none';
            li.appendChild(UI.createDot(data));
            bar.prepend(li);

            _isInjected = true;
            return true;
        },

        /** Returns true if the dot is currently in the live DOM. */
        isPresent: () => !!document.getElementById(CONFIG.DOT_ID),
    };

    // ─── SPA Observer ─────────────────────────────────────────────────────────

    /**
     * Torn City is a SPA — the status bar gets recreated on route changes.
     * We watch DOM mutations and re-inject when the dot disappears.
     */
    function startObserver(data) {
        if (_observer) _observer.disconnect();

        _observer = new MutationObserver(() => {
            if (UI.isPresent()) return;           // still there, nothing to do

            // Debounce to avoid re-injecting mid-animation
            clearTimeout(_debounceTimer);
            _debounceTimer = setTimeout(() => {
                _isInjected = false;
                UI.inject(data);
            }, CONFIG.DEBOUNCE_MS);
        });

        _observer.observe(document.body, { childList: true, subtree: true });
    }

    // ─── Bootstrap ────────────────────────────────────────────────────────────

    async function main() {
        let apiKey = Storage.getApiKey();

        // First run: no key stored
        if (!apiKey) {
            const saved = Auth.promptApiKey();
            if (!saved) return;
            apiKey = Storage.getApiKey();
        }

        // Validate key (only if cache is stale — avoids wasteful double-request)
        if (!Storage.isCacheFresh()) {
            const valid = await Auth.validate(apiKey);
            if (!valid) {
                // Key was bad, prompt once more
                const saved = Auth.promptApiKey();
                if (!saved) return;
                apiKey = Storage.getApiKey();
            }
        }

        // Fetch data (uses cache when fresh)
        let data;
        try {
            data = await API.getRefillsCached(apiKey);
        } catch (err) {
            console.error('[Refill Notifier] Fetch failed:', err);
            return;
        }

        // Initial inject
        UI.inject(data);

        // Keep dot alive across SPA navigations
        startObserver(data);

        // Refresh data every TTL (re-injects with updated gradient)
        setInterval(async () => {
            try {
                const fresh = await API.fetchRefills(Storage.getApiKey());
                Storage.setCache(fresh);
                data = fresh;
                UI.inject(fresh);
            } catch (err) {
                console.warn('[Refill Notifier] Background refresh failed:', err);
            }
        }, CONFIG.CACHE_TTL_MS);
    }

    main().catch(err => console.error('[Refill Notifier] Fatal error:', err));

})();
