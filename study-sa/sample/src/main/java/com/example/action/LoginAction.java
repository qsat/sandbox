package com.example.action;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;

import org.seasar.extension.jdbc.JdbcManager;
import org.seasar.struts.annotation.Execute;
import org.seasar.struts.annotation.Required;

import com.example.entity.User;

public class LoginAction {

    @Required
    public String username;

    @Required
    public String password;

    public String errorMessage;

    @Resource
    protected HttpServletRequest request;

    @Resource
    protected JdbcManager jdbcManager;

    // EL式からのアクセス用 getter（S2AOPプロキシ対策）
    public String getUsername()     { return username; }
    public String getErrorMessage() { return errorMessage; }

    @Execute(validator = false)
    public String index() {
        return "index.jsp";
    }

    @Execute(validator = true, input = "index.jsp")
    public String submit() {
        // TODO(human): ログイン認証ロジックを実装してください
        // ヒント:
        //   1. jdbcManager.from(User.class).where("username = ?", username).getSingleResult() でユーザー検索
        //   2. hashPassword(password) でハッシュ化してDBのpasswordと比較
        //   3. 認証成功: request.getSession().setAttribute("loginUser", user) → return "redirect:/todo"
        //   4. 認証失敗: errorMessage をセット → return "index.jsp"
        //   (ユーザーが見つからない場合はgetSingleResult()がnullを返す)
        return "index.jsp";
    }

    public static String hashPassword(String rawPassword) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(rawPassword.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
