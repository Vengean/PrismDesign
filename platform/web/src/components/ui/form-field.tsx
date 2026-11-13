import {isValidElement,type ReactNode} from 'react';

export function FormField({label,hint,children}:{label:string;hint?:string;children:ReactNode}){
 const required=isValidElement<{required?:boolean}>(children)&&children.props.required;
 return <label className="form-field"><span className="form-field-label">{label}{required&&<><span aria-hidden="true" className="ml-1 text-destructive">*</span><span className="sr-only">（必填）</span></>}</span>{children}{hint&&<span className="form-field-hint">{hint}</span>}</label>;
}
