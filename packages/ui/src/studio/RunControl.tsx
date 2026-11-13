import React from 'react';

export function RunControl({canStop=false,onStop,disabled=false,className=''}:{canStop?:boolean;onStop?:()=>void;disabled?:boolean;className?:string}){
 const icon=<><svg data-run-spinner aria-hidden="true" viewBox="0 0 24 24" fill="none" className="absolute h-5 w-5 animate-spin"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.2"/><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>{canStop&&<span data-stop-square aria-hidden="true" className="h-1.5 w-1.5 rounded-[1px] bg-current"/>}</>;
 const classes=`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-primary ${className}`;
 return canStop?<button data-run-control type="button" aria-label="取消运行" title="取消运行" disabled={disabled} onClick={onStop} className={`${classes} transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50`}>{icon}</button>:<span data-run-control role="status" aria-label="正在处理" className={classes}>{icon}</span>;
}
