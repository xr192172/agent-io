package com.example;

import java.util.List;

/**
 * GreeterMapper —— MyBatis mapper 接口夹具（第⑬项任务 A 调整形态）。
 * 两方法与 GreeterMapper.xml 的 id 对应 ⇒ Mapper↔XML 一致性契约的接口侧。
 * ★ 符号索引面：interface 声明 + 方法声明（Java ① 的 module_analysis 已覆盖）⇒
 *   一致性契约的接口侧数据从符号索引来（静态面）；反射是运行时校验（互补）。
 */
public interface GreeterMapper {
    /** 对应 XML id=findByName（#{} 参数化，正例） */
    List<String> findByName(String name);

    /** 对应 XML id=findByNameUnsafe（${} 拼接，注入面反例——接口侧仍声明，XML 侧契约红） */
    List<String> findByNameUnsafe(String name);
}
