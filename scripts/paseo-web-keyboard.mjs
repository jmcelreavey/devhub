/** Keep hardware-keyboard send behaviour when the embedded composer uses its compact layout. */
export function installComposerKeyboard(document, enabled) {
  const onKey = event => {
    if (!enabled() || event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.keyCode === 229 || event.repeat) return;
    const input = event.target;
    if (!input?.matches?.('textarea, [contenteditable="true"]')) return;
    const root = input.closest('[data-testid="message-input-root"]');
    // Only Send/Queue is marked; stopping work must remain a separate action.
    const submit = root?.querySelector('[data-testid="devhub-message-submit"], [data-testid="new-workspace-launch-submit"], [data-testid="workspace-create-submit"]');
    if (!submit || submit.disabled || submit.getAttribute("aria-disabled") === "true" || !submit.getClientRects().length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submit.click();
  };
  // Let the composer handle autocomplete and its own shortcuts first.
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}

/** Identify the upstream submit control for the compact keyboard bridge without replacing its handlers. */
export function markComposerSubmitControl(bundle) {
  const pattern = /\{shouldShow:(\w+),canPressLoadingButton:(\w+),onSubmitLoadingPress:(\w+),onDefaultSendAction:(\w+),isSendButtonDisabled:u,submitAccessibilityLabel:b,sendButtonCombinedStyle:p,isSubmitLoading:f,submitIcon:h,submitLabel:y,submitButtonTestID:(\w+),buttonIconSize:\w+,sendKeys:x,sendTooltipLabel:C\}=e;if\(!\1\)return null;const I=\2\?\3:\4;/g;
  const matches = [...bundle.matchAll(pattern)];
  if (matches.length !== 1) return bundle;
  const [, , stop, , , testId] = matches[0];
  const original = `onPress:I,disabled:u,accessibilityLabel:b,accessibilityRole:"button",testID:${testId},style:p,children:R`;
  if (bundle.split(original).length !== 2) return bundle;
  return bundle.replace(original, original.replace("testID:" + testId, `testID:${testId}??(${stop}?undefined:"devhub-message-submit")`));
}
