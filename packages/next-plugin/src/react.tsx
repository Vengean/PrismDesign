interface PrismDesignProps {
  /** Override agent URL (skip auto-detection from config.json) */
  agentUrl?: string;
  /** Widget position (default: "bottom-right") */
  position?: 'bottom-right' | 'bottom-left';
  /** Locale override */
  locale?: 'zh' | 'en';
  /**
   * basePath of the Next.js app (e.g. "/s/my-app").
   * 不传时自动从 NEXT_PUBLIC_PATH 环境变量获取。
   */
  basePath?: string;
}

export function PrismDesign(props: PrismDesignProps) {
  const initOpts: Record<string, string> = {};
  if (props.agentUrl) initOpts.agentUrl = props.agentUrl;
  if (props.position) initOpts.position = props.position;
  if (props.locale) initOpts.locale = props.locale;

  const hasFixedAgentUrl = !!props.agentUrl;
  const optsJson = JSON.stringify(initOpts);

  // basePath 解析优先级：prop > NEXT_PUBLIC_PATH 环境变量 > __NEXT_DATA__ > 空字符串
  const resolvedBasePath = props.basePath ?? process.env.NEXT_PUBLIC_PATH ?? null;
  const bpExpr = resolvedBasePath != null
    ? `'${resolvedBasePath.replace(/\/+$/, '')}'`
    : `((window.__NEXT_DATA__ && window.__NEXT_DATA__.basePath) || '')`;

  // 加载 widget.js 并在 onload 后立即初始化，不依赖 DOMContentLoaded
  const script = hasFixedAgentUrl
    ? `
    (function() {
      var bp = ${bpExpr};

      function doInit() {
        if (window.PrismDesignWidget && window.PrismDesignWidget.init) {
          window.PrismDesignWidget.init(${optsJson});
        }
      }

      if (window.PrismDesignWidget) { doInit(); return; }
      var s = document.createElement('script');
      s.src = bp + '/__prism-design__/widget.js';
      s.onload = doInit;
      document.head.appendChild(s);
    })();
  `
    : `
    (function() {
      var bp = ${bpExpr};

      function doInit() {
        fetch(bp + '/__prism-design__/config.json')
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(config) {
            var opts = ${optsJson};
            if (config && config.agentPort) {
              opts.agentUrl = 'http://' + location.hostname + ':' + config.agentPort;
            } else if (config && config.agentUrl) {
              opts.agentUrl = config.agentUrl;
            }
            if (window.PrismDesignWidget && window.PrismDesignWidget.init) {
              window.PrismDesignWidget.init(opts);
            }
          })
          .catch(function() {
            if (window.PrismDesignWidget && window.PrismDesignWidget.init) {
              window.PrismDesignWidget.init(${optsJson});
            }
          });
      }

      if (window.PrismDesignWidget) { doInit(); return; }
      var s = document.createElement('script');
      s.src = bp + '/__prism-design__/widget.js';
      s.onload = doInit;
      document.head.appendChild(s);
    })();
  `;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
