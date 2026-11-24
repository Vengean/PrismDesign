/** Apply the platform's model proxy only inside the Agent process. */
export function applyModelProxy(env:NodeJS.ProcessEnv=process.env){
 const proxy=env.PRISM_MODEL_PROXY_URL;
 if(!proxy)return;
 for(const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])env[key]=proxy;
 const bypass=new Set(['localhost','127.0.0.1','::1',...(env.NO_PROXY||'').split(','),...(env.no_proxy||'').split(',')].filter(Boolean));
 env.NO_PROXY=env.no_proxy=[...bypass].join(',');
}
