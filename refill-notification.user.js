// ==UserScript==
// @name         [omo] Refill Notification
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Notify user about daily refills with 3-color dot in status bar (energy, nerve, token). Uses Torn API. This inspired by the original Refill Notifier script by DaoChauNghia [3029549], but rewritten from scratch for better performance and maintainability.
// @author       Voldedore [3673166] & Perplexity (Claude Sonnet 4.6)
// @match        https://www.torn.com/*php*
// @exclude      https://www.torn.com/page.php?sid=attack&user2ID=*
// @exclude      https://www.torn.com/preferences*
// @run-at       document-end
// @updateURL    https://github.com/voldedore/Torn_script/raw/main/refill-notification.user.js
// @downloadURL  https://github.com/voldedore/Torn_script/raw/main/refill-notification.user.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==


(function () {
    'use strict';

    // #region Changelog:
    // v0.5 - 2026-06-21: Refactor, change script to run at document-end
    // v0.4 - 2026-06-20: Fix double API call on validate, fix PDA guard typo
    // v0.3 - 2026-06-20: Fix self-trigger mutation observer
    // v0.2 - 2026-06-20: Add PDA support
    // v0.1 - 2026-06-20: Initial release

    // #region PDA RELATED ──────────────────────────────────────────────────────────

    // if (window.REFILL_NOTIFICATION_INJECTED) return;
    // window.REFILL_NOTIFICATION_INJECTED = true;

    const PDA_API_KEY = '###PDA-APIKEY###';

    // #region Constants ────────────────────────────────────────────────────────────

    const CONFIG = {
        API_BASE: 'https://api.torn.com/user/',
        API_SELECTIONS: 'refills',
        API_COMMENT: 'RefillNotif',
        CACHE_KEY: 'refillData',
        CACHE_TTL_MS: 120_000,
        DEBOUNCE_MS: 300,
        DOT_SELECTOR: '[class*="status-icons___"]',
        DOT_ID: 'refill-notif-dot',
    };

    const COLORS = Object.freeze({
        ENERGY: '#00a500',
        NERVE: '#d83500',
        TOKEN: '#6503c6',
        NEUTRAL: '#888',
    });

    const REFILL_SEGMENTS = [
        { key: 'energy_refill_used', color: COLORS.ENERGY },
        { key: 'nerve_refill_used', color: COLORS.NERVE },
        { key: 'token_refill_used', color: COLORS.TOKEN },
    ];

    // #region Storage ──────────────────────────────────────────────────────────────

    const Storage = {
        getApiKey: () => GM_getValue('refillNotifApiKey', null),
        setApiKey: (v) => GM_setValue('refillNotifApiKey', v),

        getCache: () => {
            try { return JSON.parse(GM_getValue(CONFIG.CACHE_KEY, 'null')); }
            catch { return null; }
        },
        setCache: (data) => GM_setValue(CONFIG.CACHE_KEY, JSON.stringify({
            data, ts: Date.now(),
        })),
        isCacheFresh: () => {
            const c = Storage.getCache();
            return !!c && (Date.now() - c.ts) < CONFIG.CACHE_TTL_MS;
        },
        getCachedData: () => Storage.getCache()?.data ?? null,
    };

    // #region API ──────────────────────────────────────────────────────────────────

    const API = {
        async fetchRefills(apiKey) {
            const url = `${CONFIG.API_BASE}?selections=${CONFIG.API_SELECTIONS}&comment=${CONFIG.API_COMMENT}&key=${apiKey}`;
            const json = await fetch(url).then(r => r.json());
            if (json?.error) {
                const err = new Error(json.error.error ?? 'API error');
                err.code = json.error.code;
                throw err;
            }
            return json;
        },
    };

    // #region Auth ─────────────────────────────────────────────────────────────────

    const Auth = {
        promptApiKey() {
            // PDA injects key directly — no prompt needed
            if (PDA_API_KEY && !/^###.+###$/.test(PDA_API_KEY)) {
                Storage.setApiKey(PDA_API_KEY);
                return PDA_API_KEY;
            }
            const key = prompt('[Refill Notifier] Enter your Torn API key (Cancel to skip):');
            if (key?.trim()) {
                Storage.setApiKey(key.trim());
                return key.trim();
            }
            alert('[Refill Notifier] No API key provided. Script will not run.');
            return null;
        },

        isInvalidKeyError: (err) =>
            err.code === 2 || err.code === 16 ||
            /incorrect key|access level/i.test(err.message),
    };

    // #region UI ───────────────────────────────────────────────────────────────────

    const UI = {
        buildGradient(refills) {
            const active = REFILL_SEGMENTS.filter(s => !refills[s.key]);
            if (active.length === 0) return COLORS.NEUTRAL;
            if (active.length === 1) return active[0].color;
            const stops = active.length === 2
                ? [[0, 180], [180, 360]]
                : [[0, 120], [120, 240], [240, 360]];
            return `conic-gradient(${active.map((s, i) =>
                `${s.color} ${stops[i][0]}deg ${stops[i][1]}deg`).join(', ')})`;
        },

        buildTooltip(refills) {
            return REFILL_SEGMENTS.map(s => {
                const label = s.key.replace('_refill_used', '').toUpperCase();
                return `${label}: ${refills[s.key] ? 'Used' : 'Available'}`;
            }).join(' | ');
        },

        createDot(data) {
            const dot = document.createElement('a');
            dot.id = CONFIG.DOT_ID;
            Object.assign(dot.style, {
                width: '15px', height: '15px',
                borderRadius: '50%',
                marginRight: '5px',
                display: 'inline-block',
                border: '1px solid #acacac',
                background: UI.buildGradient(data.refills),
                cursor: 'default',
                flexShrink: '0',
            });
            dot.title = UI.buildTooltip(data.refills);
            return dot;
        },

        inject(data) {
            document.getElementById(CONFIG.DOT_ID)?.remove();
            const bar = document.querySelector(CONFIG.DOT_SELECTOR);
            if (!bar) return false;
            const li = document.createElement('li');
            li.style.background = 'none';
            li.appendChild(UI.createDot(data));
            bar.prepend(li);
            return true;
        },

        isPresent: () => !!document.getElementById(CONFIG.DOT_ID),
    };

    // #region Phase 1: Data ────────────────────────────────────────────────────────

    async function resolveData() {
        let apiKey = Storage.getApiKey();

        if (!apiKey) {
            apiKey = Auth.promptApiKey();
            if (!apiKey) return null;
        }

        if (Storage.isCacheFresh()) {
            return Storage.getCachedData();
        }

        try {
            console.debug('refNot_cacheMiss');
            const data = await API.fetchRefills(apiKey);
            Storage.setCache(data);
            return data;
        } catch (err) {
            if (Auth.isInvalidKeyError(err)) {
                alert(`[Refill Notifier] Invalid API key: ${err.message}`);
                Storage.setApiKey(null);
                apiKey = Auth.promptApiKey();
                if (!apiKey) return null;
                try {
                    const data = await API.fetchRefills(apiKey);
                    Storage.setCache(data);
                    return data;
                } catch (retryErr) {
                    console.error('[Refill Notifier] Fetch failed after re-auth:', retryErr);
                    return null;
                }
            }
            console.warn('[Refill Notifier] Fetch failed, falling back to stale cache:', err);
            return Storage.getCachedData();
        }
    }

    // #region Phase 2: UI ──────────────────────────────────────────────────────────

    async function startUI() {
        let observer = null;

        async function onMutation() {
            if (!document.querySelector(CONFIG.DOT_SELECTOR)) return;
            if (UI.isPresent()) return;
            const data = await resolveData();
            UI.inject(data);
        }

        observer = new MutationObserver(onMutation);
        observer.observe(document.body, { childList: false, subtree: false, attributes: true });
    }

    // #region Bootstrap ────────────────────────────────────────────────────────────

    async function main() {
        await startUI();
    }

    main().catch(err => console.error('[Refill Notifier] Fatal error:', err));

})();