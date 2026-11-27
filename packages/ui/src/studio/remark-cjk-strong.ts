type Node={type:string;value?:string;children?:Node[];position?:{start:{offset?:number};end:{offset?:number}}};
type Range={start:number;end:number};
const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const punctuation=/[\p{P}\p{S}]/u;
const word=(char:string|undefined)=>!!char&&!/\s/u.test(char)&&!punctuation.test(char);
const content=(node:Node):string=>node.value??node.children?.map(content).join('')??'';

// CJK prose often places **「labels」** immediately next to ordinary text.
// Relax those punctuation boundaries with invisible non-punctuation sentinels,
// then let the existing Markdown parser handle all nesting. Sentinels are
// removed from the resulting AST; original message text is never changed.
export function remarkCjkStrong(this:{parse:(value:string)=>Node}){
 const processor=this;
 return(tree:Node,file:{value:unknown})=>{
  const source=String(file.value),targets:Range[]=[],protectedRanges:Range[]=[];
  function collect(node:Node){
   const start=node.position?.start.offset,end=node.position?.end.offset;
   if(['code','inlineCode','html','link','linkReference','image','imageReference','definition'].includes(node.type)){
    if(start!==undefined&&end!==undefined)protectedRanges.push({start,end});return;
   }
   if(['paragraph','heading','tableCell'].includes(node.type)&&cjk.test(content(node))&&start!==undefined&&end!==undefined)targets.push({start,end});
   node.children?.forEach(collect);
  }
  collect(tree);if(!targets.length)return;
  targets.sort((a,b)=>a.start-b.start);protectedRanges.sort((a,b)=>a.start-b.start);
  const insertions=new Set<number>();let target=0,protectedIndex=0;
  for(let i=0;i<source.length-1;i++){
   if(source.slice(i,i+2)!=='**'||source[i-1]==='*'||source[i+2]==='*')continue;
   while(target<targets.length&&targets[target].end<=i)target++;
   if(!targets[target]||i<targets[target].start)continue;
   while(protectedIndex<protectedRanges.length&&protectedRanges[protectedIndex].end<=i)protectedIndex++;
   if(protectedRanges[protectedIndex]&&protectedRanges[protectedIndex].start<=i)continue;
   let backslashes=0;for(let j=i-1;j>=0&&source[j]==='\\';j--)backslashes++;
   if(backslashes%2)continue;
   const before=source[i-1],after=source[i+2];
   if(before&&punctuation.test(before)&&word(after))insertions.add(i);
   if(after&&punctuation.test(after)&&word(before))insertions.add(i+2);
   i++;
  }
  if(!insertions.size)return;
  let sentinel='\u2060';while(source.includes(sentinel))sentinel+='\u2060';
  let modified='',previous=0;for(const offset of [...insertions].sort((a,b)=>a-b)){modified+=source.slice(previous,offset)+sentinel;previous=offset;}modified+=source.slice(previous);
  const parsed=processor.parse(modified);
  function clean(node:Node){
   if(node.type==='text'&&node.value)node.value=node.value.split(sentinel).join('');
   // The second parse used virtual offsets; don't expose misleading positions.
   delete node.position;node.children?.forEach(clean);
   if(node.children)node.children=node.children.filter(child=>child.type!=='text'||child.value!=='');
  }
  clean(parsed);tree.children=parsed.children;
 };
}
