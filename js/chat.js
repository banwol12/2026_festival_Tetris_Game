'use strict';

/**
 * 2026 DigitalArts Tetris Live Chat Client
 * Connects to Cloudflare D1 Chat API with local storage fallback and real-time polling
 */

class ChatClient {
  constructor(audio) {
    this.audio = audio;
    this.apiUrl = typeof CHAT_API_URL !== 'undefined' ? CHAT_API_URL : '/api/chat';
    this.lsKey = 'festival-tetris:chat:v1';
    this.messages = [];
    this.lastId = 0;
    this.isPolling = false;
    this.pollTimer = null;
    this.pollInterval = 3500;
    this.myNickname = this.loadInitialNickname();

    this.containers = {
      start: {
        list: document.getElementById('chat-messages-start'),
        form: document.getElementById('chat-form-start'),
        nameInput: document.getElementById('chat-name-start'),
        textInput: document.getElementById('chat-text-start'),
        countTag: document.getElementById('chat-count-start'),
        emojis: document.querySelector('.chat-quick-emojis[data-target="start"]'),
      },
      over: {
        list: document.getElementById('chat-messages-over'),
        form: document.getElementById('chat-form-over'),
        nameInput: document.getElementById('chat-name-over'),
        textInput: document.getElementById('chat-text-over'),
        countTag: document.getElementById('chat-count-over'),
        emojis: document.querySelector('.chat-quick-emojis[data-target="over"]'),
      },
    };

    this.init();
  }

  loadInitialNickname() {
    try {
      const savedSettings = JSON.parse(localStorage.getItem('festival-tetris:settings') || '{}');
      if (savedSettings.name) return savedSettings.name;
    } catch (_) {}
    return localStorage.getItem('festival-tetris:chat-name') || '';
  }

  setNickname(name) {
    this.myNickname = (name || '').trim().slice(0, 12);
    try {
      localStorage.setItem('festival-tetris:chat-name', this.myNickname);
      const savedSettings = JSON.parse(localStorage.getItem('festival-tetris:settings') || '{}');
      savedSettings.name = this.myNickname;
      localStorage.setItem('festival-tetris:settings', JSON.stringify(savedSettings));
    } catch (_) {}

    // Synchronize both inputs
    if (this.containers.start.nameInput && this.containers.start.nameInput.value !== this.myNickname) {
      this.containers.start.nameInput.value = this.myNickname;
    }
    if (this.containers.over.nameInput && this.containers.over.nameInput.value !== this.myNickname) {
      this.containers.over.nameInput.value = this.myNickname;
    }

    const gameNameInput = document.getElementById('name-input');
    if (gameNameInput && this.myNickname) {
      gameNameInput.value = this.myNickname;
    }
  }

