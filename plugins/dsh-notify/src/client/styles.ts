export const STYLE_ID = 'dsh-notify-style'

export const cssText = `
.dsh_notify_settings { display:flex; flex-direction:column; gap:14px; min-width:0; }
.dsh_notify_settings header h2 { margin:0; color:var(--dsw-alias-label-primary); font-size:18px; line-height:26px; }
.dsh_notify_settings header p, .dsh_notify_hint { margin:2px 0 0; color:var(--dsw-alias-label-tertiary); font-size:13px; line-height:20px; }
.dsh_notify_group { display:flex; flex-direction:column; gap:10px; padding:14px 0; border-bottom:1px solid var(--dsw-alias-border-l2); }
.dsh_notify_group h3 { margin:0; color:var(--dsw-alias-label-primary); font-size:14px; line-height:22px; }
.dsh_notify_toggle { display:flex; align-items:flex-start; gap:10px; cursor:pointer; color:var(--dsw-alias-label-primary); }
.dsh_notify_toggle input { width:16px; height:16px; margin:3px 0 0; accent-color:var(--dsw-alias-brand-primary); }
.dsh_notify_toggle span { display:flex; flex-direction:column; min-width:0; font-size:14px; line-height:22px; }
.dsh_notify_toggle strong { font-weight:400; }
.dsh_notify_toggle small { color:var(--dsw-alias-label-tertiary); font-size:13px; line-height:19px; }
.dsh_notify_numberField { display:flex; flex-direction:column; align-items:flex-start; gap:5px; color:var(--dsw-alias-label-secondary); font-size:13px; }
.dsh_notify_numberField input { box-sizing:border-box; width:140px; height:34px; padding:0 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; outline:none; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; }
.dsh_notify_numberField input:focus { border-color:var(--dsw-alias-brand-primary); }
.dsh_notify_numberField input[aria-invalid='true'] { border-color:var(--dsw-alias-state-error-primary); }
.dsh_notify_numberField small { color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
.dsh_notify_numberField small[data-error='true'] { color:var(--dsw-alias-state-error-primary); }
.dsh_notify_permission { display:flex; align-items:center; flex-wrap:wrap; gap:8px; color:var(--dsw-alias-label-secondary); font-size:13px; }
.dsh_notify_permission b[data-permission='granted'] { color:var(--dsw-alias-state-success-primary); }
.dsh_notify_permission b[data-permission='denied'] { color:var(--dsw-alias-state-error-primary); }
.dsh_notify_permission button, .dsh_notify_segment button { height:30px; padding:0 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); cursor:pointer; }
.dsh_notify_permission button:hover, .dsh_notify_segment button:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dsh_notify_segment { display:inline-flex; align-self:flex-start; gap:4px; }
.dsh_notify_segment button[aria-pressed='true'] { border-color:var(--dsw-alias-brand-primary); background:var(--dsw-alias-interactive-bg-hover); }
.dsh_notify_outcomes { display:flex; flex-wrap:wrap; gap:10px 22px; }
.dsh_notify_toggle[data-disabled='true'] { cursor:not-allowed; opacity:.55; }
.dsh_notify_groupHeading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.dsh_notify_groupHeading > div { min-width:0; }
.dsh_notify_groupHeading > .dsh_notify_button { flex:none; white-space:nowrap; }
.dsh_notify_groupHeading p { margin:2px 0 0; color:var(--dsw-alias-label-tertiary); font-size:13px; line-height:19px; }
.dsh_notify_statusLine { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary); font-size:13px; }
.dsh_notify_statusLine > span { width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-label-tertiary); }
.dsh_notify_statusLine[data-configured='true'] > span { background:var(--dsw-alias-state-success-primary); }
.dsh_notify_fields { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; }
.dsh_notify_fields label, .dsh_notify_timeRange label { display:flex; flex-direction:column; gap:5px; min-width:0; color:var(--dsw-alias-label-secondary); font-size:12px; }
.dsh_notify_fields input, .dsh_notify_timeRange input { box-sizing:border-box; width:100%; height:34px; min-width:0; padding:0 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; outline:none; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; }
.dsh_notify_fields input:focus, .dsh_notify_timeRange input:focus { border-color:var(--dsw-alias-brand-primary); }
.dsh_notify_secretInput { position:relative; display:block; min-width:0; }
.dsh_notify_secretInput input { padding-right:38px; }
.dsh_notify_secretInput button { position:absolute; top:1px; right:1px; display:flex; align-items:center; justify-content:center; width:32px; height:32px; padding:0; border:0; border-radius:5px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; font-size:16px; line-height:1; }
.dsh_notify_secretInput button:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dsh_notify_secretInput button:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-2px; }
.dsh_notify_eyeIcon { display:block; width:18px; height:18px; fill:currentColor; }
.dsh_notify_subgroup { display:flex; flex-direction:column; gap:9px; padding-top:2px; }
.dsh_notify_subgroup > strong { color:var(--dsw-alias-label-secondary); font-size:12px; font-weight:500; }
.dsh_notify_timeRange { display:grid; grid-template-columns:minmax(0,150px) 12px minmax(0,150px); align-items:end; gap:8px; }
.dsh_notify_timeRange > span { padding-bottom:8px; color:var(--dsw-alias-label-tertiary); text-align:center; }
.dsh_notify_timeRange[data-disabled='true'] { opacity:.55; }
.dsh_notify_actions { display:flex; flex-wrap:wrap; gap:8px; }
.dsh_notify_button { min-height:32px; padding:0 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); cursor:pointer; }
.dsh_notify_button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.dsh_notify_button:disabled { cursor:not-allowed; opacity:.5; }
.dsh_notify_buttonPrimary { border-color:var(--dsw-alias-brand-primary); background:var(--dsw-alias-brand-primary); color:white; }
.dsh_notify_buttonDanger { color:var(--dsw-alias-state-error-primary); }
.dsh_notify_feedback { margin:0; font-size:13px; line-height:19px; color:var(--dsw-alias-state-success-primary); }
.dsh_notify_feedback[data-tone='error'] { color:var(--dsw-alias-state-error-primary); }
@media (max-width:600px) { .dsh_notify_groupHeading { flex-direction:column; } .dsh_notify_fields { grid-template-columns:1fr; } .dsh_notify_timeRange { grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr); } }
[data-dsh-notify-nav-bell-host] > svg:not([data-dsh-notify-nav-bell]) { display:none; }
[data-dsh-notify-nav-bell-host] > svg[data-dsh-notify-nav-bell] { display:block; width:16px; height:16px; flex:0 0 16px; }
.dsh_notify_indicatorHost { display:inline-flex !important; align-items:center; justify-content:center; flex:none; width:16px; height:20px; }
.dsh_notify_indicatorHost > [data-state] { display:none !important; }
[data-dsh-notify-indicator] { position:relative; display:inline-block; width:10px; height:10px; color:var(--dsw-alias-state-success-primary); }
[data-dsh-notify-indicator][data-tone='error'] { color:var(--dsw-alias-state-error-primary); }
[data-dsh-notify-indicator]::before, [data-dsh-notify-indicator]::after { content:''; position:absolute; border-radius:50%; background:currentColor; }
[data-dsh-notify-indicator]::before { inset:2px; }
[data-dsh-notify-indicator]::after { inset:0; opacity:.18; animation:dsh-notify-pulse 1.5s ease-out infinite; }
@keyframes dsh-notify-pulse { 0% { transform:scale(.6); opacity:.32; } 70%,100% { transform:scale(1.7); opacity:0; } }
@media (prefers-reduced-motion: reduce) { [data-dsh-notify-indicator]::after { animation:none; } }
`

export function adoptStyles(): () => void {
  document.getElementById(STYLE_ID)?.remove()
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = cssText
  document.head.appendChild(style)
  return () => { style.remove() }
}
