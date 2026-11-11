/**
 * Java LanguagePack ①（第⑬项队列）—— 解析 + 索引的机器回归。
 *
 * 验收（lead 三条）：find_references / code_health / rename_symbols 对夹具可用。
 * 本文件钉的是**解析层事实**（analyzeModuleSource 对 .java 的产物）——上层工具（find_references 等）
 * 全部消费本层，解析层绿 = 上层有数据可消费。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeModuleSource } from '../src/infrastructure/parse/module_analysis.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'java-proj', 'src', 'com', 'example');

test('java-pack① · ①import_declaration 边：全限定路径 → source/remoteName/localName', async () => {
  const src = 'package com.example;\nimport java.util.List;\nimport static java.lang.Math.max;\nimport com.other.*;\n';
  const m = await analyzeModuleSource(src, 'T.java');
  assert.ok(m, 'Java 文件应有分析产物（不再是 null）');
  assert.equal(m.imports.length, 3, '三条 import 边');
  const list = m.imports.find((i) => i.source === 'java.util.List');
  assert.ok(list, 'List 边存在');
  assert.equal(list!.localName, 'List', 'localName = 末段');
  assert.equal(list!.remoteName, 'List', 'remoteName = 末段（Java 无别名 ⇒ 同名）');
  const statik = m.imports.find((i) => i.source === 'java.lang.Math.max');
  assert.ok(statik, 'static import 的 source = 全路径含成员名（static 导入的是**成员**，末段 max 是使用名）');
  assert.equal(statik!.localName, 'max', 'static import 的 localName = 成员名');
  const star = m.imports.find((i) => i.source === 'com.other');
  assert.ok(star?.star, '.* ⇒ star=true');
  assert.equal(star!.localName, null, 'star ⇒ localName=null');
});

test('java-pack① · ②声明与引用：class/interface 绑定 + implements 的 type_identifier + 方法调用', async () => {
  const src =
    'package com.example;\n' +
    'public interface Greeter { String greet(String name); }\n' +
    'public class Helper { public String format(String s) { return s; } }\n' +
    'public class GreeterImpl implements Greeter {\n' +
    '  private final Helper helper;\n' +
    '  public String greet(String name) { return helper.format(name); }\n' +
    '}\n';
  const m = await analyzeModuleSource(src, 'A.java');
  assert.ok(m);
  // 模块级绑定：Greeter / Helper / GreeterImpl 三个声明
  assert.ok(m.rootOffsets.has('Greeter'), 'interface 绑定');
  assert.ok(m.rootOffsets.has('Helper'), 'class 绑定');
  assert.ok(m.rootOffsets.has('GreeterImpl'), 'class 绑定');
  // implements Greeter ⇒ type_identifier 引用收进 rootRefs（Greeter 本文件已声明 ⇒ 根作用域命中）
  const greeterRefs = m.rootRefs.filter((r) => r.name === 'Greeter');
  assert.ok(greeterRefs.length >= 1, `implements Greeter 的类型引用应收（实收 ${greeterRefs.length}）`);
  // 方法调用：helper.format(name) ⇒ methodCalls（Java 分支 method_invocation{name, object}）
  const calls = m.methodCalls.filter((c) => c.method === 'format');
  assert.ok(calls.length >= 1, `成员调用应收（实收 ${calls.length}）`);
  assert.equal(calls[0]!.receiver, 'helper', 'receiver = 接收者前缀');
  // 方法归属：GreeterImpl.greet / Helper.format 进 methodDefs（Class.method 限定名）
  assert.ok(m.methodDefs.has('GreeterImpl.greet'), '方法限定名归属');
  assert.ok(m.methodDefs.has('Helper.format'), '方法限定名归属');
});

test('java-pack① · ③泛型与作用域：泛型参数位置收引用；形参不漏、不误收', async () => {
  // ★ 泛型参数的收集机制：`type_arguments` 里的 type_identifier 走通用 isRefType ⇒ 收。
  //   实测口径：泛型参数用 **import 过的类型**（`List<List<String>>` 的内层 List）——
  //   因为"符号在册"是收集的前提（宁漏不误：`String` 是 java.lang 自动导入，不经 import 语句
  //   ⇒ 根作用域无它 ⇒ 结算丢。JDK 类型不可见是**既有边界**，不是泛型机制缺口——泛型参数换成
  //   在册类型即收，实测场景 2/3 的 `List<String>` 外层 List:type 已被收为引用）。
  const src =
    'package com.example;\n' +
    'import java.util.List;\n' +
    'import java.util.ArrayList;\n' +
    'public class Holder {\n' +
    '  public List<ArrayList<String>> build(String name) {\n' +
    '    List<String> local = new ArrayList<>();\n' +
    '    return local;\n' +
    '  }\n' +
    '}\n';
  const m = await analyzeModuleSource(src, 'H.java');
  assert.ok(m);
  // 泛型参数 ArrayList（import 在册）应收为类型引用——这是"泛型参数位置收集"的证明
  const arrayListRefs = m.rootRefs.filter((r) => r.name === 'ArrayList');
  assert.ok(arrayListRefs.length >= 1 && arrayListRefs.every((r) => r.nodeType === 'type'), `泛型参数 ArrayList 应收为 type 引用（实收 ${arrayListRefs.length}）`);
  // 外层 List（返回类型泛型 + 局部变量泛型 + return）应收多条
  const listRefs = m.rootRefs.filter((r) => r.name === 'List');
  assert.ok(listRefs.length >= 2, `List 引用应收多条（返回类型 + 局部变量类型 + return；实收 ${listRefs.length}）`);
  // 形参 name 绑定到方法作用域（非根）⇒ 体内 name 引用**不算**模块引用
  const nameRefs = m.rootRefs.filter((r) => r.name === 'name');
  assert.equal(nameRefs.length, 0, `形参 name 不该进模块引用（实收 ${nameRefs.length}——收了就是误改隐患）`);
  // 局部变量 local 绑定到块作用域 ⇒ 同上不收
  const localRefs = m.rootRefs.filter((r) => r.name === 'local');
  assert.equal(localRefs.length, 0, `局部变量 local 不该进模块引用（实收 ${localRefs.length}）`);
});

test('java-pack① · ④自含文件：声明+使用同文件 ⇒ 引用收集完整（跨文件结算走索引全流程）', async () => {
  // ★ 单文件分析的"宁漏不误"边界：跨文件符号（Helper 只在别的文件声明）引用进 pendingRefs，
  //   结算要求根作用域有名字 ⇒ 单文件测试用**自含**形态（声明+使用同文件）钉收集面；
  //   跨文件场景由 import_project 建索引后的 find_references 实测（②③卡的验收路径）。
  const src =
    'package com.example;\n' +
    'public class Helper {\n' +
    '  public String format(String s) { return s; }\n' +
    '}\n' +
    'class User {\n' +
    '  void run() { Helper h = new Helper(); String x = h.format("a"); }\n' +
    '}\n';
  const m = await analyzeModuleSource(src, 'B.java');
  assert.ok(m);
  assert.ok(m.rootOffsets.has('Helper') && m.rootOffsets.has('User'), '两个类绑定');
  const helperRefs = m.rootRefs.filter((r) => r.name === 'Helper');
  assert.ok(helperRefs.length >= 2, `Helper 引用应收 ≥2（new Helper[value] + Helper h[type]；实收 ${helperRefs.length}）`);
  assert.ok(helperRefs.some((r) => r.nodeType === 'value'), 'value 面引用（new Helper）');
  assert.ok(helperRefs.some((r) => r.nodeType === 'type'), 'type 面引用（Helper h 声明）');
  assert.ok(m.methodCalls.some((c) => c.receiver === 'h' && c.method === 'format'), '方法调用 h.format');
  assert.ok(m.methodDefs.has('Helper.format') && m.methodDefs.has('User.run'), '方法归属');
  // 形参不误收（宁漏不误的反面 = 误收会改错东西）
  const paramRefs = m.rootRefs.filter((r) => r.name === 'name' || r.name === 's').length;
  assert.equal(paramRefs, 0, `形参不该进模块引用（实收 ${paramRefs}）`);
});
