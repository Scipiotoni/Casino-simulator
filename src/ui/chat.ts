import type { Game, ChatLine } from '../game/game';
import { h } from './dom';
import { audio } from '../core/audio';

/**
 * The chat box (bottom left): new lines show for a while and fade; press Enter (or T, or
 * tap 💬) to open it, type, and Enter to send to everyone online. Esc closes it.
 */
export class ChatBox {
  readonly el: HTMLElement;
  private log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  private input: HTMLInputElement;
  private form: HTMLElement;
  private btn: HTMLButtonElement;
  open = false;

  constructor(private game: Game, private isBlocked: () => boolean) {
    this.input = h('input', { class: 'chat-input', type: 'text', maxLength: 120, placeholder: 'Say something to everyone… (Enter to send)', 'aria-label': 'Chat message' }) as HTMLInputElement;
    this.form = h('div', { class: 'chat-form', hidden: true }, this.input,
      h('button', { class: 'btn small gold', text: 'Send', onClick: () => this.send() }));
    this.btn = h('button', { class: 'chat-btn', text: '💬', title: 'Chat (Enter)', 'aria-label': 'Open chat', onClick: () => (this.open ? this.close() : this.show()) }) as HTMLButtonElement;
    this.el = h('div', { class: 'chat' }, this.log, this.form, this.btn);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        this.send();
        this.close();
      } else if (e.key === 'Escape') this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (this.open || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.code === 'Enter' || e.code === 'KeyT') && !this.isBlocked() && game.state === 'playing') {
        e.preventDefault();
        this.show();
      }
    });
    game.events.on('chat', (l) => this.add(l));
  }

  private add(l: ChatLine): void {
    const line = h('div', { class: `chat-line${l.me ? ' me' : ''}${l.system ? ' sys' : ''}` },
      l.system ? null : h('b', { text: `${l.from}: ` }), h('span', { text: l.text }));
    this.log.appendChild(line);
    while (this.log.children.length > 40) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    // Fades out after a while unless the chat is open.
    window.setTimeout(() => line.classList.add('old'), 15000);
    if (!l.me && !l.system) audio.play('blip', { volume: 0.4, pitch: 1.4 });
  }

  show(): void {
    this.open = true;
    this.el.classList.add('open');
    this.form.hidden = false;
    this.game.input.exitLock();
    this.log.scrollTop = this.log.scrollHeight;
    window.setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    this.open = false;
    this.el.classList.remove('open');
    this.form.hidden = true;
    this.input.value = '';
    this.input.blur();
  }

  private send(): void {
    const v = this.input.value;
    this.input.value = '';
    if (v.trim()) this.game.sendChat(v);
  }
}
