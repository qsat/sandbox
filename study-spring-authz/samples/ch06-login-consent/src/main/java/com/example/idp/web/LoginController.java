package com.example.idp.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 自前のログイン画面を返す。認証の処理そのもの (POST /login) は Spring Security のフィルターが行う。
 * このコントローラーは GET /login で HTML を返すだけ。
 */
@Controller
class LoginController {

    @GetMapping("/login")
    String login() {
        return "login";
    }
}
