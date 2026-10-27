// A single-choice list that slides over the right side of a screen. The owning
// screen routes keys to onKey() while isOpen.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';

const VISIBLE = 11; // rows that fit in .choice-list
const ROW = 68;     // .choice-picker .tracks-opt height + margin

export class Picker {
  constructor(parent) {
    this.el = h('div', 'choice-picker hidden', parent);
    this.head = h('div', 'choice-head', this.el);
    const viewport = h('div', 'choice-list', this.el);
    this.list = h('div', 'choice-track', viewport);
    this.options = [];
    this.index = 0;
    this.onPick = null;
  }

  get isOpen() {
    return !this.el.classList.contains('hidden');
  }

  // options: [{ label, on, value }]
  open(title, options, onPick) {
    setText(this.head, title);
    this.options = options;
    this.onPick = onPick;
    this.index = Math.max(0, options.findIndex(o => o.on));
    this.list.innerHTML = '';
    options.forEach(o => {
      o.el = h('div', 'tracks-opt' + (o.detail ? ' two-line' : ''), this.list);
      if (o.detail) {
        h('div', 'tracks-opt-label', o.el).textContent = o.label;
        h('div', 'tracks-opt-detail', o.el).textContent = o.detail;
      } else {
        o.el.textContent = o.label;
      }
      toggleClass(o.el, 'on', !!o.on);
    });
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.el.classList.add('hidden');
  }

  render() {
    this.options.forEach((o, i) => toggleClass(o.el, 'focus', i === this.index));
    const first = Math.max(0, Math.min(this.index - (VISIBLE >> 1), this.options.length - VISIBLE));
    setTransform(this.list, 'translateY(' + (-first * ROW) + 'px)');
  }

  onKey(action) {
    if (action === 'up') this.index = Math.max(0, this.index - 1);
    else if (action === 'down') this.index = Math.min(this.options.length - 1, this.index + 1);
    else if (action === 'back' || action === 'left') { this.close(); return true; }
    else if (action === 'enter') {
      const o = this.options[this.index];
      this.close();
      if (o && this.onPick) this.onPick(o.value);
      return true;
    }
    this.render();
    return true;
  }
}
