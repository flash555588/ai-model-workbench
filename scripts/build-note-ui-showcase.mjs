import esbuild from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writePreviewBrowserShim } from "./preview-browser-shim.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = join(root, ".tmp", "note-ui-showcase");
await mkdir(output, { recursive: true });
const shim = join(output, "obsidian-shim.js");
await writePreviewBrowserShim(shim);
const bundle = await esbuild.build({
  entryPoints: [join(root, "scripts", "visual-preview-entry.ts")],
  bundle: true,
  write: false,
  format: "iife",
  minify: true,
  target: "es2020",
  loader: { ".py": "text" },
  banner: { js: "var activeWindow = window;" },
  plugins: [{ name: "obsidian-browser-shim", setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: shim }));
  } }],
});
const styles = await readFile(join(root, "styles.css"), "utf8");
const model = (await readFile(join(root, "models", "rubiks-cube-3x3.glb"))).toString("base64");
const script = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>笔记内模型预览 · AI Model Workbench</title>
<style>
:root{--background-primary:#fafaf9;--background-secondary:#f1f1ef;--background-modifier-border:#dcdedb;--background-modifier-hover:#e9e9e7;--text-normal:#262b31;--text-muted:#656e78;--text-faint:#84909c;--text-on-accent:#fff;--interactive-accent:#7056d9;--text-error:#b52e3d;--radius-s:5px;--radius-m:9px;--font-ui-smaller:12px;--font-ui-small:13px;--font-ui-medium:14px;--button-radius:5px;color-scheme:light}
body.dark{--background-primary:#202226;--background-secondary:#282b31;--background-modifier-border:#3b3e45;--background-modifier-hover:#353840;--text-normal:#e7e8ea;--text-muted:#a5abb7;--text-faint:#858d9a;--interactive-accent:#9b83ed;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;padding:32px 24px 48px;background:var(--background-primary);color:var(--text-normal);font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}button,select,input{font:inherit}button{background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:5px;cursor:pointer;padding:5px 10px}button:hover{background:var(--background-modifier-hover)}button:focus-visible{outline:2px solid var(--interactive-accent);outline-offset:2px}button[aria-pressed=true]{border-color:var(--interactive-accent)}h1{font-size:25px;margin:8px 0 10px;font-weight:650;letter-spacing:-.4px}p{margin:8px 0 14px}.demo-heading,.demo-footer{max-width:760px;margin:0 auto}.demo-eyebrow{font-size:12px;color:var(--text-muted)}.demo-description{color:var(--text-muted);max-width:640px}.demo-options{display:flex;gap:6px;flex-wrap:wrap;margin:18px 0 24px}.demo-options .theme-toggle{margin-left:auto}.demo-footer{padding-top:18px;color:var(--text-muted);font-size:13px}#preview-shell{width:min(100%,760px);margin:0 auto}.scroll-sentinel{display:none}.preview-card{width:100%;margin:0;padding:0;--min-height:350px}.ai3d-preview-host{height:350px;min-height:0}#preview-canvas{width:100%;height:350px;display:block;background:var(--background-secondary)}.ai3d-annotation-editor{background:var(--background-primary)}@media(max-width:600px){body{padding:20px 12px}h1{font-size:22px}.demo-options .theme-toggle{margin-left:0}}
${styles}
</style>
<body><header class="demo-heading"><div class="demo-eyebrow">AI Model Workbench · 笔记内操作预览</div><h1>在笔记里查看模型，操作更有条理</h1><p class="demo-description">拖动模型旋转，滚轮缩放。试试聚焦、测量和标注点；展开“更多”查看高级检查与导出工具。</p><nav class="demo-options" aria-label="预览显示选项"><button data-width="760" aria-pressed="true">常规笔记</button><button data-width="480" aria-pressed="false">窄分栏</button><button data-width="320" aria-pressed="false">手机宽度</button><button class="theme-toggle" aria-pressed="false">切换深色</button></nav></header>
<script>window.__ai3dShowcase=${JSON.stringify({ modelBase64: model, search: "mode=readonly-pin&noteUi=1&rollout=three-readonly-glb&lang=zh-CN" })};</script>
<script>${script}</script>
<footer class="demo-footer"><p>标注点只控制已有标签的显示，不会切换到添加标注。高级工具激活后，即使收起“更多”也能继续访问；退出模式会保留已完成的测量。</p><p>此页使用项目中的真实预览组件与样式，内嵌模型资源，可离线打开。保存到仓库等操作需在 Obsidian 中使用。</p></footer>
<script>for(const button of document.querySelectorAll('[data-width]'))button.addEventListener('click',()=>{const shell=document.querySelector('#preview-shell');if(shell)shell.style.width='min(100%,'+button.dataset.width+'px)';for(const item of document.querySelectorAll('[data-width]'))item.setAttribute('aria-pressed',String(item===button));});document.querySelector('.theme-toggle').addEventListener('click',event=>{const dark=document.body.classList.toggle('dark');event.currentTarget.textContent=dark?'切换浅色':'切换深色';event.currentTarget.setAttribute('aria-pressed',String(dark));});</script>
</body></html>`;
const path = join(root, "ai-model-workbench-note-ui.html");
await writeFile(path, html);
console.log(JSON.stringify({ path, bytes: Buffer.byteLength(html), offline: true, realPreviewComponents: true }));
