package com.foo;

/**
 * ★ G10 ③ 嵌套子项目夹具测试：路径
 *   `tests/fixtures/java-multi/modules/foo/src/test/java/com/foo/FooNestedTest.java`
 *   ⇒ FQCN `com.foo.FooNestedTest`（剥 subRoot 之上的 `tests/fixtures/java-multi/modules/foo/` 前缀）。
 */
public class FooNestedTest {

  @org.junit.jupiter.api.Test
  void addTwoAndTwo() {
    org.junit.jupiter.api.Assertions.assertEquals(4, new Foo().add(2, 2));
  }
}
