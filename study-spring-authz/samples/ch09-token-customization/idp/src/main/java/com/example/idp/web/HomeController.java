package com.example.idp.web;

import com.example.idp.user.UserAccountDetails;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * IdP 自身のホーム画面。ログイン中のユーザーを表示するだけの簡素なもの。
 *
 * <p>クライアントを経由せずに直接 /login でログインすると、ログイン後の飛び先 (既定は "/") が無く 404 になる。
 * その行き先として置いている。IdP のセッションが残っていることを目で確かめる用途にも使う。
 */
@Controller
class HomeController {

    @GetMapping("/")
    String home(@AuthenticationPrincipal UserAccountDetails user, Model model) {
        model.addAttribute("account", user.getAccount());
        return "home";
    }
}
