#!/usr/bin/env node
// 构建期补丁：把农场小程序 OpenAuth 扩展注入官方 NapCat.Shell 的 napcat.mjs。
//
// napcat.mjs 是压缩产物，基类名/枚举名/schema 别名每次发版都会变（例如 le / re / p），
// 所以这里不写死任何混淆标识符，全部从文件里动态推导，再把模板里的占位符替换掉。
// 任一推导失败即退出 1，让构建当场失败，而不是产出一个静默缺少授权能力的镜像。
//
// 注入内容（3 处，纯新增/补参，不删原逻辑）：
//   1. bootMiniApp -> startNewMiniApp(a, b) 补第三个参数 ""
//   2. action 名称枚举新增 StartMiniApp1112386029
//   3. action 注册数组头部插入「命名类表达式」实例（模板见 farm-miniapp-action.js）
//
// 踩过的坑：类必须以 `new (class ... {})(a, b),` 表达式形式插在数组元素位置。
// 早期版本把 class 声明插到注册数组第一个元素之前，等于把声明塞进了数组字面量，
// napcat.mjs 直接 SyntaxError，NapCat 静默不加载 —— 表象是「二维码永远生成超时」，
// 日志里只有一行 UnhandledPromiseRejectionWarning，极难定位。
// 文件末尾的 node --check 就是为这个坑加的护栏。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const target = process.argv[2];
if (!target) {
  console.error('usage: apply-farm-patch.mjs <path-to-napcat.mjs>');
  process.exit(1);
}

const CLASS_NAME = 'FarmMiniAppAuthAction';
const ACTION_KEY = 'StartMiniApp1112386029';
const ACTION_VALUE = 'start_mini_app_1112386029';
const ENUM_ANCHOR = 'GetMiniAppArk: "get_mini_app_ark",';

const patchDir = path.dirname(new URL(import.meta.url).pathname);
const template = fs.readFileSync(path.join(patchDir, 'farm-miniapp-action.js'), 'utf8').replace(/\s+$/, '');

let src = fs.readFileSync(target, 'utf8');

if (src.includes(ACTION_VALUE)) {
  console.log('[napcat-patch] already patched, skip');
  process.exit(0);
}

const fail = (msg) => {
  console.error(`[napcat-patch] ${msg} — NapCat upstream changed, refusing to build`);
  process.exit(1);
};

// ---- 1. 推导 typebox schema 别名：取 `X.Object({` 出现次数最多的 X ----
const schemaTally = new Map();
for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.Object\(\{/g)) {
  schemaTally.set(m[1], (schemaTally.get(m[1]) || 0) + 1);
}
const schemaAlias = [...schemaTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
if (!schemaAlias) fail('cannot resolve schema builder alias');

// ---- 2. 推导 action 名称枚举对象名：从 GetMiniAppArk 往前找最近的声明 ----
const enumAnchorIdx = src.indexOf(ENUM_ANCHOR);
if (enumAnchorIdx < 0) fail(`enum anchor "${ENUM_ANCHOR}" not found`);
const declMatches = [...src.slice(0, enumAnchorIdx).matchAll(/(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)];
const actionsEnum = declMatches.length ? declMatches[declMatches.length - 1][1] : '';
if (!actionsEnum) fail('cannot resolve action-name enum object');

// ---- 3. 推导 action 基类名：找 `class X extends BASE { actionName = <enum>.` ----
const baseRe = new RegExp(`class\\s+[A-Za-z_$][\\w$]*\\s+extends\\s+([A-Za-z_$][\\w$]*)\\s*\\{[\\s\\S]{0,200}?actionName\\s*=\\s*${actionsEnum}\\.`);
const baseClass = src.match(baseRe)?.[1];
if (!baseClass) fail('cannot resolve OneBot action base class');

// ---- 4. 推导注册数组：连续两行 `new X(a, b),` ----
const regRe = /new\s+[A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*),\s*([A-Za-z_$][\w$]*)\),\s*\n(\s*)new\s+[A-Za-z_$][\w$]*\(\1,\s*\2\),/;
const regMatch = src.match(regRe);
if (!regMatch) fail('cannot resolve action registration list');
const [regArgA, regArgB, regIndent] = [regMatch[1], regMatch[2], regMatch[3]];

// ---- 5. bootMiniApp 补第三参 ----
const bootRe = /(setMiniAppVersion\("2\.16\.4"\),\s*this\.context\.session\.getNodeMiscService\(\)\.startNewMiniApp\(([A-Za-z_$][\w$]*),\s*([A-Za-z_$][\w$]*))\)/;
const bootMatch = src.match(bootRe);
if (!bootMatch) fail('cannot resolve bootMiniApp startNewMiniApp call');

console.log(`[napcat-patch] resolved schema=${schemaAlias} enum=${actionsEnum} base=${baseClass} regArgs=(${regArgA}, ${regArgB})`);

const actionSource = template
  .replace(/__SCHEMA__/g, schemaAlias)
  .replace(/__ACTIONS__/g, actionsEnum)
  .replace(/__BASE__/g, baseClass)
  .replace(/__CLASS__/g, CLASS_NAME);
if (/__[A-Z]+__/.test(actionSource)) fail('unsubstituted placeholder left in action template');

// 类定义 + 注册项一体插入：`new (class ... {})(a, b),` 是合法的数组元素，
// 因此不需要在压缩代码里寻找顶层作用域插入点。
const inlineAction = `new (\n${actionSource}\n${regIndent})(${regArgA}, ${regArgB}),`;

const regIdx = src.indexOf(regMatch[0]);
if (regIdx < 0) fail('registration list vanished before injection');
let patched = src.slice(0, regIdx)
  + `${inlineAction}\n${regIndent}`
  + src.slice(regIdx);

// enum 项
if (patched.split(ENUM_ANCHOR).length - 1 !== 1) fail('enum anchor is not unique');
patched = patched.replace(ENUM_ANCHOR, `${ENUM_ANCHOR}\n  ${ACTION_KEY}: "${ACTION_VALUE}",`);

// bootMiniApp 补参
if (patched.split(bootMatch[0]).length - 1 !== 1) fail('bootMiniApp anchor is not unique');
patched = patched.replace(bootMatch[0], `${bootMatch[1]}, "")`);

fs.writeFileSync(target, patched);

// 自检：注入后的文件必须能找到 action 名 / 类名 / 注册项
const checks = [
  [ACTION_VALUE, 'action value missing'],
  [`class ${CLASS_NAME} extends ${baseClass}`, 'action class missing'],
  [inlineAction, 'action registration missing'],
];
for (const [needle, msg] of checks) {
  if (!patched.includes(needle)) fail(`self-check failed: ${msg}`);
}

// 语法护栏：解析失败就地失败，别把静默坏掉的 napcat.mjs 打进镜像
try {
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
} catch (error) {
  console.error(String(error.stderr || error.stdout || error.message));
  fail('self-check failed: patched napcat.mjs does not parse');
}
console.log(`[napcat-patch] applied farm OpenAuth action to ${target}`);
