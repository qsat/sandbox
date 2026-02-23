package com.example.action;

import javax.annotation.Resource;

import org.seasar.extension.jdbc.JdbcManager;
import org.seasar.struts.annotation.Execute;
import org.seasar.struts.annotation.Minlength;
import org.seasar.struts.annotation.Required;

import com.example.entity.User;

public class RegisterAction {

    @Required
    public String username;

    @Required
    @Minlength(minlength = 4)
    public String password;

    public String errorMessage;

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
        long count = jdbcManager.from(User.class)
            .where("username = ?", username)
            .getCount();
        if (count > 0) {
            errorMessage = "そのユーザー名は既に使われています";
            return "index.jsp";
        }

        User user = new User();
        user.username = username;
        user.password = hashPassword(password);
        jdbcManager.insert(user).execute();

        return "redirect:/login";
    }

    private String hashPassword(String rawPassword) {
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
