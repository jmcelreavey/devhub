/**
 * Shape-checked adapter for Paseo's web-only paste effect. The upstream
 * attachment conversion and draft store remain responsible for persisted images.
 */
export function installPasteGuard(input, latest, collect, convert) {
  if (!input) return;
  const root = input.closest('[data-testid="message-input-root"]') || input.parentElement;
  let pending = 0, disposed = false, notice, dismissTimer;
  const record = (stage, detail = {}) => {
    const entries = window.__devhubPasteDiagnostics ||= [];
    entries.push({ at: new Date().toISOString(), stage, ...detail });
    if (entries.length > 50) entries.splice(0, entries.length - 50);
  };
  const show = (message, failed = false) => {
    clearTimeout(dismissTimer);
    notice?.remove();
    notice = document.createElement("div");
    notice.dataset.devhubPasteStatus = "true";
    notice.setAttribute("role", failed ? "alert" : "status");
    notice.style.cssText = "position:fixed;bottom:150px;right:24px;max-width:390px;z-index:9999;padding:12px 14px;border:1px solid GrayText;border-radius:8px;background:Canvas;color:CanvasText;font:13px system-ui;box-shadow:0 4px 20px #0003";
    const text = document.createElement("p");
    text.textContent = message;
    text.style.margin = "0 0 8px";
    notice.appendChild(text);
    if (failed) {
      const picker = document.createElement("button");
      picker.type = "button"; picker.textContent = "Use attachment picker";
      picker.onclick = () => { document.querySelector('[data-testid="message-input-attach-button"]')?.click(); notice?.remove(); };
      notice.appendChild(picker);
    }
    const dismiss = document.createElement("button");
    dismiss.type = "button"; dismiss.textContent = "Dismiss";
    dismiss.style.marginLeft = failed ? "12px" : "0";
    dismiss.onclick = () => notice?.remove();
    notice.appendChild(dismiss);
    const details = document.createElement("details"), summary = document.createElement("summary"), diagnostics = document.createElement("pre");
    summary.textContent = "Paste details";
    details.style.marginTop = "8px";
    diagnostics.style.cssText = "white-space:pre-wrap;max-height:160px;overflow:auto;font-size:11px";
    diagnostics.textContent = JSON.stringify(window.__devhubPasteDiagnostics.slice(-8), null, 2);
    details.addEventListener("toggle", () => { clearTimeout(dismissTimer); if (!failed && !details.open && !pending) dismissTimer = setTimeout(() => notice?.remove(), 3500); });
    details.appendChild(summary); details.appendChild(diagnostics); notice.appendChild(details);
    document.body.appendChild(notice);
    if (!failed && !pending) dismissTimer = setTimeout(() => notice?.remove(), 3500);
  };
  const block = event => {
    if (!pending) return;
    const submitKey = event.type === "keydown" && event.key === "Enter" && !event.shiftKey;
    // Mark the upstream send/queue control; stopping work remains available.
    const submitClick = event.type === "click" && event.target?.closest?.('[data-testid="devhub-message-submit"],[data-testid="new-workspace-launch-submit"],[data-testid="workspace-create-submit"]');
    if (!submitKey && !submitClick) return;
    event.preventDefault(); event.stopImmediatePropagation();
    show("Finishing the pasted image before sending…");
    record("send-held");
  };
  const paste = async event => {
    const files = collect(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    record("received", { files: files.map(item => ({ mime: item.mimeType, bytes: item.file?.size ?? 0 })) });
    const state = latest.current;
    if (!state.isConnected || state.disabled || state.isDictating || state.isRealtimeVoiceForCurrentAgent || !state.onAddImages) {
      record("error", { reason: "composer-unavailable" });
      show(!state.isConnected ? "The screenshot was not added. Reconnect Paseo, then paste again or use the attachment picker." : "The screenshot was not added. Finish the current voice or composer action, then paste again.", true);
      return;
    }
    const callback = state.onAddImages, location = window.location.href;
    pending++;
    show(pending === 1 ? "Adding the pasted image…" : "Adding pasted images…");
    record("converting");
    let timeout;
    try {
      const images = await Promise.race([
        convert(files),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("conversion-timeout")), 15_000); }),
      ]);
      if (disposed || !input.isConnected || window.location.href !== location || latest.current.onAddImages !== callback) throw new Error("chat-changed");
      if (!images.length) throw new Error("conversion-failed");
      callback(images);
      // Wait for the official draft's attachment thumbnails to commit before send.
      await new Promise(resolve => {
        const commitTimeout = setTimeout(resolve, 1000);
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(commitTimeout); resolve(); }));
      });
      record("added", { count: images.length, attachmentIds: images.map(image => image.id ?? image.attachmentId).filter(id => typeof id === "string") });
      show(images.length !== files.length ? "Some screenshots could not be added. Check the thumbnails and add the missing images with the attachment picker." : images.length + " image" + (images.length === 1 ? "" : "s") + " ready.", images.length !== files.length);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "conversion-failed";
      record("error", { reason: ["chat-changed", "conversion-timeout"].includes(reason) ? reason : "conversion-failed" });
      show(reason === "chat-changed" ? "The chat changed before the screenshot was added. Paste again in the intended chat." : "The screenshot could not be added. Paste again or use the attachment picker.", true);
    } finally {
      clearTimeout(timeout);
      pending--;
      if (pending && !disposed) show("Finishing the remaining pasted images…");
      else if (notice?.getAttribute("role") === "status") dismissTimer = setTimeout(() => notice?.remove(), 3500);
    }
  };
  input.addEventListener("paste", paste);
  root?.addEventListener("keydown", block, true);
  root?.addEventListener("click", block, true);
  return () => {
    disposed = true;
    clearTimeout(dismissTimer);
    input.removeEventListener("paste", paste);
    root?.removeEventListener("keydown", block, true);
    root?.removeEventListener("click", block, true);
    if (!pending) notice?.remove();
  };
}

