package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * GreeterImplTest —— 夹具测试（Maven surefire 形态：src/test/java + JUnit5）。
 * 两个绿测（greet / shout 走 GreeterImpl + Helper 真实现）。
 */
public class GreeterImplTest {
    @Test
    public void greetGreetsWithName() {
        Greeter g = new GreeterImpl();
        // greet = Helper.PREFIX("hello, ") + helper.format("world")("s=world") + " (" + parts.size()(1) + ")"
        assertEquals("hello, s=world (1)", g.greet("world"));
    }

    @Test
    public void shoutUppercases() {
        Greeter g = new GreeterImpl();
        assertEquals("HELLO, S=WORLD (1)", g.shout("world"));
    }
}
