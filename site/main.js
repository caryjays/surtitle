const examples = {
  'en-ja': { source: "Let's build something together.", translation: '一緒に何かを作りましょう。', sourceLang: 'en', targetLang: 'ja' },
  'ja-en': { source: '一緒に何かを作りましょう。', translation: "Let's build something together.", sourceLang: 'ja', targetLang: 'en' },
};

document.querySelectorAll('[data-direction]').forEach(button => {
  button.addEventListener('click', () => {
    const example = examples[button.dataset.direction];
    document.querySelectorAll('[data-direction]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    const source = document.querySelector('#demo-source');
    const translation = document.querySelector('#demo-translation');
    source.textContent = example.source;
    source.lang = example.sourceLang;
    translation.textContent = example.translation;
    translation.lang = example.targetLang;
    // Restart the short entrance animation; reading offsetWidth applies the removal first.
    const overlay = source.parentElement;
    overlay.classList.remove('swap');
    void overlay.offsetWidth;
    overlay.classList.add('swap');
  });
});

const baseCommands = ['git clone https://github.com/caryjays/surtitle.git', 'cd surtitle', 'pnpm install', 'pnpm local:setup'];
const profiles = {
  local: { commands: [...baseCommands, 'pnpm dev:local'], note: 'Local recognition · Translation off · No API key' },
  offline: { commands: [...baseCommands, 'pnpm local:setup-translator', 'pnpm preflight:offline', 'pnpm dev:offline'], note: 'Local recognition + translation · Extra model download: about 3 GB' },
};
let profile = profiles.local;

document.querySelectorAll('[data-profile]').forEach(button => {
  button.addEventListener('click', () => {
    profile = profiles[button.dataset.profile];
    document.querySelectorAll('[data-profile]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    // One element per command, so a long command wraps under itself on a narrow screen.
    document.querySelector('#setup-code').replaceChildren(...profile.commands.map(command => {
      const line = document.createElement('span');
      line.className = 'line';
      line.textContent = command;
      return line;
    }));
    document.querySelector('#profile-note').textContent = profile.note;
    document.querySelector('#copy-status').textContent = '';
  });
});

const statusTimers = new WeakMap();
async function copyText(value, status, selectable) {
  clearTimeout(statusTimers.get(status));
  try {
    await navigator.clipboard.writeText(value);
    status.textContent = 'Copied to clipboard.';
    statusTimers.set(status, setTimeout(() => { status.textContent = ''; }, 2500));
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(selectable);
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent = 'Select and copy the highlighted text.';
  }
}

document.querySelector('#copy-command').addEventListener('click', () => {
  void copyText(profile.commands.join('\n'), document.querySelector('#copy-status'), document.querySelector('#setup-code'));
});
document.querySelector('#copy-overlay').addEventListener('click', () => {
  const code = document.querySelector('.url-box code');
  void copyText(code.textContent, document.querySelector('#overlay-copy-status'), code);
});