const MARKER = "/* devhub-paste-v1:start */";
const END = "/* devhub-paste-v1:end */";
const count = (source, text) => source.split(text).length - 1;

// Match the whole known effect, allowing module and prop aliases to change between builds.
// A changed implementation must be reviewed; the daemon's release number is irrelevant.
function pasteEffect(bundle) {
  const pattern = /function (\w+)\(e\)\{const t=\(0,(\w+)\.c\)\(8\),\{textarea:(\w+),isConnected:(\w+),disabled:(\w+),isDictating:(\w+),isRealtimeVoiceForCurrentAgent:(\w+),onAddImages:(\w+)\}=e;[\s\S]{0,1500}?\(0,(\w+)\.useEffect\)\(f,h\)\}/g;
  const compatible = [];
  for (const match of bundle.matchAll(pattern)) {
    const [source, hook, compiler, input, connected, disabled, dictating, voice, add, react] = match;
    const platform = source.match(/if\(!([\w]+)\.isWeb\|\|!/)?.[1];
    const attachments = source.match(/\(0,(\w+)\.collectImageFilesFromClipboardData\)/)?.[1];
    const report = source.match(/\.catch\((\w+)\)\)/)?.[1];
    if (!platform || !attachments || !report) continue;
    const expected = `function ${hook}(e){const t=(0,${compiler}.c)(8),{textarea:${input},isConnected:${connected},disabled:${disabled},isDictating:${dictating},isRealtimeVoiceForCurrentAgent:${voice},onAddImages:${add}}=e;let f,h;t[0]!==${disabled}||t[1]!==${connected}||t[2]!==${dictating}||t[3]!==${voice}||t[4]!==${add}||t[5]!==${input}?(f=()=>{if(!${platform}.isWeb||!${add})return;if(!${input})return;let e=!1;const t=t=>{if(!${connected}||${disabled}||${dictating}||${voice})return;const n=(0,${attachments}.collectImageFilesFromClipboardData)(t.clipboardData);0!==n.length&&(t.preventDefault(),(0,${attachments}.filesToImageAttachments)(n).then(t=>{e||0===t.length||${add}(t)}).catch(${report}))};return ${input}.addEventListener("paste",t),()=>{e=!0,${input}.removeEventListener?.("paste",t)}},h=[${disabled},${input},${connected},${dictating},${voice},${add}],t[0]=${disabled},t[1]=${connected},t[2]=${dictating},t[3]=${voice},t[4]=${add},t[5]=${input},t[6]=f,t[7]=h):(f=t[6],h=t[7]),(0,${react}.useEffect)(f,h)}`;
    if (source === expected) compatible.push({ source, hook, react, platform, attachments });
  }
  return compatible.length === 1 ? compatible[0] : null;
}

function submitControl(bundle) {
  const pattern = /\{shouldShow:(\w+),canPressLoadingButton:(\w+),onSubmitLoadingPress:(\w+),onDefaultSendAction:(\w+),isSendButtonDisabled:u,submitAccessibilityLabel:b,sendButtonCombinedStyle:p,isSubmitLoading:f,submitIcon:h,submitLabel:y,submitButtonTestID:(\w+),buttonIconSize:\w+,sendKeys:x,sendTooltipLabel:C\}=e;if\(!\1\)return null;const I=\2\?\3:\4;/g;
  const matches = [...bundle.matchAll(pattern)];
  if (matches.length !== 1) return null;
  const [, , stop, , , testId] = matches[0];
  const original = `onPress:I,disabled:u,accessibilityLabel:b,accessibilityRole:"button",testID:${testId},style:p,children:R`;
  const marked = original.replace("testID:" + testId, `testID:${testId}??(${stop}?undefined:"devhub-message-submit")`);
  if (count(bundle, original) + count(bundle, marked) !== 1) return null;
  return { original, marked };
}

export function withPasteGuard(bundle) {
  const control = submitControl(bundle);
  if (!control) return null;
  const start = bundle.indexOf(MARKER), end = bundle.indexOf(END);
  const marked = start !== -1 || end !== -1;
  let effect;
  if (marked) {
    if (count(bundle, MARKER) !== 1 || count(bundle, END) !== 1 || end <= start) return null;
    const source = bundle.slice(start + MARKER.length, end);
    const hook = source.match(/function (\w+)\(e\)\{const latest=\(0,(\w+)\.useRef\)\(e\);latest.current=e;\(0,\2\.useEffect\)\(\(\)=>(([\w]+)\.isWeb)\?installPasteGuard\(e.textarea,latest,(\w+)\.collectImageFilesFromClipboardData,\5\.filesToImageAttachments\):undefined,\[e.textarea\]\);\}$/);
    if (!source.startsWith("function installPasteGuard(") || !hook) return null;
    effect = { hook: hook[1], react: hook[2], platform: hook[4], attachments: hook[5] };
  } else {
    effect = pasteEffect(bundle);
    if (!effect || count(bundle, control.marked)) return null;
  }
  const { hook, react, platform, attachments } = effect;
  const replacement = MARKER + installPasteGuard.toString() + `function ${hook}(e){const latest=(0,${react}.useRef)(e);latest.current=e;(0,${react}.useEffect)(()=>${platform}.isWeb?installPasteGuard(e.textarea,latest,${attachments}.collectImageFilesFromClipboardData,${attachments}.filesToImageAttachments):undefined,[e.textarea]);}` + END;
  const patched = marked ? bundle.slice(0, start) + replacement + bundle.slice(end + END.length) :
    bundle.replace(effect.source, () => replacement);
  return patched.replace(control.original, control.marked);
}
