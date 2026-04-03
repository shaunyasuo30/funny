(() => {
  const VIDEO_TRIGGER_PATTERN = /never/i;
  const CLOSE_TAB_TRIGGER_PATTERN = /main/i;
  const CLOSE_TAB_KEYWORD = "main";
  const YOUTUBE_VIDEO_ID = "hPr-Yc92qaY";
  const RETRIGGER_COOLDOWN_MS = 900;
  const USER_GESTURE_WINDOW_MS = 4000;
  const SCAN_INTERVAL_MS = 320;
  const SCAN_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
  const MAX_SCANNED_EDITABLES = 450;

  let overlay = null;
  let videoFrame = null;
  let lastVideoTriggerText = "";
  let lastVideoTriggerAt = 0;
  let lastCloseTriggerText = "";
  let lastCloseTriggerAt = 0;
  let lastUserGestureAt = 0;
  let closeTabRequested = false;
  let keyBuffer = "";

  function sendYouTubeCommand(command, args = []) {
    if (!videoFrame || !videoFrame.contentWindow) {
      return;
    }

    const message = JSON.stringify({
      event: "command",
      func: command,
      args
    });
    videoFrame.contentWindow.postMessage(message, "*");
  }

  function markUserGesture() {
    lastUserGestureAt = Date.now();
  }

  function tryUnmuteVideo(force = false) {
    if (!force && Date.now() - lastUserGestureAt > USER_GESTURE_WINDOW_MS) {
      return;
    }
    sendYouTubeCommand("unMute");
    sendYouTubeCommand("setVolume", [100]);
    sendYouTubeCommand("playVideo");
  }

  function resolveEditableTarget(node) {
    if (!node) {
      return null;
    }

    let element = null;
    if (node instanceof Element) {
      element = node;
    } else if (node instanceof Node) {
      element = node.parentElement;
    }

    if (!(element instanceof Element)) {
      return null;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element;
    }

    if (element.isContentEditable || element.getAttribute("role") === "textbox") {
      return element;
    }

    return element.closest('[contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  }

  function getDeepActiveElement(root) {
    let active = root.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  function getFallbackEditableTarget() {
    return resolveEditableTarget(getDeepActiveElement(document));
  }

  function getEditableTargetFromEvent(event) {
    if (typeof event.composedPath === "function") {
      const path = event.composedPath();
      for (const node of path) {
        const candidate = resolveEditableTarget(node);
        if (candidate) {
          return candidate;
        }
      }
    }

    return resolveEditableTarget(event.target) || getFallbackEditableTarget();
  }

  function isSupportedInputType(inputEl) {
    const inputType = (inputEl.type || "text").toLowerCase();
    const nonTextTypes = new Set([
      "button",
      "checkbox",
      "color",
      "date",
      "datetime-local",
      "file",
      "hidden",
      "image",
      "month",
      "radio",
      "range",
      "reset",
      "submit",
      "time",
      "week"
    ]);
    return !nonTextTypes.has(inputType);
  }

  function isEditable(target) {
    if (!target) {
      return false;
    }

    if (target instanceof HTMLTextAreaElement) {
      return !target.readOnly && !target.disabled;
    }

    if (target instanceof HTMLInputElement) {
      if (!isSupportedInputType(target)) {
        return false;
      }
      return !target.readOnly && !target.disabled;
    }

    return target.isContentEditable || target.getAttribute("role") === "textbox";
  }

  function isElementVisible(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(target);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    return target.getClientRects().length > 0;
  }

  function getCurrentText(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.value || "";
    }

    const lexicalNodes = target.querySelectorAll('[data-lexical-text="true"]');
    if (lexicalNodes.length > 0) {
      return Array.from(lexicalNodes, (node) => node.textContent || "").join(" ");
    }

    return target.textContent || target.innerText || "";
  }

  function normalizeText(text) {
    return (text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .trim();
  }

  function shouldShowVideo(rawText) {
    const text = normalizeText(rawText);
    if (!VIDEO_TRIGGER_PATTERN.test(text)) {
      return false;
    }

    if (overlay && overlay.classList.contains("hello-meme-show")) {
      return false;
    }

    const normalized = text.toLowerCase();
    const now = Date.now();
    if (normalized === lastVideoTriggerText && now - lastVideoTriggerAt < RETRIGGER_COOLDOWN_MS) {
      return false;
    }

    lastVideoTriggerText = normalized;
    lastVideoTriggerAt = now;
    return true;
  }

  function shouldCloseTab(rawText) {
    const text = normalizeText(rawText);
    if (!CLOSE_TAB_TRIGGER_PATTERN.test(text)) {
      return false;
    }

    const normalized = text.toLowerCase();
    const now = Date.now();
    if (normalized === lastCloseTriggerText && now - lastCloseTriggerAt < RETRIGGER_COOLDOWN_MS) {
      return false;
    }

    lastCloseTriggerText = normalized;
    lastCloseTriggerAt = now;
    return true;
  }

  function requestCloseCurrentTab() {
    if (closeTabRequested) {
      return;
    }
    closeTabRequested = true;

    setTimeout(() => {
      closeTabRequested = false;
    }, 1200);

    try {
      if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
        chrome.runtime.sendMessage({ type: "close-current-tab" }, () => {
          if (chrome.runtime.lastError) {
            // Ignore; fallback below may still work on some pages.
          }
        });
      }
    } catch (_) {
      // Ignore errors in unsupported contexts.
    }

    // Fallback for contexts where extension tab-close is blocked.
    setTimeout(() => {
      try {
        window.close();
      } catch (_) {
        // Ignore.
      }
    }, 120);
  }

  function updateKeyBufferFromEvent(event, editableTarget) {
    if (!event || !event.isTrusted || !editableTarget) {
      return;
    }

    if (event.key === "Escape") {
      keyBuffer = "";
      return;
    }

    if (event.key === "Backspace") {
      keyBuffer = keyBuffer.slice(0, -1);
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      keyBuffer = "";
      return;
    }

    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    keyBuffer = (keyBuffer + event.key.toLowerCase()).slice(-24);
    if (keyBuffer.includes(CLOSE_TAB_KEYWORD)) {
      requestCloseCurrentTab();
    }
  }

  function getEmbedUrl() {
    const origin = window.location.origin || "https://www.facebook.com";
    const referrer = window.location.href || origin;
    const params = new URLSearchParams({
      autoplay: "1",
      mute: "1",
      controls: "0",
      disablekb: "1",
      fs: "0",
      iv_load_policy: "3",
      modestbranding: "1",
      playsinline: "1",
      rel: "0",
      cc_load_policy: "0",
      loop: "1",
      playlist: YOUTUBE_VIDEO_ID,
      enablejsapi: "1",
      origin,
      widget_referrer: referrer
    });
    return `https://www.youtube.com/embed/${YOUTUBE_VIDEO_ID}?${params.toString()}`;
  }

  function stopVideo() {
    if (videoFrame) {
      videoFrame.src = "about:blank";
    }
  }

  function hideOverlay() {
    if (!overlay) {
      return;
    }

    overlay.classList.remove("hello-meme-show");
    stopVideo();
  }

  function ensureOverlay() {
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "hello-meme-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const frameShell = document.createElement("div");
    frameShell.className = "hello-meme-frame-shell";

    videoFrame = document.createElement("iframe");
    videoFrame.className = "hello-meme-iframe";
    videoFrame.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
    videoFrame.allowFullscreen = true;
    videoFrame.referrerPolicy = "unsafe-url";
    videoFrame.loading = "eager";
    videoFrame.src = "about:blank";
    videoFrame.addEventListener("load", () => {
      setTimeout(() => {
        sendYouTubeCommand("playVideo");
      }, 250);
      setTimeout(() => {
        sendYouTubeCommand("playVideo");
      }, 800);
    });

    const topLeftMask = document.createElement("div");
    topLeftMask.className = "hello-meme-mask hello-meme-mask-top-left";

    const topRightMask = document.createElement("div");
    topRightMask.className = "hello-meme-mask hello-meme-mask-top-right";

    const bottomMask = document.createElement("div");
    bottomMask.className = "hello-meme-mask hello-meme-mask-bottom";

    frameShell.appendChild(videoFrame);
    overlay.appendChild(frameShell);
    overlay.appendChild(topLeftMask);
    overlay.appendChild(topRightMask);
    overlay.appendChild(bottomMask);
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function showMemeVideo() {
    const el = ensureOverlay();

    if (videoFrame) {
      videoFrame.src = getEmbedUrl();
      setTimeout(() => {
        sendYouTubeCommand("mute");
        sendYouTubeCommand("playVideo");
      }, 100);
    }

    el.classList.add("hello-meme-show");
  }

  function evaluateEditableTarget(target) {
    if (!isEditable(target) || !isElementVisible(target)) {
      return false;
    }

    const currentText = getCurrentText(target);
    if (shouldCloseTab(currentText)) {
      requestCloseCurrentTab();
      return true;
    }

    if (shouldShowVideo(currentText)) {
      showMemeVideo();
      return true;
    }

    return false;
  }

  function handleEvent(event) {
    if (event && event.isTrusted) {
      markUserGesture();
    }

    const editableTarget = getEditableTargetFromEvent(event) || getFallbackEditableTarget();
    if (!editableTarget) {
      return;
    }

    if (event && event.type === "keydown") {
      updateKeyBufferFromEvent(event, editableTarget);
    }

    evaluateEditableTarget(editableTarget);
  }

  function evaluateActiveEditable() {
    const editableTarget = getFallbackEditableTarget();
    if (!editableTarget) {
      return;
    }

    evaluateEditableTarget(editableTarget);
  }

  function scanPageEditables() {
    if (overlay && overlay.classList.contains("hello-meme-show")) {
      return;
    }

    const nodes = document.querySelectorAll(SCAN_SELECTOR);
    const total = Math.min(nodes.length, MAX_SCANNED_EDITABLES);
    for (let i = 0; i < total; i += 1) {
      if (evaluateEditableTarget(nodes[i])) {
        break;
      }
    }
  }

  document.addEventListener("keydown", (event) => {
    if (event.isTrusted) {
      markUserGesture();
    }

    if ((event.key === "m" || event.key === "M") && overlay && overlay.classList.contains("hello-meme-show")) {
      tryUnmuteVideo(true);
    }

    if (event.key === "Escape") {
      hideOverlay();
    }
  }, true);

  const events = ["keydown", "input", "keyup", "change", "paste", "compositionend", "beforeinput"];
  for (const eventName of events) {
    document.addEventListener(eventName, handleEvent, true);
  }

  document.addEventListener("focusin", evaluateActiveEditable, true);
  document.addEventListener("selectionchange", evaluateActiveEditable, true);
  setInterval(() => {
    evaluateActiveEditable();
    scanPageEditables();
  }, SCAN_INTERVAL_MS);
})();
