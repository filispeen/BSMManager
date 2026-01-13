(() => {
  if (window.__bsmOneClickCleaner) {
    return;
  }
  window.__bsmOneClickCleaner = true;

  let debounceTimeout;
  const DEBOUNCE_DELAY = 100;

  const removeOneClick = () => {
    const links = document.querySelectorAll('a[title="One-Click"]');
    for (const link of links) {
      link.remove();
    }
  };

  const removeLoginListItem = () => {
    const loginLink = document.querySelector('a[href="/login"]');
    if (!loginLink) {
      return;
    }
    const item = loginLink.closest("li");
    if (item) {
      item.remove();
    }
  };

  const cleanup = () => {
    removeOneClick();
    removeLoginListItem();
  };

  const debouncedCleanup = () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(cleanup, DEBOUNCE_DELAY);
  };

  cleanup();

  const observer = new MutationObserver(debouncedCleanup);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
