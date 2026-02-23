package com.example.action;

import java.util.List;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;

import org.seasar.extension.jdbc.JdbcManager;
import org.seasar.struts.annotation.Execute;
import org.seasar.struts.annotation.Required;

import com.example.entity.Todo;
import com.example.entity.User;

public class TodoAction {

    // フォーム入力
    @Required
    public String title;

    public Long todoId;
    public Integer completed;

    // ビュー向けデータ
    public List<Todo> todos;
    public Todo editTodo;

    @Resource
    protected HttpServletRequest request;

    @Resource
    protected JdbcManager jdbcManager;

    // EL式からのアクセス用 getter（S2AOPプロキシ対策）
    public String getTitle()        { return title; }
    public Long getTodoId()         { return todoId; }
    public Integer getCompleted()   { return completed; }
    public List<Todo> getTodos()    { return todos; }
    public Todo getEditTodo()       { return editTodo; }

    private User getLoginUser() {
        return (User) request.getSession().getAttribute("loginUser");
    }

    @Execute(validator = false)
    public String index() {
        User loginUser = getLoginUser();
        if (loginUser == null) {
            return "redirect:/login";
        }
        todos = jdbcManager.from(Todo.class)
            .where("user_id = ?", loginUser.id)
            .orderBy("created_at DESC")
            .getResultList();
        return "index.jsp";
    }

    @Execute(validator = true, input = "index.jsp")
    public String add() {
        User loginUser = getLoginUser();
        if (loginUser == null) {
            return "redirect:/login";
        }

        // TODO(human): Todoを新規保存してリダイレクトしてください
        // ヒント:
        //   1. new Todo() でエンティティを生成
        //   2. todo.title = title; と todo.userId = loginUser.id; をセット
        //   3. jdbcManager.insert(todo).execute() で保存
        //   4. return "redirect:/todo" でPRGパターンの完成
        return "redirect:/todo";
    }

    @Execute(validator = false)
    public String edit() {
        User loginUser = getLoginUser();
        if (loginUser == null) {
            return "redirect:/login";
        }
        editTodo = jdbcManager.from(Todo.class)
            .where("id = ? AND user_id = ?", todoId, loginUser.id)
            .getSingleResult();
        return "edit.jsp";
    }

    @Execute(validator = false)
    public String update() {
        User loginUser = getLoginUser();
        if (loginUser == null) {
            return "redirect:/login";
        }
        Todo todo = jdbcManager.from(Todo.class)
            .where("id = ? AND user_id = ?", todoId, loginUser.id)
            .getSingleResult();
        todo.title = title;
        todo.completed = (completed != null) ? completed : 0;
        jdbcManager.update(todo).execute();
        return "redirect:/todo";
    }
}
