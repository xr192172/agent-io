package com.example;

/**
 * Helper —— 被引用类（夹具：被 GreeterImpl 引用的模块符号）。
 * 含泛型方法（List&lt;String&gt;）与静态字段。
 */
public class Helper {
    /** 静态字段：被 GreeterImpl 引用（simple name） */
    public static final String PREFIX = "hello, ";

    /** 泛型方法：List&lt;String&gt; 的 String 是 type_identifier（泛型实测面） */
    public java.util.List<String> build(String name) {
        java.util.List<String> parts = new java.util.ArrayList<>();
        parts.add(PREFIX + name);
        return parts;
    }

    /** 重载方法：同名两个（methodDefs 归属 Class.method 的实测面） */
    public String format(int n) {
        return "n=" + n;
    }

    public String format(String s) {
        return "s=" + s;
    }
}
