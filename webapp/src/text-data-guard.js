function installTextDataGuard() {
  if (
    typeof Text === 'undefined' ||
    !Text.prototype ||
    Text.prototype.__ytafTextDataGuardInstalled
  ) {
    return;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(Text.prototype, 'data');

    if (descriptor && descriptor.configurable === false) {
      console.warn('[ytaf] Text.prototype.data is not configurable, guard skipped');
      return;
    }

    Object.defineProperty(Text.prototype, '__ytafTextDataGuardInstalled', {
      value: true,
      configurable: true
    });

    Object.defineProperty(Text.prototype, 'data', {
      get() {
        return this.textContent;
      },
      set(value) {
        this.textContent = value;

        if (!this.parentNode) {
          return;
        }

        const marker = document.createTextNode('');
        this.parentNode.appendChild(marker);
        this.parentNode.removeChild(marker);
      },
      configurable: true
    });
  } catch (err) {
    console.warn('[ytaf] Text.prototype.data guard skipped:', err);
  }
}

installTextDataGuard();
