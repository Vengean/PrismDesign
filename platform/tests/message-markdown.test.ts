import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {MessageMarkdown} from '../../packages/ui/src/studio/MessageMarkdown.js';
const require=createRequire(new URL('../../packages/ui/package.json',import.meta.url));
const {createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const render=(content:string)=>renderToStaticMarkup(createElement(MessageMarkdown,{content}));
test('CJK emphasis recognizes punctuation next to Chinese without changing the message text',()=>{
 assert.equal(render('已撤回**多团队时禁用「客户经理 UM」**的限制'),'<p>已撤回<strong>多团队时禁用「客户经理 UM」</strong>的限制</p>');
 assert.equal(render('已撤回**「客户经理 UM」**的限制'),'<p>已撤回<strong>「客户经理 UM」</strong>的限制</p>');
 assert.equal(render('调整**`客户经理 UM`**的限制'),'<p>调整<strong><code>客户经理 UM</code></strong>的限制</p>');
 assert.equal(render('**「客户」**与**「团队」**保持一致'),'<p><strong>「客户」</strong>与<strong>「团队」</strong>保持一致</p>');
 assert.match(render('| 说明 |\n| --- |\n| 已撤回**「UM」**的限制 |'),/<td>已撤回<strong>「UM」<\/strong>的限制<\/td>/);
 assert.equal(render('调整**[客户](https://example.com)**的限制'),'<p>调整<strong><a href="https://example.com">客户</a></strong>的限制</p>');
});
test('escaped markers, code blocks, unmatched delimiters and ordinary Markdown retain their meaning',()=>{
 assert.equal(render('`已撤回**「UM」**的限制`'),'<p><code>已撤回**「UM」**的限制</code></p>');
 assert.match(render('```text\n已撤回**「UM」**的限制\n```'),/<code class="language-text">已撤回\*\*「UM」\*\*的限制/);
 assert.equal(render(String.raw`已撤回\*\*「UM」\*\*的限制`),'<p>已撤回**「UM」**的限制</p>');
 assert.equal(render(String.raw`\*\*字面量\*\*；已撤回**「UM」**的限制`),'<p>**字面量**；已撤回<strong>「UM」</strong>的限制</p>');
 assert.equal(render('未结束**「UM」'),'<p>未结束**「UM」</p>');
 assert.equal(render('中文** 留有空格 **内容'),'<p>中文** 留有空格 **内容</p>');
 assert.equal(render('**bold** and *italic* and ~~deleted~~'),'<p><strong>bold</strong> and <em>italic</em> and <del>deleted</del></p>');
 assert.equal(render('**「客户」**\n\n**「团队」**'),'<p><strong>「客户」</strong></p>\n<p><strong>「团队」</strong></p>');
 assert.equal(render('&#42;&#42;「UM」&#42;&#42;的限制'),'<p>**「UM」**的限制</p>');
 assert.equal(render('中文 [地址](https://example.com/**asset**) 与**「客户」**的限制'),'<p>中文 <a href="https://example.com/**asset**">地址</a> 与<strong>「客户」</strong>的限制</p>');
 const mention=renderToStaticMarkup(createElement(MessageMarkdown,{content:'已撤回**「UM」**的限制，@alice 请确认。',mentions:'["alice"]',currentUserId:'alice'}));
 assert.match(mention,/<strong>「UM」<\/strong>/);assert.match(mention,/data-mention-user="alice"/);assert.ok(!mention.includes('\u2060'));
 assert.equal(render('原有\u2060字符，已撤回**「UM」**的限制'),'<p>原有\u2060字符，已撤回<strong>「UM」</strong>的限制</p>');
});
