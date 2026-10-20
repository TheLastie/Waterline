(() => {
  if (window.parent === window) return;
  const root = document.documentElement;
  let lastHeight = 0;
  let frame = 0;
  const report = () => {
    frame = 0;
    const body = document.body;
    if (!body) return;
    const height = Math.ceil(Math.max(root.scrollHeight, root.offsetHeight, body.scrollHeight, body.offsetHeight, body.getBoundingClientRect().height));
    if (!height || Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    window.parent.postMessage({ type: 'lastie:preview-size', height }, '*');
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(report); };
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.data?.type === 'lastie:request-preview-size') {
      lastHeight = 0;
      frame = 0;
      report();
    }
  });
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  if (document.body) observer.observe(document.body);
  window.addEventListener('load', schedule, { once: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.fonts?.ready.then(schedule);
  schedule();
})();
