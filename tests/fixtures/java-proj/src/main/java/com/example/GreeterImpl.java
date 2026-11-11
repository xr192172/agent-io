package com.example;

import java.util.List;

/**
 * GreeterImpl —— 实现类（夹具核心：implements 接口 + 引用 Helper + 跨文件类型引用）。
 * 引用面：Greeter（implements，type_identifier）/ Helper（字段类型 + 构造 + 方法调用）/ List（JDK 泛型）。
 */
public class GreeterImpl implements Greeter {
    /** 字段：Helper 类型引用（type_identifier，跨文件） */
    private final Helper helper;

    public GreeterImpl() {
        // 构造调用：Helper 的 identifier 引用（value 面）
        this.helper = new Helper();
    }

    @Override
    public String greet(String name) {
        // 方法调用：helper.format(name) —— methodCalls 收集面（receiver=helper, method=format）
        String formatted = helper.format(name);
        List<String> parts = helper.build(name);
        // 静态字段引用：Helper.PREFIX —— simple name 收集面
        return Helper.PREFIX + formatted + " (" + parts.size() + ")";
    }
}
