interface PrismDesignProps {
  /** Override agent URL (skip auto-detection from config.json) */
  agentUrl?: string;
  /** Widget position (default: "bottom-right") */
  position?: 'bottom-right' | 'bottom-left';
  /** Locale override */
  locale?: 'zh' | 'en';
}

export function PrismDesign(props: PrismDesignProps) {
  if (process.env.NODE_ENV !== 'development') return null;

  const initOpts: Record<string, string> = {};
  if (props.agentUrl) initOpts.agentUrl = props.agentUrl;
  if (props.position) initOpts.position = props.position;
  if (props.locale) initOpts.locale = props.locale;

  const hasFixedAgentUrl = !!props.agentUrl;
  const optsJson = JSON.stringify(initOpts);

  const initScript = hasFixedAgentUrl
    ? `
      window.addEventListener('DOMContentLoaded', function() {
        if (window.PrismDesignWidget && window.PrismDesignWidget.init) {
          window.PrismDesignWidget.init(${optsJson});
        }
      });
    `
    : `
      window.addEventListener('DOMContentLoaded', function() {
        fetch('/__prism-design__/config.json')
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
      });
    `;

  return (
    <>
      <script src="/__prism-design__/widget.js" defer />
      <script dangerouslySetInnerHTML={{ __html: initScript }} />
    </>
  );
}
