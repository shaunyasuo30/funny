(() => {
  const DEFAULT_VIDEO_ID = "hPr-Yc92qaY";
  const frame = document.getElementById("player-frame");
  if (!(frame instanceof HTMLIFrameElement)) {
    return;
  }

  function pickOrigin(rawOrigin) {
    if (!rawOrigin) {
      return "";
    }
    try {
      const parsed = new URL(rawOrigin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch (_) {
      return "";
    }
    return "";
  }

  const params = new URLSearchParams(window.location.search);
  const rawVideoId = params.get("v") || DEFAULT_VIDEO_ID;
  const queryOrigin = pickOrigin(params.get("origin"));
  const referrerOrigin = (() => {
    try {
      return pickOrigin(new URL(document.referrer || "").origin);
    } catch (_) {
      return "";
    }
  })();
  const origin = queryOrigin || referrerOrigin || "https://www.youtube.com";
  const safeVideoId = /^[a-zA-Z0-9_-]{6,20}$/.test(rawVideoId) ? rawVideoId : DEFAULT_VIDEO_ID;

  const embedParams = new URLSearchParams({
    autoplay: "1",
    controls: "0",
    disablekb: "1",
    fs: "0",
    iv_load_policy: "3",
    modestbranding: "1",
    playsinline: "1",
    rel: "0",
    cc_load_policy: "0",
    loop: "1",
    playlist: safeVideoId,
    enablejsapi: "1",
    origin,
    widget_referrer: origin
  });

  frame.src = `https://www.youtube.com/embed/${safeVideoId}?${embedParams.toString()}`;
})();
