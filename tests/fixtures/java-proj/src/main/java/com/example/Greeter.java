package com.example;

/**
 * Greeter —— 问候接口（夹具：interface 声明 + 方法签名）。
 * 被 GreeterImpl implements；调用方通过接口类型引用（type_identifier）。
 */
public interface Greeter {
    /** 构造问候语（含 String 泛型参数的返回类型） */
    String greet(String name);

    /** 默认方法：Java 8 接口体（方法声明含体，作用域栈要接住） */
    default String shout(String name) {
        return greet(name).toUpperCase();
    }
}
