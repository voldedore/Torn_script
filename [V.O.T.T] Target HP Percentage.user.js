// ==UserScript==
// @name         [V.O.T.T] Target HP Percentage
// @namespace    http://tampermonkey.net/
// @version      2.0
// @updateURL    https://github.com/voldedore/Torn_script/raw/main/%5BV.O.T.T%5D%20Target%20HP%20Percentage.user.js
// @downloadURL  https://github.com/voldedore/Torn_script/raw/main/%5BV.O.T.T%5D%20Target%20HP%20Percentage.user.js
// @description  Add percentage in target HP for Bonus Weapon, this fixes the original work of DaoChauNghia[3029549] by Perplexity AI (Sonnet 4.6)
// @author       DaoChauNghia[3029549]
// @match        https://www.torn.com/page.php?sid=attack&user2ID=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const PERCENTAGE_ID = 'vott-hp-pct';

    // Tìm <span aria-live> chứa HP nằm trong entry có icon "Health"
    // Stable vì dựa vào: (1) aria-live attribute, (2) icon class có "iconHealth"
    function findHpSpan() {
        const entry = document.querySelectorAll('[class*="entry___"]')[5];
        if (!!entry) {
            const iconHealth = entry.querySelector('[class*="iconHealth"]');
            if (!!iconHealth) {
                const span = entry.querySelector('span[aria-live]');
                if (span) return span;
            }
        }
        return null;
    }

    // Parse "4,062 / 4,062" → { current, max } hoặc null nếu lỗi
    function parseHp(text) {
        const match = text.replace(/\s+/g, ' ').match(/([\d,]+)\s*\/\s*([\d,]+)/);
        if (!match) return null;
        const current = parseInt(match[1].replace(/,/g, ''), 10);
        const max     = parseInt(match[2].replace(/,/g, ''), 10);
        if (!Number.isFinite(current) || !Number.isFinite(max) || max === 0) return null;
        return { current, max };
    }

    // Gắn / update span phần trăm ngay sau content của hpSpan
    function updateDisplay(hpSpan) {
        const hp = parseHp(hpSpan.textContent);

        let pctSpan = document.getElementById(PERCENTAGE_ID);
        if (!pctSpan) {
            pctSpan = document.createElement('span');
            pctSpan.id = PERCENTAGE_ID;
            pctSpan.style.cssText = 'margin-left:4px;opacity:0.8;font-size:0.9em;';
            // Insert sau hpSpan, không append vào trong để không ảnh hưởng textContent
            hpSpan.insertAdjacentElement('afterend', pctSpan);
        }

        pctSpan.textContent = hp
            ? `(${(hp.current / hp.max * 100).toFixed(2)}%)`
            : '';
    }

    let hpObserver = null;

    // throttle bằng requestAnimationFrame
    let rafPending = false;

    function bindToHpSpan(hpSpan) {
        if (hpSpan._vottBound) return;
        hpSpan._vottBound = true;

        if (hpObserver) hpObserver.disconnect();

        hpObserver = new MutationObserver(() => {
            // Nếu đã có RAF đang chờ thì bỏ qua, không queue thêm
            if (rafPending) return;
            rafPending = true;

            requestAnimationFrame(() => {
                updateDisplay(hpSpan);
                rafPending = false;
            });
        });

        hpObserver.observe(hpSpan, {
            characterData: true,
            childList: true,
            subtree: true
        });

        updateDisplay(hpSpan);
    }

    // Quan sát document.body để phát hiện khi HP span xuất hiện hoặc bị replace
    const bodyObserver = new MutationObserver(() => {
        const hpSpan = findHpSpan();
        if (hpSpan && !hpSpan._vottBound) {
            bindToHpSpan(hpSpan);
        }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });

    // Thử tìm ngay lập tức nếu DOM đã sẵn sàng
    const immediate = findHpSpan();
    if (immediate) bindToHpSpan(immediate);

})();