  init() {
    // 1. Load cached messages
    try {
      const cached = JSON.parse(localStorage.getItem(this.lsKey) || '[]');
      if (Array.isArray(cached) && cached.length) {
        this.messages = cached;
        this.lastId = Math.max(0, ...cached.map((m) => m.id || 0));
        this.renderAll();
      }
    } catch (_) {}

    // 2. Set default greetings if empty
    if (!this.messages.length) {
      this.messages = [
        {
          id: 0,
          name: '운영자',
          message: '2026 축제 테트리스에 오신 것을 환영합니다! 🎮 멋진 기록을 세우고 응원을 남겨보세요!',
          created_at: new Date().toISOString(),
          isSystem: true,
        },
      ];
      this.renderAll();
    }

    // 3. Pre-fill nickname inputs
    if (this.containers.start.nameInput) this.containers.start.nameInput.value = this.myNickname;
    if (this.containers.over.nameInput) this.containers.over.nameInput.value = this.myNickname;

    // 4. Setup Event Listeners
    ['start', 'over'].forEach((key) => {
      const c = this.containers[key];
      if (!c.form) return;

      // Nickname blur & change sync
      if (c.nameInput) {
        c.nameInput.addEventListener('input', (e) => {
          this.setNickname(e.target.value);
        });
      }

      // Form submission
      c.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = (c.textInput ? c.textInput.value : '').trim();
        const name = (c.nameInput ? c.nameInput.value : this.myNickname).trim() || '익명';
        if (!text) return;
        this.sendMessage(text, name);
        if (c.textInput) {
          c.textInput.value = '';
          c.textInput.focus();
        }
      });

      // Quick emoji bar
      if (c.emojis) {
        c.emojis.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-emoji]');
          if (!btn) return;
          const emoji = btn.dataset.emoji;
          const name = (c.nameInput ? c.nameInput.value : this.myNickname).trim() || '익명';
          this.sendMessage(emoji, name);
        });
      }
    });

    // 5. Fetch initial data from server
    this.fetchMessages();
    this.startPolling();
  }

  startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      this.fetchMessages(true);
    }, this.pollInterval);
  }

  pausePolling() {
    this.isPolling = false;
    clearInterval(this.pollTimer);
  }

  resumePolling() {
    this.fetchMessages(false);
    this.startPolling();
  }

  saveMessages() {
    try {
      // Keep up to 60 messages in local storage
      const toSave = this.messages.slice(-60);
      localStorage.setItem(this.lsKey, JSON.stringify(toSave));
    } catch (_) {}
  }

  async fetchMessages(incremental = false) {
    try {
      const url = incremental && this.lastId > 0
        ? `${this.apiUrl}?since_id=${this.lastId}&limit=50`
        : `${this.apiUrl}?limit=50`;

      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return;

      const data = await res.json();
      if (!data.success || !Array.isArray(data.messages)) return;

      if (!data.messages.length) return;

      if (incremental && this.lastId > 0) {
        // Append new messages, avoiding duplicates
        const existingIds = new Set(this.messages.map((m) => m.id));
        let hasNew = false;
        for (const msg of data.messages) {
          if (!existingIds.has(msg.id)) {
            this.messages.push(msg);
            existingIds.add(msg.id);
            hasNew = true;
          }
        }
        if (hasNew) {
          this.lastId = Math.max(this.lastId, ...this.messages.map((m) => m.id || 0));
          this.saveMessages();
          this.renderAll(true);
        }
      } else {
        // Full update: merge server messages
        const map = new Map();
        // keep local system greetings
        this.messages.filter((m) => m.isSystem).forEach((m) => map.set(`sys_${m.id}`, m));
        data.messages.forEach((m) => map.set(m.id, m));
        this.messages = Array.from(map.values()).sort((a, b) => (a.id || 0) - (b.id || 0));
        this.lastId = Math.max(0, ...this.messages.map((m) => m.id || 0));
        this.saveMessages();
        this.renderAll(false);
      }
    } catch (_) {
      // network failure: ignore gracefully
    }
  }

  async sendMessage(text, authorName) {
    const name = (authorName || this.myNickname || '익명').trim().slice(0, 12) || '익명';
    this.setNickname(name);

    // Play chime sound
    if (this.audio && typeof this.audio.chatSend === 'function') {
      this.audio.chatSend();
    }

    // Optimistic message
    const tempId = Date.now();
    const optimisticMsg = {
      id: tempId,
      name,
      message: text,
      created_at: new Date().toISOString(),
      isOptimistic: true,
    };

    this.messages.push(optimisticMsg);
    this.renderAll(true, true);

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message: text }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.message) {
          // Replace optimistic message with confirmed server message
          const idx = this.messages.findIndex((m) => m.id === tempId);
          if (idx !== -1) {
            this.messages[idx] = data.message;
            this.lastId = Math.max(this.lastId, data.message.id || 0);
          }
          this.saveMessages();
          this.renderAll(true);
          return;
        }
      }
    } catch (_) {}

    // Offline or fallback: confirm locally
    optimisticMsg.isOptimistic = false;
    this.saveMessages();
    this.renderAll(true);
  }

  formatTime(raw) {
    if (!raw) return '';
    let str = String(raw);
    if (!str.includes('T') && !str.endsWith('Z')) {
      str = str.replace(' ', 'T') + 'Z';
    }
    const d = new Date(str);
    if (isNaN(d.getTime())) return '';

    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);
    if (diffSec >= 0 && diffSec < 60) return '방금 전';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin >= 0 && diffMin < 60) return `${diffMin}분 전`;

    const pad = (n) => String(n).padStart(2, '0');
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());

    if (d.toDateString() === now.toDateString()) {
      return `${hh}:${mm}`;
    }
    return `${d.getMonth() + 1}.${d.getDate()} ${hh}:${mm}`;
  }

  getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 75%, 55%)`;
  }

  escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  renderAll(scrollSmooth = false, forceScroll = false) {
    ['start', 'over'].forEach((key) => {
      const c = this.containers[key];
      if (!c.list) return;

      const wasNearBottom = forceScroll || (
        c.list.scrollHeight - c.list.scrollTop - c.list.clientHeight < 70
      );

      const html = this.messages.map((m) => {
        const isMe = this.myNickname && m.name === this.myNickname;
        const isOperator = m.name === '운영자' || m.name === '개발자' || m.name === 'Admin';
        const color = isOperator ? '#ffd700' : this.getAvatarColor(m.name);
        const initial = (m.name.charAt(0) || '?').toUpperCase();
        const timeStr = this.formatTime(m.created_at);

        let badgeHtml = '';
        if (isOperator) {
          badgeHtml = '<span class="chat-badge op">STAFF</span>';
        } else if (isMe) {
          badgeHtml = '<span class="chat-badge me">나</span>';
        }

        return (
          `<div class="chat-msg-item ${isMe ? 'me' : ''} ${m.isOptimistic ? 'sending' : ''}">` +
            `<div class="chat-avatar" style="background: ${color};" title="${this.escapeHtml(m.name)}">${this.escapeHtml(initial)}</div>` +
            `<div class="chat-msg-body">` +
              `<div class="chat-msg-meta">` +
                `<span class="chat-msg-author">${this.escapeHtml(m.name)}</span>` +
                badgeHtml +
                `<span class="chat-msg-time">${timeStr}</span>` +
              `</div>` +
              `<div class="chat-msg-text">${this.escapeHtml(m.message)}</div>` +
            `</div>` +
          `</div>`
        );
      }).join('');

      c.list.innerHTML = html;

      if (c.countTag) {
        const msgCount = this.messages.filter((m) => !m.isSystem).length;
        c.countTag.textContent = msgCount > 0 ? `${msgCount}개의 메시지` : '실시간';
      }

      if (wasNearBottom) {
        c.list.scrollTo({
          top: c.list.scrollHeight,
          behavior: scrollSmooth ? 'smooth' : 'auto',
        });
      }
    });
  }
}

window.ChatClient = ChatClient;
