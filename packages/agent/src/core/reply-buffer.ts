// Only the final assistant message belongs in the completed chat reply.
// Text emitted before another tool call is a transient progress update.
export class ReplyBuffer {
 private parts:string[]=[];
 clear(){this.parts=[];}
 append(text:string){this.parts.push(text);}
 final(explicitResult?:string){return explicitResult?.trim()?explicitResult:this.parts.join('').trim();}
}
