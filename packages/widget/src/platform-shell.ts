// Only window/FAB geometry lives here; all chat styling comes from shared UI.
export const PLATFORM_SHELL_CSS=`
:host{all:initial;position:fixed!important;inset:auto!important;left:var(--prism-viewport-left,0px)!important;top:var(--prism-viewport-top,0px)!important;width:var(--prism-viewport-width,100vw)!important;height:var(--prism-viewport-height,100dvh)!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;box-sizing:border-box!important;transform:none!important;display:block!important;overflow:visible!important;background:transparent!important;pointer-events:none!important;z-index:2147483647!important;font:14px/1.5 var(--font-sans);color:var(--foreground);--tw-border-style:solid}
:host::backdrop{background:transparent;pointer-events:none}
.prism-container{pointer-events:auto;box-sizing:border-box;position:absolute;bottom:24px;right:24px;z-index:2147483647;overflow:hidden;border:1px solid var(--border);background:var(--background);box-shadow:0 8px 32px #0002;width:400px;max-width:calc(100% - 32px);height:min(640px,calc(100% - 72px));border-radius:12px}
.prism-container.bottom-left{right:auto;left:24px}
.prism-container.collapsed{width:48px;height:48px;border-radius:50%}
.prism-panel-inner,.prism-studio-root{display:flex;flex-direction:column;height:100%;min-height:0}
.prism-container.collapsed .prism-panel-inner{display:none}
.prism-fab{display:flex;align-items:center;justify-content:center;border:0;background:var(--background);color:var(--foreground);cursor:pointer;padding:0}
.prism-fab{position:absolute;inset:0;width:100%;height:100%}
.prism-container.expanded .prism-fab{display:none}
.prism-backdrop,.prism-header,.prism-drag-handle{display:none}
:host(.prism-platform-picking) .prism-container,:host(.prism-platform-picking) .prism-backdrop{visibility:hidden}
 :host(.prism-mobile) .prism-backdrop.open{pointer-events:auto;display:block;position:absolute;inset:0;z-index:2147483646;background:#0006;touch-action:none}
 :host(.prism-mobile) .prism-container{box-sizing:border-box;overscroll-behavior:contain}
 :host(.prism-mobile) .prism-container textarea{font-size:16px}
 :host(.prism-mobile) .prism-container [class*="overflow-y-auto"]{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
 :host(.prism-mobile) .prism-container.collapsed{display:block;bottom:calc(16px + env(safe-area-inset-bottom,0px));right:calc(16px + env(safe-area-inset-right,0px));left:auto}
 :host(.prism-mobile) .prism-container.collapsed.bottom-left{right:auto;left:calc(16px + env(safe-area-inset-left,0px))}
 :host(.prism-mobile) .prism-container.expanded{bottom:0;right:0;left:0;width:100%;max-width:100%;height:min(85%,720px);padding-bottom:env(safe-area-inset-bottom,0px);border-radius:16px 16px 0 0}
 :host(.prism-mobile) .prism-drag-handle{display:block;width:32px;height:4px;flex-shrink:0;border-radius:4px;background:var(--divider);margin:6px auto 2px}
`;
