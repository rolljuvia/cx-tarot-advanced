/**
 * cx-plugin.js — 传讯定制插件
 * 基于 aielin17/milk 原版，集中所有改动
 *
 * 功能：
 * 1. 跳过声明页
 * 2. 消息 emoji 点赞（操作栏内）
 * 3. 回信附带 3 张塔罗牌
 * 4. 消息搜索按钮（操作栏内）→ 快速查询牌义
 */

(function () {
    'use strict';

    const STORAGE_PREFIX = 'cx_';

    const SPREAD_POSITIONS = [
        '你与他的链接状态',
        '他看到信时的感受',
        '他想传达给你的话'
    ];

    const REACTION_EMOJIS = [
        '❤️','💕','✨','🌙','❓',
        '😘','😊','😂','🥺','🤗',
        '💌','👏','🧸','🌸','🍰'
    ];

    const AUTO_REACTION_PROB = 0.35;

    /* ═══════════════════════════════════════════
     *  1. 跳过声明页
     * ═══════════════════════════════════════════ */

    function skipSplash() {
        localStorage.setItem('splashPledgeSigned_v3', 'true');
        const splash = document.getElementById('splash-declaration');
        if (splash) splash.style.display = 'none';
    }

    /* ═══════════════════════════════════════════
     *  2. CSS
     * ═══════════════════════════════════════════ */

    function injectPluginCSS() {
        if (document.getElementById('cx-plugin-css')) return;
        const style = document.createElement('style');
        style.id = 'cx-plugin-css';
        style.textContent = `
            /* 操作栏往上移，避免误触消息气泡 */
            .message-meta-actions {
                top: -32px !important;
            }
            /* 对方消息：操作栏靠左对齐，防止左边溢出屏幕 */
            .message-wrapper.received .message-meta-actions {
                right: auto !important;
                left: 0 !important;
            }
            /* 防止操作栏被裁切 */
            .message-content-wrapper,
            .message-wrapper,
            .message {
                overflow: visible !important;
            }

            /* emoji 选择浮层 */
            .cx-emoji-picker {
                display: none;
                position: absolute;
                bottom: calc(100% + 4px);
                left: 50%;
                transform: translateX(-50%);
                background: var(--secondary-bg);
                border: 1px solid var(--border-color);
                border-radius: 14px;
                padding: 8px;
                z-index: 1000;
                box-shadow: 0 4px 20px rgba(0,0,0,0.18);
                animation: cxPop 0.2s cubic-bezier(0.34,1.56,0.64,1);
                grid-template-columns: repeat(5, 1fr);
                gap: 2px;
                width: max-content;
            }
            .cx-emoji-picker.show { display: grid; }
            @keyframes cxPop {
                from { opacity:0; transform:translateX(-50%) scale(0.7); }
                to { opacity:1; transform:translateX(-50%) scale(1); }
            }
            .cx-emoji-picker button {
                border: none; background: none; font-size: 18px;
                cursor: pointer; padding: 4px; border-radius: 8px;
                transition: transform 0.12s, background 0.12s; line-height: 1;
                text-align: center;
            }
            .cx-emoji-picker button:hover,
            .cx-emoji-picker button:active {
                transform: scale(1.2);
                background: rgba(var(--accent-color-rgb), 0.1);
            }

            /* reaction badge */
            .cx-reaction-container {
                display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px;
            }
            .cx-reaction-badge {
                display: inline-flex; align-items: center; gap: 2px;
                font-size: 15px; padding: 1px 5px; border-radius: 12px;
                background: var(--primary-bg); border: 1px solid var(--border-color);
                cursor: pointer; transition: transform 0.12s; line-height: 1.2;
            }
            .cx-reaction-badge:hover { transform: scale(1.12); }
            .cx-reaction-badge .cx-count { font-size: 10px; color: var(--text-secondary); }

            /* 牌义弹窗 */
            .cx-card-overlay {
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.5);
                z-index: 9000;
                display: flex; align-items: center; justify-content: center;
                animation: cxFadeIn 0.2s ease;
                padding: 20px;
            }
            @keyframes cxFadeIn { from{opacity:0} to{opacity:1} }
            .cx-card-modal {
                background: var(--secondary-bg);
                border-radius: 20px;
                max-width: 340px; width: 100%;
                overflow: hidden;
                box-shadow: 0 16px 48px rgba(0,0,0,0.25);
                animation: cxSlideUp 0.3s cubic-bezier(0.22,1,0.36,1);
                max-height: 85vh;
                overflow-y: auto;
            }
            @keyframes cxSlideUp { from{opacity:0;transform:translateY(20px) scale(0.95)} to{opacity:1;transform:translateY(0) scale(1)} }
            .cx-card-header {
                background: var(--accent-color);
                padding: 16px 20px; color: #fff; position: relative;
            }
            .cx-card-body { padding: 18px 20px; }
            .cx-card-close {
                position: absolute; top: 8px; right: 8px;
                background: rgba(255,255,255,0.25); border: none; color: #fff;
                width: 44px; height: 44px; border-radius: 50%;
                font-size: 20px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                -webkit-tap-highlight-color: transparent;
                z-index: 10;
            }
            .cx-card-close:hover, .cx-card-close:active { background: rgba(255,255,255,0.4); }
        `;
        document.head.appendChild(style);
    }

    /* ═══════════════════════════════════════════
     *  3. Emoji 点赞
     * ═══════════════════════════════════════════ */

    function loadReactions() {
        try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'reactions') || '{}'); }
        catch { return {}; }
    }
    function saveReactions(data) {
        localStorage.setItem(STORAGE_PREFIX + 'reactions', JSON.stringify(data));
    }

    function enhanceActionBars() {
        const container = document.getElementById('chat-container');
        if (!container) return;

        container.querySelectorAll('.message-wrapper').forEach(wrapper => {
            if (wrapper.dataset.cxEnhanced) return;

            const actionsDiv = wrapper.querySelector('.message-meta-actions');
            if (!actionsDiv) return;

            wrapper.dataset.cxEnhanced = '1';
            const msgId = wrapper.dataset.msgId || wrapper.dataset.id;

            // 点赞按钮
            const emojiBtn = document.createElement('button');
            emojiBtn.className = 'meta-action-btn cx-react-btn';
            emojiBtn.title = '点赞';
            emojiBtn.innerHTML = '<i class="far fa-smile"></i>';
            emojiBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleEmojiPicker(wrapper, msgId);
            });

            // 搜索按钮
            const searchBtn = document.createElement('button');
            searchBtn.className = 'meta-action-btn cx-search-btn';
            searchBtn.title = '查询牌义';
            searchBtn.innerHTML = '<i class="fas fa-search"></i>';
            searchBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const msgEl = wrapper.querySelector('.message');
                if (!msgEl) return;
                // 跳过引用部分，取消息本体的文字
                const divs = msgEl.querySelectorAll(':scope > div:not(.reply-indicator)');
                const textDiv = divs.length > 0 ? divs[0] : null;
                if (textDiv) searchCardMeaning(textDiv.textContent || '');
            });

            const deleteBtn = actionsDiv.querySelector('.delete-btn');
            if (deleteBtn) {
                actionsDiv.insertBefore(emojiBtn, deleteBtn);
                actionsDiv.insertBefore(searchBtn, deleteBtn);
            } else {
                actionsDiv.appendChild(emojiBtn);
                actionsDiv.appendChild(searchBtn);
            }

            renderReactionBadge(msgId, wrapper);
        });
    }

    function toggleEmojiPicker(wrapper, msgId) {
        document.querySelectorAll('.cx-emoji-picker.show').forEach(el => el.classList.remove('show'));

        const actionsDiv = wrapper.querySelector('.message-meta-actions');
        if (!actionsDiv) return;

        let picker = actionsDiv.querySelector('.cx-emoji-picker');
        if (!picker) {
            picker = document.createElement('div');
            picker.className = 'cx-emoji-picker';
            picker.innerHTML = REACTION_EMOJIS.map(em =>
                `<button data-em="${em}">${em}</button>`
            ).join('');
            actionsDiv.style.position = 'relative';
            actionsDiv.appendChild(picker);

            picker.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-em]');
                if (!btn) return;
                e.stopPropagation();
                applyReaction(msgId, wrapper, btn.dataset.em);
                picker.classList.remove('show');
            });
        }
        picker.classList.toggle('show');
    }

    document.addEventListener('click', () => {
        document.querySelectorAll('.cx-emoji-picker.show').forEach(el => el.classList.remove('show'));
    });

    function applyReaction(msgId, wrapper, emoji) {
        // 只能给对方的消息点赞
        if (wrapper.classList.contains('sent')) return;

        const reactions = loadReactions();
        if (!reactions[msgId]) reactions[msgId] = {};

        if (reactions[msgId].user === emoji) {
            delete reactions[msgId].user;
            if (!reactions[msgId].partner) delete reactions[msgId];
        } else {
            reactions[msgId].user = emoji;
            // 对方有概率给你的消息回赞（找一条你的消息）
            if (Math.random() < AUTO_REACTION_PROB) {
                const capturedWrapper = wrapper;
                setTimeout(() => {
                    const allSent = document.querySelectorAll('.message-wrapper.sent');
                    if (allSent.length === 0) return;
                    const randomSent = allSent[Math.floor(Math.random() * allSent.length)];
                    const sentId = randomSent.dataset.msgId || randomSent.dataset.id;
                    if (!sentId) return;
                    const latest = loadReactions();
                    if (!latest[sentId]) latest[sentId] = {};
                    if (!latest[sentId].partner) {
                        latest[sentId].partner = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
                        saveReactions(latest);
                        renderReactionBadge(sentId, randomSent);
                    }
                }, 800 + Math.random() * 2000);
            }
        }

        saveReactions(reactions);
        renderReactionBadge(msgId, wrapper);
    }

    function renderReactionBadge(msgId, wrapper) {
        const reactions = loadReactions();
        const data = reactions[msgId];
        const contentWrapper = wrapper.querySelector('.message-content-wrapper');
        if (!contentWrapper) return;

        let container = contentWrapper.querySelector('.cx-reaction-container');
        if (container) container.remove();

        if (!data || (!data.user && !data.partner)) return;

        container = document.createElement('div');
        container.className = 'cx-reaction-container';

        const isSame = data.user && data.partner && data.user === data.partner;

        if (isSame) {
            const badge = document.createElement('span');
            badge.className = 'cx-reaction-badge';
            badge.innerHTML = `${data.user}<span class="cx-count">2</span>`;
            badge.title = '你和对方都点了';
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const r = loadReactions();
                if (r[msgId]) { delete r[msgId].user; saveReactions(r); }
                renderReactionBadge(msgId, wrapper);
            });
            container.appendChild(badge);
        } else {
            if (data.user) {
                const badge = document.createElement('span');
                badge.className = 'cx-reaction-badge';
                badge.textContent = data.user;
                badge.title = '你的点赞（点击取消）';
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const r = loadReactions();
                    if (r[msgId]) { delete r[msgId].user; if (!r[msgId].partner) delete r[msgId]; saveReactions(r); }
                    renderReactionBadge(msgId, wrapper);
                });
                container.appendChild(badge);
            }
            if (data.partner) {
                const badge = document.createElement('span');
                badge.className = 'cx-reaction-badge';
                badge.textContent = data.partner;
                badge.title = '对方的点赞';
                container.appendChild(badge);
            }
        }

        const meta = contentWrapper.querySelector('.message-meta');
        if (meta) contentWrapper.insertBefore(container, meta);
        else contentWrapper.appendChild(container);
    }

    function renderAllReactions() {
        const reactions = loadReactions();
        const container = document.getElementById('chat-container');
        if (!container) return;
        container.querySelectorAll('.message-wrapper').forEach(wrapper => {
            const msgId = wrapper.dataset.msgId || wrapper.dataset.id;
            if (msgId && reactions[msgId]) renderReactionBadge(msgId, wrapper);
        });
    }

    /* ═══════════════════════════════════════════
     *  4. 回信 3 张塔罗牌
     * ═══════════════════════════════════════════ */

    function drawThreeCards() {
        if (typeof ALL_78_TAROT_CARDS === 'undefined') return null;
        const deck = [...ALL_78_TAROT_CARDS].sort(() => Math.random() - 0.5);
        return deck.slice(0, 3).map(card => ({
            ...card, isUpright: Math.random() > 0.4
        }));
    }

    function patchEnvelopeForTarot() {
        const origCheck = window.checkEnvelopeStatus;
        if (!origCheck) return;

        // 覆盖回信文本生成：优先从"回信"分组抽取
        window.generateEnvelopeReplyText = function () {
            let pool = [];
            if (window.customReplyGroups && window.customReplyGroups.length > 0) {
                const letterGroup = window.customReplyGroups.find(g =>
                    g.name === '回信' && g.items && g.items.length > 0
                );
                if (letterGroup) pool = [...letterGroup.items];
            }
            if (pool.length === 0 && typeof customReplies !== 'undefined') {
                pool = [...customReplies];
            }
            if (pool.length === 0) return '…';
            const sentenceCount = Math.floor(Math.random() * 3) + 1;
            let reply = '';
            for (let i = 0; i < sentenceCount; i++) {
                const sentence = pool[Math.floor(Math.random() * pool.length)];
                const punct = Math.random() < 0.2 ? '！' : (Math.random() < 0.2 ? '...' : '。');
                reply += sentence + punct;
            }
            return reply;
        };

        window.checkEnvelopeStatus = async function () {
            if (typeof loadEnvelopeData === 'function') await loadEnvelopeData();
            if (typeof envelopeData === 'undefined') return;
            const now = Date.now();
            let changed = false;
            let newReplyLetter = null;

            envelopeData.outbox.forEach(letter => {
                if (letter.status === 'pending' && now >= letter.replyTime) {
                    letter.status = 'replied';
                    const replyContent = typeof generateEnvelopeReplyText === 'function'
                        ? generateEnvelopeReplyText() : '…';
                    const replyId = 'reply_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                    const inboxLetter = {
                        id: replyId, refId: letter.id,
                        originalContent: letter.content,
                        content: replyContent,
                        receivedTime: Date.now(), isNew: true,
                        cxTarotCards: drawThreeCards()
                    };
                    envelopeData.inbox.push(inboxLetter);
                    newReplyLetter = inboxLetter;
                    changed = true;
                    if (typeof playSound === 'function') playSound('message');
                }
            });
            if (changed) {
                if (typeof saveEnvelopeData === 'function') saveEnvelopeData();
                if (newReplyLetter && typeof showEnvelopeReplyPopup === 'function')
                    showEnvelopeReplyPopup(newReplyLetter);
            }
        };
    }

    function patchViewEnvLetter() {
        const origView = window.viewEnvLetter;
        if (!origView) return;
        window.viewEnvLetter = function (section, id) {
            origView.call(window, section, id);
            if (section !== 'inbox') { removeTarotSection(); return; }
            const letter = envelopeData.inbox.find(l => l.id === id);
            if (!letter) return;
            if (!letter.cxTarotCards) {
                letter.cxTarotCards = drawThreeCards();
                if (typeof saveEnvelopeData === 'function') saveEnvelopeData();
            }
            if (letter.cxTarotCards) injectTarotSection(letter.cxTarotCards);
        };
    }

    function removeTarotSection() {
        const el = document.getElementById('cx-tarot-section');
        if (el) el.remove();
    }

    function injectTarotSection(cards) {
        removeTarotSection();
        if (!cards || cards.length < 3) return;
        const signName = document.getElementById('env-view-sign-name');
        if (!signName) return;
        const parent = signName.closest('[style*="position:relative"]') || signName.parentElement;

        const section = document.createElement('div');
        section.id = 'cx-tarot-section';
        section.style.cssText = 'margin-top:20px; padding-top:16px; border-top:1px dashed rgba(var(--accent-color-rgb),0.25);';

        const title = document.createElement('div');
        title.style.cssText = 'text-align:center; font-size:12px; color:var(--accent-color); letter-spacing:2px; margin-bottom:14px; opacity:0.85;';
        title.innerHTML = '✦ 塔罗讯息 ✦';
        section.appendChild(title);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:flex; gap:8px; justify-content:center; flex-wrap:wrap;';

        cards.forEach((card, i) => {
            const pos = SPREAD_POSITIONS[i];
            const isUpright = card.isUpright;
            const orientation = isUpright ? '正位' : '逆位';
            const meaning = isUpright ? card.upright : card.reversed;

            const cardEl = document.createElement('div');
            cardEl.style.cssText = 'flex:1; min-width:95px; max-width:130px; text-align:center;';

            const flipContainer = document.createElement('div');
            flipContainer.className = 'tarot-container-3d tarot-responsive';
            flipContainer.style.cssText = 'cursor:pointer; margin-bottom:6px; aspect-ratio:2/3; max-height:160px;';
            flipContainer.innerHTML = `
                <div class="tarot-card-inner">
                    <div class="tarot-face tarot-front">
                        <div class="tarot-pattern" style="font-size:16px;"><i class="fas fa-star-and-crescent"></i></div>
                    </div>
                    <div class="tarot-face tarot-back" style="background:linear-gradient(135deg,var(--secondary-bg),rgba(var(--accent-color-rgb),0.07)); border:1.5px solid rgba(var(--accent-color-rgb),0.3); padding:6px; display:flex; flex-direction:column; align-items:center; justify-content:center; overflow-y:auto;">
                        ${card.img ? `<div class="tarot-visual ${isUpright ? '' : 'reversed'}" style="height:80px; flex-shrink:0; margin-bottom:4px;"><img src="${card.img}" style="height:100%; object-fit:contain; border-radius:4px;" onerror="this.parentElement.innerHTML='<i class=\\'fas ${card.icon || 'fa-star'} tarot-icon-vector\\' style=\\'font-size:32px; color:var(--accent-color);\\'></i>';"></div>` : `<div class="tarot-visual ${isUpright ? '' : 'reversed'}" style="height:80px; flex-shrink:0;"><i class="fas ${card.icon || 'fa-star'} tarot-icon-vector" style="font-size:32px; color:var(--accent-color);"></i></div>`}
                        <div style="font-size:12px; font-weight:700; color:var(--text-primary); margin-bottom:2px;">${card.name}</div>
                        <div style="font-size:9px; color:var(--accent-color); margin-bottom:2px;">${orientation} · ${card.keyword || ''}</div>
                    </div>
                </div>`;

            const interpEl = document.createElement('div');
            interpEl.style.cssText = 'font-size:10px; color:var(--text-secondary); line-height:1.5; margin-top:4px; display:none; max-height:80px; overflow-y:auto;';
            interpEl.textContent = meaning || '';

            flipContainer.addEventListener('click', function () {
                this.classList.toggle('flipped');
                interpEl.style.display = this.classList.contains('flipped') ? 'block' : 'none';
            });

            const posLabel = document.createElement('div');
            posLabel.style.cssText = 'font-size:10px; color:var(--text-secondary); margin-bottom:4px; letter-spacing:0.5px;';
            posLabel.textContent = pos;

            cardEl.appendChild(posLabel);
            cardEl.appendChild(flipContainer);
            cardEl.appendChild(interpEl);
            grid.appendChild(cardEl);
        });

        section.appendChild(grid);
        const hint = document.createElement('div');
        hint.style.cssText = 'text-align:center; font-size:10px; color:var(--text-secondary); margin-top:10px; opacity:0.6;';
        hint.textContent = '点击牌背翻开查看';
        section.appendChild(hint);
        parent.appendChild(section);
    }

    /* ═══════════════════════════════════════════
     *  5. 搜索牌义
     * ═══════════════════════════════════════════ */

    const NUM_MAP = {
        'ace': '一', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五',
        '6': '六', '7': '七', '8': '八', '9': '九', '10': '十'
    };
    const TITLE_MAP = { '女皇': ['女帝', '女王'], '侍从': ['侍者'] };
    const ROMAN_MAP = {
        '0': '愚人', 'I': '魔术师', 'II': '女祭司', 'III': '女皇',
        'IV': '皇帝', 'V': '教皇', 'VI': '恋人', 'VII': '战车',
        'VIII': '力量', 'IX': '隐士', 'X': '命运之轮', 'XI': '正义',
        'XII': '倒吊人', 'XIII': '死神', 'XIV': '节制', 'XV': '恶魔',
        'XVI': '高塔', 'XVII': '星星', 'XVIII': '月亮', 'XIX': '太阳',
        'XX': '审判', 'XXI': '世界', 'XXII': '空白牌', 'XXIII': '空白牌'
    };
    const LENORMAND_NAME_MAP = {
        '幸运草': '四叶草', '船': '帆船', '房子': '房屋', '树': '大树',
        '云': '乌云', '鸟': '鸟儿', '小孩': '孩童', '戒指': '指环',
        '信': '信件', '男人': '男士', '女人': '女士', '百合花': '百合',
        '道路': '十字路口', '山': '山丘'
    };

    function matchCardFromText(text) {
        if (!text) return null;
        const clean = text.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[\u200d\ufe0f]/gu, '').trim();
        if (!clean) return null;

        // 雷诺曼
        const lenMatch = clean.match(/^(\d{1,2})\.\s*(.+)$/);
        if (lenMatch && typeof LENORMAND_CARDS_40 !== 'undefined') {
            const card = LENORMAND_CARDS_40.find(c => c.num === parseInt(lenMatch[1]));
            if (card) return { type: 'lenormand', card };
        }
        if (typeof LENORMAND_CARDS_40 !== 'undefined') {
            const direct = LENORMAND_CARDS_40.find(c => clean === c.name);
            if (direct) return { type: 'lenormand', card: direct };
            const mapped = LENORMAND_NAME_MAP[clean];
            if (mapped) {
                const mc = LENORMAND_CARDS_40.find(c => c.name === mapped);
                if (mc) return { type: 'lenormand', card: mc };
            }
        }

        // 塔罗
        if (typeof ALL_78_TAROT_CARDS === 'undefined') return null;
        let orientation = null;
        let cardText = clean;
        if (clean.endsWith('正位')) { orientation = 'upright'; cardText = clean.slice(0, -2); }
        else if (clean.endsWith('逆位')) { orientation = 'reversed'; cardText = clean.slice(0, -2); }

        let majorName = null;
        const romanSuffix = cardText.match(/([IVXL]+|\d+)$/);
        if (romanSuffix) {
            const nameWithout = cardText.slice(0, -romanSuffix[0].length);
            if (ALL_78_TAROT_CARDS.find(c => c.type === 'major' && c.name === nameWithout)) majorName = nameWithout;
            if (!majorName && ROMAN_MAP[romanSuffix[0]] === nameWithout) majorName = nameWithout;
        }

        let found = ALL_78_TAROT_CARDS.find(c => c.name === cardText);
        if (!found && majorName) found = ALL_78_TAROT_CARDS.find(c => c.name === majorName);

        if (!found) {
            const suits = ['圣杯', '权杖', '宝剑', '星币'];
            const suitTypes = { '圣杯': 'cups', '权杖': 'wands', '宝剑': 'swords', '星币': 'pentacles' };
            for (const suit of suits) {
                if (!cardText.startsWith(suit)) continue;
                const rest = cardText.slice(suit.length);
                if (!rest) continue;
                const suitType = suitTypes[suit];
                const lower = rest.toLowerCase();
                if (NUM_MAP[lower]) {
                    found = ALL_78_TAROT_CARDS.find(c => c.type === suitType && c.name === suit + NUM_MAP[lower]);
                    if (found) break;
                }
                found = ALL_78_TAROT_CARDS.find(c => c.type === suitType && c.name === suit + rest);
                if (found) break;
                if (TITLE_MAP[rest]) {
                    for (const alt of TITLE_MAP[rest]) {
                        found = ALL_78_TAROT_CARDS.find(c => c.type === suitType && c.name === suit + alt);
                        if (found) break;
                    }
                    if (found) break;
                }
                break;
            }
        }

        if (!found && cardText.startsWith('空白牌')) {
            const isYes = cardText.includes('肯定') || cardText.includes('XXII');
            return {
                type: 'tarot',
                card: {
                    name: '空白牌', eng: 'Blank Card',
                    keyword: isYes ? '肯定' : '否定',
                    upright: isYes ? '肯定的答案、无限的可能性、纯粹的潜能' : '否定的答案、需要等待、时机未到',
                    reversed: isYes ? '犹豫、未能把握机会' : '坚决的拒绝、此路不通',
                    img: '', type: 'major'
                },
                orientation: orientation || (isYes ? 'upright' : 'reversed')
            };
        }

        return found ? { type: 'tarot', card: found, orientation } : null;
    }

    function searchCardMeaning(text) {
        const clean = text.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[\u200d\ufe0f]/gu, '').trim();
        const result = matchCardFromText(clean);
        if (!result) { showCardNotFound(clean); return; }
        if (result.type === 'tarot') showTarotModal(result.card, result.orientation);
        else showLenormandModal(result.card);
    }

    function closeCardModal() {
        const el = document.getElementById('cx-card-modal');
        if (el) el.remove();
    }

    function showTarotModal(card, orientation) {
        closeCardModal();
        const isReversed = orientation === 'reversed';
        const orientLabel = isReversed ? '逆位' : '正位';
        const meaning = isReversed ? card.reversed : card.upright;
        const typeNames = { major: '大阿卡纳', wands: '权杖', cups: '圣杯', swords: '宝剑', pentacles: '星币' };
        const imgRotate = isReversed ? 'transform:rotate(180deg);' : '';

        const overlay = document.createElement('div');
        overlay.className = 'cx-card-overlay';
        overlay.id = 'cx-card-modal';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCardModal(); });

        overlay.innerHTML = `
            <div class="cx-card-modal">
                <div class="cx-card-header">
                    <button class="cx-card-close" onclick="document.getElementById('cx-card-modal').remove()">✕</button>
                    <div style="font-size:10px; opacity:0.8; letter-spacing:1px; margin-bottom:4px;">✦ ${typeNames[card.type] || '塔罗'} ✦</div>
                    <div style="font-size:18px; font-weight:700; letter-spacing:1px;">${card.name}</div>
                    <div style="font-size:11px; opacity:0.85; margin-top:2px;">${card.eng || ''} · ${orientLabel}</div>
                </div>
                <div class="cx-card-body">
                    ${card.img ? `
                    <div style="text-align:center; margin-bottom:14px;">
                        <img src="${card.img}" style="width:200px; max-width:80%; border-radius:10px; border:1.5px solid rgba(var(--accent-color-rgb),0.3); box-shadow:0 2px 12px rgba(0,0,0,0.1); display:block; margin:0 auto; ${imgRotate}" onerror="this.outerHTML='<div style=\\'padding:30px; text-align:center;\\'><i class=\\'fas fa-star\\' style=\\'font-size:40px; color:var(--accent-color);\\'></i></div>';">
                    </div>` : ''}
                    <div style="margin-bottom:10px;">
                        <div style="font-size:11px; color:var(--accent-color); font-weight:600; margin-bottom:6px; letter-spacing:1px;">
                            ${isReversed ? '✧ 逆位释义' : '✦ 正位释义'}
                        </div>
                        <div style="font-size:13px; color:var(--text-primary); line-height:1.8;">${meaning || '暂无释义'}</div>
                    </div>
                    ${card.keyword ? `<div style="font-size:11px; color:var(--text-secondary); margin-top:8px;">关键词：<span style="color:var(--accent-color); font-weight:600;">${card.keyword}</span></div>` : ''}
                    <div style="margin-top:12px; border-top:1px solid var(--border-color); padding-top:10px;">
                        <button onclick="document.getElementById('cx-card-modal').remove(); window._cxShowTarot('${card.name.replace(/'/g, "\\'")}', '${isReversed ? 'upright' : 'reversed'}');" style="width:100%; padding:7px; border-radius:10px; border:1px solid var(--border-color); background:var(--primary-bg); color:var(--text-primary); font-size:12px; cursor:pointer;">查看${isReversed ? '正位' : '逆位'}释义</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    }

    window._cxShowTarot = function (name, orientation) {
        if (typeof ALL_78_TAROT_CARDS === 'undefined') return;
        const card = ALL_78_TAROT_CARDS.find(c => c.name === name);
        if (card) showTarotModal(card, orientation);
    };

    function showLenormandModal(card) {
        closeCardModal();
        const overlay = document.createElement('div');
        overlay.className = 'cx-card-overlay';
        overlay.id = 'cx-card-modal';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCardModal(); });
        overlay.innerHTML = `
            <div class="cx-card-modal">
                <div class="cx-card-header" style="text-align:center;">
                    <button class="cx-card-close" onclick="document.getElementById('cx-card-modal').remove()">✕</button>
                    <div style="font-size:36px; margin-bottom:6px;">${card.icon}</div>
                    <div style="font-size:16px; font-weight:700;">${card.num}. ${card.name}</div>
                    <div style="font-size:11px; opacity:0.85; margin-top:3px;">${card.keyword}</div>
                </div>
                <div class="cx-card-body">
                    <div style="font-size:13px; color:var(--text-primary); line-height:1.8;">${card.meaning}</div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    }

    function showCardNotFound(text) {
        closeCardModal();
        const preview = text.length > 30 ? text.slice(0, 30) + '…' : text;
        const overlay = document.createElement('div');
        overlay.className = 'cx-card-overlay';
        overlay.id = 'cx-card-modal';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCardModal(); });
        overlay.innerHTML = `
            <div class="cx-card-modal">
                <div class="cx-card-header" style="text-align:center;">
                    <button class="cx-card-close" onclick="document.getElementById('cx-card-modal').remove()">✕</button>
                    <div style="font-size:28px; margin-bottom:6px;">🔍</div>
                    <div style="font-size:14px; font-weight:600;">未找到对应牌面</div>
                </div>
                <div class="cx-card-body" style="text-align:center;">
                    <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">消息内容：</div>
                    <div style="font-size:13px; color:var(--text-primary); background:var(--primary-bg); padding:8px 12px; border-radius:10px; word-break:break-all;">${preview}</div>
                    <div style="font-size:11px; color:var(--text-secondary); margin-top:12px; line-height:1.6;">
                        支持的格式示例：<br>
                        塔罗：圣杯2正位、权杖ace逆位、愚人0正位<br>
                        雷诺曼：1.骑士、24.心
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    }

    /* ═══════════════════════════════════════════
     *  6. 初始化
     * ═══════════════════════════════════════════ */

    function init() {
        skipSplash();
        injectPluginCSS();

        waitForElement('#chat-container', () => {
            // 用 MutationObserver 确保每次 DOM 变化后都补按钮
            const chatContainer = document.getElementById('chat-container');
            const observer = new MutationObserver(() => {
                enhanceActionBars();
            });
            observer.observe(chatContainer, { childList: true, subtree: true });

            // 也 patch renderMessages 作为备份
            const origRender = window.renderMessages;
            if (origRender) {
                window.renderMessages = function () {
                    origRender.apply(this, arguments);
                    setTimeout(() => { enhanceActionBars(); }, 80);
                };
            }

            // 首次
            setTimeout(() => { enhanceActionBars(); }, 300);
        });

        waitForElement('#envelope-modal', () => {
            patchEnvelopeForTarot();
            patchViewEnvLetter();
            patchEnvelopeReplyDelay();

            // 定期检查回信（每 15 秒）
            setInterval(() => {
                if (typeof checkEnvelopeStatus === 'function') checkEnvelopeStatus();
            }, 15000);
        });
    }

    /* ── 测试模式：回信延迟改为 1 分钟（上线时改回正常值或删除此函数） ── */
    function patchEnvelopeReplyDelay() {
        // 拦截 outbox.push，把 replyTime 改成 1 分钟后
        const origPush = Array.prototype.push;
        if (typeof envelopeData !== 'undefined' && envelopeData.outbox) {
            const origOutboxPush = envelopeData.outbox.push;
            envelopeData.outbox.push = function (letter) {
                if (letter && letter.replyTime && letter.status === 'pending') {
                    // ★ 测试用：1 分钟回信。正式版改为 10-24 小时
                    letter.replyTime = Date.now() + 1 * 60 * 1000;
                }
                return origPush.call(this, letter);
            };
        }
    }

    function waitForElement(selector, callback, maxWait) {
        maxWait = maxWait || 10000;
        const start = Date.now();
        function check() {
            if (document.querySelector(selector)) callback();
            else if (Date.now() - start < maxWait) setTimeout(check, 200);
        }
        check();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
