/**
 * cx-plugin.js — 传讯定制插件
 * 基于 aielin17/milk 原版，集中所有改动
 * 
 * 功能：
 * 1. 跳过声明页（splash-declaration）
 * 2. 消息 emoji 点赞（双击气泡触发）
 * 3. 回信附带 3 张塔罗牌（牌阵：链接状态 / 感受 / 传达）
 * 4. 消息旁搜索按钮 → 快速查询塔罗/雷诺曼牌义
 */

(function () {
    'use strict';

    /* ═══════════════════════════════════════════
     *  0. 工具 & 常量
     * ═══════════════════════════════════════════ */

    const CX_STORAGE_PREFIX = 'cx_';

    // 回信塔罗牌阵位名
    const SPREAD_POSITIONS = [
        '你与他的链接状态',
        '他看到信时的感受',
        '他想传达给你的话'
    ];

    // emoji 点赞候选
    const REACTION_EMOJIS = ['❤️', '👍', '😂', '😢', '😮', '🔥'];

    // 对方自动回赞的概率
    const AUTO_REACTION_PROB = 0.35;

    /* ═══════════════════════════════════════════
     *  1. 跳过声明页
     * ═══════════════════════════════════════════ */

    function skipSplash() {
        // 直接标记为已签署，跳过整个流程
        localStorage.setItem('splashPledgeSigned_v3', 'true');
        const splash = document.getElementById('splash-declaration');
        if (splash) splash.style.display = 'none';
    }

    /* ═══════════════════════════════════════════
     *  2. Emoji 点赞
     *     双击消息气泡 → 弹出 emoji 选择条
     *     选择后在消息下方显示 emoji 标签
     *     对方消息：用户给对方点
     *     用户消息：对方随机自动给你点
     * ═══════════════════════════════════════════ */

    // 存储结构 { msgId: { user: '❤️', partner: '👍' } }
    function loadReactions() {
        try {
            return JSON.parse(localStorage.getItem(CX_STORAGE_PREFIX + 'reactions') || '{}');
        } catch { return {}; }
    }
    function saveReactions(data) {
        localStorage.setItem(CX_STORAGE_PREFIX + 'reactions', JSON.stringify(data));
    }

    // 注入点赞相关 CSS
    function injectReactionCSS() {
        if (document.getElementById('cx-reaction-css')) return;
        const style = document.createElement('style');
        style.id = 'cx-reaction-css';
        style.textContent = `
            .cx-reaction-bar {
                display: none;
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                background: var(--secondary-bg);
                border: 1px solid var(--border-color);
                border-radius: 20px;
                padding: 4px 6px;
                gap: 2px;
                z-index: 999;
                box-shadow: 0 4px 16px rgba(0,0,0,0.15);
                animation: cxReactionPop 0.2s cubic-bezier(0.34,1.56,0.64,1);
                flex-wrap: nowrap;
                white-space: nowrap;
            }
            .cx-reaction-bar.show { display: flex; }
            @keyframes cxReactionPop {
                from { opacity:0; transform: translateX(-50%) scale(0.7); }
                to { opacity:1; transform: translateX(-50%) scale(1); }
            }
            .cx-reaction-bar button {
                border: none;
                background: none;
                font-size: 20px;
                cursor: pointer;
                padding: 3px 5px;
                border-radius: 8px;
                transition: background 0.15s, transform 0.15s;
                line-height: 1;
            }
            .cx-reaction-bar button:hover {
                background: rgba(var(--accent-color-rgb), 0.12);
                transform: scale(1.2);
            }
            .cx-reaction-badge {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                font-size: 16px;
                padding: 1px 4px;
                border-radius: 12px;
                background: var(--primary-bg);
                border: 1px solid var(--border-color);
                margin-top: 3px;
                cursor: pointer;
                transition: transform 0.15s;
                line-height: 1.2;
            }
            .cx-reaction-badge:hover { transform: scale(1.15); }
            .cx-reaction-badge .cx-rb-count {
                font-size: 10px;
                color: var(--text-secondary);
            }
            .cx-reaction-container {
                display: flex;
                gap: 4px;
                flex-wrap: wrap;
                margin-top: 2px;
            }
        `;
        document.head.appendChild(style);
    }

    // 给消息气泡绑定双击事件（委托）
    function initReactionDelegate() {
        const container = document.getElementById('chat-container');
        if (!container || container._cxReactionBound) return;
        container._cxReactionBound = true;

        let lastTap = 0;
        let lastTarget = null;

        container.addEventListener('click', function (e) {
            // 双击检测（兼容移动端）
            const now = Date.now();
            const msgEl = e.target.closest('.message');
            if (!msgEl) return;
            // 排除点击图片、按钮等
            if (e.target.closest('.message-meta-actions, .reply-indicator, img, .cx-reaction-bar, .cx-reaction-badge, .cx-search-btn')) return;

            if (msgEl === lastTarget && now - lastTap < 400) {
                // 双击触发
                e.preventDefault();
                e.stopPropagation();
                showReactionBar(msgEl);
                lastTap = 0;
                lastTarget = null;
            } else {
                lastTap = now;
                lastTarget = msgEl;
            }
        });

        // 点击其他地方关闭
        document.addEventListener('click', function (e) {
            if (!e.target.closest('.cx-reaction-bar')) {
                document.querySelectorAll('.cx-reaction-bar.show').forEach(el => el.classList.remove('show'));
            }
        });
    }

    function showReactionBar(msgEl) {
        // 关闭已有的
        document.querySelectorAll('.cx-reaction-bar.show').forEach(el => el.classList.remove('show'));

        const wrapper = msgEl.closest('.message-wrapper');
        if (!wrapper) return;
        const msgId = wrapper.dataset.msgId || wrapper.dataset.id;
        if (!msgId) return;

        // 检查是否已有 bar
        let bar = msgEl.querySelector('.cx-reaction-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'cx-reaction-bar';
            bar.innerHTML = REACTION_EMOJIS.map(em =>
                `<button data-emoji="${em}" title="${em}">${em}</button>`
            ).join('');
            msgEl.style.position = 'relative';
            msgEl.appendChild(bar);

            bar.addEventListener('click', function (e) {
                const btn = e.target.closest('button[data-emoji]');
                if (!btn) return;
                e.stopPropagation();
                const emoji = btn.dataset.emoji;
                applyReaction(msgId, wrapper, emoji);
                bar.classList.remove('show');
            });
        }
        bar.classList.add('show');
    }

    function applyReaction(msgId, wrapper, emoji) {
        const reactions = loadReactions();
        const isSent = wrapper.classList.contains('sent');
        const key = isSent ? 'partner' : 'user'; // 用户双击对方消息 → user 字段；双击自己消息 → partner 字段

        if (!reactions[msgId]) reactions[msgId] = {};

        // toggle：再次点相同 emoji 取消
        if (reactions[msgId][key] === emoji) {
            delete reactions[msgId][key];
            if (!reactions[msgId].user && !reactions[msgId].partner) delete reactions[msgId];
        } else {
            reactions[msgId][key] = emoji;
        }

        // 对方消息被用户点赞后，对方有概率回赞
        if (key === 'user' && reactions[msgId] && !reactions[msgId].partner && Math.random() < AUTO_REACTION_PROB) {
            setTimeout(() => {
                const latest = loadReactions();
                if (latest[msgId] && !latest[msgId].partner) {
                    latest[msgId].partner = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
                    saveReactions(latest);
                    renderReactionBadge(msgId, wrapper);
                }
            }, 800 + Math.random() * 2000);
        }

        // 用户双击自己的消息 → 对方自动回赞（模拟对方操作）
        if (key === 'partner') {
            // 其实这里让用户能给自己消息点赞也挺有趣，但更符合微信体验的是：
            // 双击自己消息 = 你操作，所以存到 user 字段
            // 我们改一下逻辑：不管双击谁的消息，都是"你"在点赞
            delete reactions[msgId]['partner']; // 撤回
            reactions[msgId]['user'] = emoji;
            if (reactions[msgId]['user'] === emoji && Object.keys(reactions[msgId]).length === 1) {
                // 对方有概率也给你的消息点赞
                if (Math.random() < AUTO_REACTION_PROB) {
                    setTimeout(() => {
                        const latest = loadReactions();
                        if (latest[msgId] && !latest[msgId].partner) {
                            latest[msgId].partner = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
                            saveReactions(latest);
                            renderReactionBadge(msgId, wrapper);
                        }
                    }, 800 + Math.random() * 2000);
                }
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

        // 移除旧的 badge container
        let container = contentWrapper.querySelector('.cx-reaction-container');
        if (container) container.remove();

        if (!data || (!data.user && !data.partner)) return;

        container = document.createElement('div');
        container.className = 'cx-reaction-container';

        const emojis = [];
        if (data.user) emojis.push(data.user);
        if (data.partner && data.partner !== data.user) emojis.push(data.partner);
        else if (data.partner && data.partner === data.user) {
            // 相同 emoji，显示 x2
        }

        const isSame = data.user && data.partner && data.user === data.partner;
        if (isSame) {
            const badge = document.createElement('span');
            badge.className = 'cx-reaction-badge';
            badge.innerHTML = `${data.user}<span class="cx-rb-count">2</span>`;
            badge.title = '你和对方都点了';
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                // 取消自己的
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

        // 插入到 message-meta 之前
        const meta = contentWrapper.querySelector('.message-meta');
        if (meta) {
            contentWrapper.insertBefore(container, meta);
        } else {
            contentWrapper.appendChild(container);
        }
    }

    // 渲染所有已有的 reactions（页面加载 / renderMessages 后调用）
    function renderAllReactions() {
        const reactions = loadReactions();
        const container = document.getElementById('chat-container');
        if (!container) return;
        container.querySelectorAll('.message-wrapper').forEach(wrapper => {
            const msgId = wrapper.dataset.msgId || wrapper.dataset.id;
            if (msgId && reactions[msgId]) {
                renderReactionBadge(msgId, wrapper);
            }
        });
    }

    /* ═══════════════════════════════════════════
     *  3. 回信 3 张塔罗牌
     * ═══════════════════════════════════════════ */

    // 抽 3 张不重复的牌（从 ALL_78_TAROT_CARDS）
    function drawThreeCards() {
        // 等 games.js 加载
        if (typeof ALL_78_TAROT_CARDS === 'undefined') return null;
        const deck = [...ALL_78_TAROT_CARDS].sort(() => Math.random() - 0.5);
        return deck.slice(0, 3).map(card => ({
            ...card,
            isUpright: Math.random() > 0.4  // 60% 正位
        }));
    }

    // 覆盖原版的回信检查，在回信生成时预定牌面
    function patchEnvelopeForTarot() {
        // 拦截 checkEnvelopeStatus，在生成 inboxLetter 时附加 tarotCards
        const origCheck = window.checkEnvelopeStatus;
        if (!origCheck) return;

        // 我们不直接覆盖，而是 patch saveEnvelopeData 之前的逻辑
        // 更安全的方式：在 inboxLetter 创建后注入数据
        // 通过 MutationObserver 监听 inbox 的变化来附加牌面
        // 
        // 但更简洁的方式是：重写 checkEnvelopeStatus
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
                        ? generateEnvelopeReplyText()
                        : '…';
                    const replyId = 'reply_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                    const cards = drawThreeCards();
                    const inboxLetter = {
                        id: replyId,
                        refId: letter.id,
                        originalContent: letter.content,
                        content: replyContent,
                        receivedTime: Date.now(),
                        isNew: true,
                        cxTarotCards: cards  // 预定牌面
                    };
                    envelopeData.inbox.push(inboxLetter);
                    newReplyLetter = inboxLetter;
                    changed = true;
                    if (typeof playSound === 'function') playSound('message');
                }
            });
            if (changed) {
                if (typeof saveEnvelopeData === 'function') saveEnvelopeData();
                if (newReplyLetter && typeof showEnvelopeReplyPopup === 'function') {
                    showEnvelopeReplyPopup(newReplyLetter);
                }
            }
        };
    }

    // 覆盖 viewEnvLetter，在回信视图中注入塔罗牌区域
    function patchViewEnvLetter() {
        const origView = window.viewEnvLetter;
        if (!origView) return;

        window.viewEnvLetter = function (section, id) {
            // 先调原版
            origView.call(window, section, id);

            // 只在收件箱（回信）中注入塔罗牌
            if (section !== 'inbox') {
                removeTarotSection();
                return;
            }

            const letter = envelopeData.inbox.find(l => l.id === id);
            if (!letter) return;

            // 如果这封信还没有预定牌面（旧数据），现在补上
            if (!letter.cxTarotCards) {
                letter.cxTarotCards = drawThreeCards();
                if (typeof saveEnvelopeData === 'function') saveEnvelopeData();
            }

            if (!letter.cxTarotCards) return;

            injectTarotSection(letter.cxTarotCards);
        };
    }

    function removeTarotSection() {
        const existing = document.getElementById('cx-tarot-section');
        if (existing) existing.remove();
    }

    function injectTarotSection(cards) {
        removeTarotSection();
        if (!cards || cards.length < 3) return;

        const signName = document.getElementById('env-view-sign-name');
        if (!signName) return;
        const parentContainer = signName.closest('[style*="position:relative"]') || signName.parentElement;

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
            cardEl.style.cssText = 'flex:1; min-width:90px; max-width:120px; text-align:center;';

            // 牌背（可翻转）
            const flipContainer = document.createElement('div');
            flipContainer.className = 'tarot-container-3d tarot-responsive';
            flipContainer.style.cssText = 'cursor:pointer; margin-bottom:6px; aspect-ratio:2/3; max-height:160px;';

            flipContainer.innerHTML = `
                <div class="tarot-card-inner">
                    <div class="tarot-face tarot-front">
                        <div class="tarot-pattern" style="font-size:16px;"><i class="fas fa-star-and-crescent"></i></div>
                    </div>
                    <div class="tarot-face tarot-back" style="background:linear-gradient(135deg,var(--secondary-bg),rgba(var(--accent-color-rgb),0.07)); border:1.5px solid rgba(var(--accent-color-rgb),0.3); padding:6px; display:flex; flex-direction:column; align-items:center; justify-content:center; overflow-y:auto;">
                        ${card.img ? `<div class="tarot-visual ${isUpright ? '' : 'reversed'}" style="height:60px; flex-shrink:0; margin-bottom:4px;"><img src="${card.img}" style="height:100%; object-fit:contain; border-radius:4px;" onerror="this.parentElement.innerHTML='<i class=\\'fas ${card.icon || 'fa-star'} tarot-icon-vector\\' style=\\'font-size:32px; color:var(--accent-color);\\'></i>';"></div>` : `<div class="tarot-visual ${isUpright ? '' : 'reversed'}" style="height:60px; flex-shrink:0;"><i class="fas ${card.icon || 'fa-star'} tarot-icon-vector" style="font-size:32px; color:var(--accent-color);"></i></div>`}
                        <div style="font-size:12px; font-weight:700; color:var(--text-primary); margin-bottom:2px;">${card.name}</div>
                        <div style="font-size:9px; color:var(--accent-color); margin-bottom:2px;">${orientation} · ${card.keyword || ''}</div>
                    </div>
                </div>
            `;

            flipContainer.addEventListener('click', function () {
                this.classList.toggle('flipped');
            });

            // 位置标签
            const posLabel = document.createElement('div');
            posLabel.style.cssText = 'font-size:10px; color:var(--text-secondary); margin-bottom:4px; letter-spacing:0.5px;';
            posLabel.textContent = pos;

            // 释义（翻牌后显示）
            const interpEl = document.createElement('div');
            interpEl.style.cssText = 'font-size:10px; color:var(--text-secondary); line-height:1.5; margin-top:4px; display:none; max-height:80px; overflow-y:auto;';
            interpEl.textContent = meaning || '';

            flipContainer.addEventListener('click', function () {
                interpEl.style.display = this.classList.contains('flipped') ? 'block' : 'none';
            });

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

        // 插入到签名后面
        parentContainer.appendChild(section);
    }

    /* ═══════════════════════════════════════════
     *  4. 消息搜索按钮 → 快速查询牌义
     * ═══════════════════════════════════════════ */

    // 精准匹配映射：字卡文本 → 原版牌数据
    // 塔罗字卡格式举例："圣杯2逆位" "权杖ace正位" "愚人0正位" "世界XXI逆位" "圣杯女皇正位"

    // 数字映射
    const NUM_MAP = {
        'ace': '一', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五',
        '6': '六', '7': '七', '8': '八', '9': '九', '10': '十'
    };

    // 称谓映射（字卡用的 vs 原版用的）
    const TITLE_MAP = {
        '女皇': ['女帝', '女王'],  // 字卡"圣杯女皇" → 原版可能是"圣杯女王"
        '侍从': ['侍者'],
    };

    // 罗马数字到名字的映射（大阿卡纳）
    const ROMAN_MAP = {
        '0': '愚人', 'I': '魔术师', 'II': '女祭司', 'III': '女皇',
        'IV': '皇帝', 'V': '教皇', 'VI': '恋人', 'VII': '战车',
        'VIII': '力量', 'IX': '隐士', 'X': '命运之轮', 'XI': '正义',
        'XII': '倒吊人', 'XIII': '死神', 'XIV': '节制', 'XV': '恶魔',
        'XVI': '高塔', 'XVII': '星星', 'XVIII': '月亮', 'XIX': '太阳',
        'XX': '审判', 'XXI': '世界', 'XXII': '空白牌', 'XXIII': '空白牌'
    };

    // 雷诺曼字卡格式："1.骑士" "24.心"
    // 雷诺曼名称映射（字卡名 → 原版名）
    const LENORMAND_NAME_MAP = {
        '幸运草': '四叶草',
        '船': '帆船',
        '房子': '房屋',
        '树': '大树',
        '云': '乌云',
        '鸟': '鸟儿',
        '小孩': '孩童',
        '戒指': '指环',
        '信': '信件',
        '男人': '男士',
        '女人': '女士',
        '百合花': '百合',
        '道路': '十字路口',
        '山': '山丘',
        '十字架': '十字架'
    };

    /**
     * 解析消息文本，尝试匹配塔罗牌或雷诺曼牌
     * @param {string} text 消息文本
     * @returns {{ type:'tarot'|'lenormand', card:object, orientation?:string } | null}
     */
    function matchCardFromText(text) {
        if (!text) return null;

        // 去除 emoji 和空白
        const clean = text.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[\u200d\ufe0f]/gu, '').trim();
        if (!clean) return null;

        // === 雷诺曼匹配 ===
        // 格式: "1.骑士" 或 "24.心" 或纯 "骑士"
        const lenormandMatch = clean.match(/^(\d{1,2})\.\s*(.+)$/);
        if (lenormandMatch && typeof LENORMAND_CARDS_40 !== 'undefined') {
            const num = parseInt(lenormandMatch[1]);
            const card = LENORMAND_CARDS_40.find(c => c.num === num);
            if (card) return { type: 'lenormand', card };
        }

        // 也尝试纯名字匹配雷诺曼
        if (typeof LENORMAND_CARDS_40 !== 'undefined') {
            const directLen = LENORMAND_CARDS_40.find(c => clean === c.name);
            if (directLen) return { type: 'lenormand', card: directLen };
            // 尝试映射
            const mappedName = LENORMAND_NAME_MAP[clean];
            if (mappedName) {
                const mapped = LENORMAND_CARDS_40.find(c => c.name === mappedName);
                if (mapped) return { type: 'lenormand', card: mapped };
            }
        }

        // === 塔罗匹配 ===
        if (typeof ALL_78_TAROT_CARDS === 'undefined') return null;

        // 确定正逆位
        let orientation = null;
        let cardText = clean;
        if (clean.endsWith('正位')) {
            orientation = 'upright';
            cardText = clean.slice(0, -2);
        } else if (clean.endsWith('逆位')) {
            orientation = 'reversed';
            cardText = clean.slice(0, -2);
        }

        // 大阿卡纳：格式如 "愚人0" "世界XXI" "魔术师I"
        // 先尝试去掉末尾罗马数字/阿拉伯数字
        let majorName = null;
        const romanSuffix = cardText.match(/([IVXL]+|\d+)$/);
        if (romanSuffix) {
            const nameWithout = cardText.slice(0, -romanSuffix[0].length);
            const roman = romanSuffix[0];
            // 验证：名字部分是否就是某个大阿卡纳的名字
            const majorCard = ALL_78_TAROT_CARDS.find(c => c.type === 'major' && c.name === nameWithout);
            if (majorCard) majorName = nameWithout;
            // 也可能罗马数字对应的名字就是 nameWithout
            if (!majorName && ROMAN_MAP[roman] && ROMAN_MAP[roman] === nameWithout) {
                majorName = nameWithout;
            }
        }

        // 直接名字匹配
        let found = ALL_78_TAROT_CARDS.find(c => c.name === cardText);
        if (!found && majorName) found = ALL_78_TAROT_CARDS.find(c => c.name === majorName);

        // 小阿卡纳：格式如 "圣杯2" "权杖ace" "星币国王" "宝剑侍从"
        if (!found) {
            // 分离花色和数字/称谓
            const suitsPatterns = ['圣杯', '权杖', '宝剑', '星币'];
            const suitTypes = { '圣杯': 'cups', '权杖': 'wands', '宝剑': 'swords', '星币': 'pentacles' };

            for (const suit of suitsPatterns) {
                if (!cardText.startsWith(suit)) continue;
                const rest = cardText.slice(suit.length);
                if (!rest) continue;

                const suitType = suitTypes[suit];

                // 数字牌：rest 是 "2" "ace" "10" 等
                const lowerRest = rest.toLowerCase();
                if (NUM_MAP[lowerRest]) {
                    const chineseNum = NUM_MAP[lowerRest];
                    found = ALL_78_TAROT_CARDS.find(c =>
                        c.type === suitType && c.name === suit + chineseNum
                    );
                    if (found) break;
                }

                // 宫廷牌：rest 是 "国王" "女皇" "骑士" "侍从"
                // 直接匹配
                found = ALL_78_TAROT_CARDS.find(c =>
                    c.type === suitType && c.name === suit + rest
                );
                if (found) break;

                // 称谓映射
                if (TITLE_MAP[rest]) {
                    for (const alt of TITLE_MAP[rest]) {
                        found = ALL_78_TAROT_CARDS.find(c =>
                            c.type === suitType && c.name === suit + alt
                        );
                        if (found) break;
                    }
                    if (found) break;
                }

                break;
            }
        }

        // 空白牌特殊处理
        if (!found && (cardText.startsWith('空白牌'))) {
            const isYes = cardText.includes('肯定') || cardText.includes('XXII');
            return {
                type: 'tarot',
                card: {
                    name: '空白牌',
                    eng: 'Blank Card',
                    keyword: isYes ? '肯定' : '否定',
                    upright: isYes ? '肯定的答案、无限的可能性、纯粹的潜能、未被书写的命运' : '否定的答案、需要等待、时机未到、暂停',
                    reversed: isYes ? '犹豫、未能把握机会' : '坚决的拒绝、此路不通',
                    img: '',
                    type: 'major'
                },
                orientation: orientation || (isYes ? 'upright' : 'reversed')
            };
        }

        if (found) {
            return { type: 'tarot', card: found, orientation };
        }

        return null;
    }

    // 注入搜索按钮 CSS
    function injectSearchCSS() {
        if (document.getElementById('cx-search-css')) return;
        const style = document.createElement('style');
        style.id = 'cx-search-css';
        style.textContent = `
            .cx-search-btn {
                display: none;
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                width: 24px;
                height: 24px;
                border-radius: 50%;
                border: 1px solid var(--border-color);
                background: var(--secondary-bg);
                color: var(--text-secondary);
                font-size: 11px;
                cursor: pointer;
                align-items: center;
                justify-content: center;
                z-index: 10;
                transition: all 0.15s;
                padding: 0;
                line-height: 1;
                box-shadow: 0 1px 4px rgba(0,0,0,0.1);
            }
            .message-wrapper:hover .cx-search-btn,
            .message-wrapper:active .cx-search-btn {
                display: flex;
            }
            .message-wrapper.sent .cx-search-btn {
                left: -30px;
            }
            .message-wrapper.received .cx-search-btn {
                right: -30px;
            }
            .cx-search-btn:hover {
                background: var(--accent-color);
                color: #fff;
                border-color: var(--accent-color);
            }

            /* 牌义弹窗 */
            .cx-card-modal-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.5);
                z-index: 9000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: cxFadeIn 0.2s ease;
                padding: 20px;
            }
            @keyframes cxFadeIn { from { opacity:0; } to { opacity:1; } }
            .cx-card-modal {
                background: var(--secondary-bg);
                border-radius: 20px;
                max-width: 340px;
                width: 100%;
                overflow: hidden;
                box-shadow: 0 16px 48px rgba(0,0,0,0.25);
                animation: cxSlideUp 0.3s cubic-bezier(0.22,1,0.36,1);
            }
            @keyframes cxSlideUp { from { opacity:0; transform:translateY(20px) scale(0.95); } to { opacity:1; transform:translateY(0) scale(1); } }
            .cx-card-modal-header {
                background: var(--accent-color);
                padding: 16px 20px;
                color: #fff;
                position: relative;
            }
            .cx-card-modal-body {
                padding: 18px 20px;
            }
            .cx-card-modal-close {
                position: absolute;
                top: 12px;
                right: 14px;
                background: rgba(255,255,255,0.2);
                border: none;
                color: #fff;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                font-size: 14px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .cx-card-modal-close:hover { background: rgba(255,255,255,0.35); }
        `;
        document.head.appendChild(style);
    }

    // 给每条消息注入搜索按钮（MutationObserver 方式）
    function addSearchButtons() {
        const container = document.getElementById('chat-container');
        if (!container) return;

        container.querySelectorAll('.message-wrapper').forEach(wrapper => {
            if (wrapper.querySelector('.cx-search-btn')) return; // 已有

            const msgEl = wrapper.querySelector('.message');
            if (!msgEl) return;

            // 获取纯文本
            const textDiv = msgEl.querySelector('div');
            if (!textDiv) return;
            const text = textDiv.textContent || '';
            if (!text.trim()) return;

            const btn = document.createElement('button');
            btn.className = 'cx-search-btn';
            btn.innerHTML = '<i class="fas fa-search"></i>';
            btn.title = '查询牌义';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                searchCardMeaning(text);
            });

            msgEl.style.position = 'relative';
            msgEl.appendChild(btn);
        });
    }

    function searchCardMeaning(text) {
        // 去除 emoji
        const clean = text.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[\u200d\ufe0f]/gu, '').trim();

        const result = matchCardFromText(clean);

        if (!result) {
            showCardNotFound(clean);
            return;
        }

        if (result.type === 'tarot') {
            showTarotCardModal(result.card, result.orientation);
        } else {
            showLenormandCardModal(result.card);
        }
    }

    function showTarotCardModal(card, orientation) {
        closeCardModal();

        const isUpright = orientation === 'upright' || orientation === null;
        const isReversed = orientation === 'reversed';
        const orientLabel = isReversed ? '逆位' : '正位';
        const meaning = isReversed ? card.reversed : card.upright;

        const overlay = document.createElement('div');
        overlay.className = 'cx-card-modal-overlay';
        overlay.id = 'cx-card-modal';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCardModal(); });

        const typeName = { major: '大阿卡纳', wands: '权杖', cups: '圣杯', swords: '宝剑', pentacles: '星币' };

        overlay.innerHTML = `
            <div class="cx-card-modal">
                <div class="cx-card-modal-header">
                    <button class="cx-card-modal-close" onclick="document.getElementById('cx-card-modal').remove()">✕</button>
                    <div style="font-size:10px; opacity:0.8; letter-spacing:1px; margin-bottom:4px;">✦ ${typeName[card.type] || '塔罗'} ✦</div>
                    <div style="font-size:18px; font-weight:700; letter-spacing:1px;">${card.name}</div>
                    <div style="font-size:11px; opacity:0.85; margin-top:2px;">${card.eng || ''} · ${orientLabel}</div>
                </div>
                <div class="cx-card-modal-body">
                    ${card.img ? `
                    <div style="text-align:center; margin-bottom:14px;">
                        <div class="tarot-container-3d tarot-responsive" style="cursor:pointer; display:inline-block; width:120px;" onclick="this.classList.toggle('flipped');">
                            <div class="tarot-card-inner">
                                <div class="tarot-face tarot-front"><div class="tarot-pattern" style="font-size:18px;"><i class="fas fa-star-and-crescent"></i></div></div>
                                <div class="tarot-face tarot-back" style="background:var(--primary-bg); border:1.5px solid rgba(var(--accent-color-rgb),0.3); padding:0; overflow:hidden;">
                                    <div class="tarot-visual ${isReversed ? 'reversed' : ''}" style="height:100%; width:100%;"><img src="${card.img}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-star tarot-icon-vector\\' style=\\'font-size:40px; color:var(--accent-color);\\'></i>';"></div>
                                </div>
                            </div>
                        </div>
                        <div style="font-size:10px; color:var(--text-secondary); margin-top:6px; opacity:0.6;">点击翻牌查看图片</div>
                    </div>` : ''}
                    <div style="margin-bottom:10px;">
                        <div style="font-size:11px; color:var(--accent-color); font-weight:600; margin-bottom:6px; letter-spacing:1px;">
                            ${isReversed ? '✧ 逆位释义' : '✦ 正位释义'}
                        </div>
                        <div style="font-size:13px; color:var(--text-primary); line-height:1.8;">
                            ${meaning || '暂无释义'}
                        </div>
                    </div>
                    ${card.keyword ? `<div style="font-size:11px; color:var(--text-secondary); margin-top:8px;">关键词：<span style="color:var(--accent-color); font-weight:600;">${card.keyword}</span></div>` : ''}
                    ${orientation === null ? `
                    <div style="margin-top:12px; border-top:1px solid var(--border-color); padding-top:10px;">
                        <div style="display:flex; gap:8px;">
                            <button onclick="document.getElementById('cx-card-modal').remove(); showTarotCardModal_global(${JSON.stringify(card.name).replace(/"/g, '&quot;')}, 'upright');" style="flex:1; padding:7px; border-radius:10px; border:1px solid var(--border-color); background:var(--primary-bg); color:var(--text-primary); font-size:12px; cursor:pointer;">查看正位</button>
                            <button onclick="document.getElementById('cx-card-modal').remove(); showTarotCardModal_global(${JSON.stringify(card.name).replace(/"/g, '&quot;')}, 'reversed');" style="flex:1; padding:7px; border-radius:10px; border:1px solid var(--border-color); background:var(--primary-bg); color:var(--text-primary); font-size:12px; cursor:pointer;">查看逆位</button>
                        </div>
                    </div>` : `
                    <div style="margin-top:12px; border-top:1px solid var(--border-color); padding-top:10px;">
                        <button onclick="document.getElementById('cx-card-modal').remove(); showTarotCardModal_global(${JSON.stringify(card.name).replace(/"/g, '&quot;')}, '${isReversed ? 'upright' : 'reversed'}');" style="width:100%; padding:7px; border-radius:10px; border:1px solid var(--border-color); background:var(--primary-bg); color:var(--text-primary); font-size:12px; cursor:pointer;">查看${isReversed ? '正位' : '逆位'}释义</button>
                    </div>`}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    // 全局函数供 inline onclick 使用
    window.showTarotCardModal_global = function (name, orientation) {
        if (typeof ALL_78_TAROT_CARDS === 'undefined') return;
        const card = ALL_78_TAROT_CARDS.find(c => c.name === name);
        if (card) showTarotCardModal(card, orientation);
    };

    function showLenormandCardModal(card) {
        closeCardModal();

        const overlay = document.createElement('div');
        overlay.className = 'cx-card-modal-overlay';
        overlay.id = 'cx-card-modal';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCardModal(); });

        overlay.innerHTML = `
            <div class="cx-card-modal">
                <div class="cx-card-modal-header" style="text-align:center;">
                    <button class="cx-card-modal-close" onclick="document.getElementById('cx-card-modal').remove()">✕</button>
                    <div style="font-size:36px; margin-bottom:6px;">${card.icon}</div>
                    <div style="font-size:16px; font-weight:700;">${card.num}. ${card.name}</div>
                    <div style="font-size:11px; opacity:0.85; margin-top:3px;">${card.keyword}</div>
                </div>
                <div class="cx-card-modal-body">
                    <div style="font-size:13px; color:var(--text-primary); line-height:1.8;">
                        ${card.meaning}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    function showCardNotFound(text) {
        closeCardModal();

        const overlay = document.createElement('div');
        overlay.className = 'cx-card-modal-overlay';
        overlay.id = 'cx-card-modal';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCardModal(); });

        const preview = text.length > 30 ? text.slice(0, 30) + '…' : text;

        overlay.innerHTML = `
            <div class="cx-card-modal">
                <div class="cx-card-modal-header" style="text-align:center;">
                    <button class="cx-card-modal-close" onclick="document.getElementById('cx-card-modal').remove()">✕</button>
                    <div style="font-size:28px; margin-bottom:6px;">🔍</div>
                    <div style="font-size:14px; font-weight:600;">未找到对应牌面</div>
                </div>
                <div class="cx-card-modal-body" style="text-align:center;">
                    <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">消息内容：</div>
                    <div style="font-size:13px; color:var(--text-primary); background:var(--primary-bg); padding:8px 12px; border-radius:10px; word-break:break-all;">${preview}</div>
                    <div style="font-size:11px; color:var(--text-secondary); margin-top:12px; line-height:1.6;">
                        支持的格式示例：<br>
                        塔罗：圣杯2正位、权杖ace逆位、愚人0正位<br>
                        雷诺曼：1.骑士、24.心
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    function closeCardModal() {
        const existing = document.getElementById('cx-card-modal');
        if (existing) existing.remove();
    }

    /* ═══════════════════════════════════════════
     *  5. 初始化 & 挂载
     * ═══════════════════════════════════════════ */

    function init() {
        // 1. 跳过声明页
        skipSplash();

        // 注入 CSS
        injectReactionCSS();
        injectSearchCSS();

        // 2. 初始化 emoji 点赞（需要 DOM 就绪）
        waitForElement('#chat-container', () => {
            initReactionDelegate();

            // 3. 拦截 renderMessages，每次渲染后补充 reactions 和搜索按钮
            patchRenderMessages();

            // 首次渲染
            setTimeout(() => {
                renderAllReactions();
                addSearchButtons();
            }, 500);
        });

        // 4. 拦截回信功能
        waitForElement('#envelope-modal', () => {
            patchEnvelopeForTarot();
            patchViewEnvLetter();
        });
    }

    function patchRenderMessages() {
        const origRender = window.renderMessages;
        if (!origRender) return;

        window.renderMessages = function () {
            origRender.apply(this, arguments);
            // 渲染后补充
            setTimeout(() => {
                renderAllReactions();
                addSearchButtons();
            }, 50);
        };
    }

    function waitForElement(selector, callback, maxWait) {
        maxWait = maxWait || 10000;
        const start = Date.now();

        function check() {
            if (document.querySelector(selector)) {
                callback();
            } else if (Date.now() - start < maxWait) {
                setTimeout(check, 200);
            }
        }
        check();
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
