import type {ElementSelection,CommentAnnotation} from './types.js';
export type AnnotationEvent={type:'selected';element:ElementSelection}|{type:'added';annotation:CommentAnnotation}|{type:'cancelled'};
export interface AnnotationAdapter {
 start():void|Promise<void>;
 stop():void|Promise<void>;
 subscribe(listener:(event:AnnotationEvent)=>void):()=>void;
}
