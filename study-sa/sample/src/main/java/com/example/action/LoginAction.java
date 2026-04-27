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
        User user = jdbcManager.from(User.class)
            .where("username = ?", username)
            .getSingleResult();

        if (user == null || !hashPassword(password).equals(user.password)) {
            errorMessage = "ユーザー名またはパスワードが正しくありません";
            return "index.jsp";
        }

        request.getSession().setAttribute("loginUser", user);
        return "redirect:/todo";
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
