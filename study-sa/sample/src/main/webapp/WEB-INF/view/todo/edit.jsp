<%@page pageEncoding="UTF-8"%>
<%@ taglib uri="http://java.sun.com/jsp/jstl/core" prefix="c" %>
<html>
<head><title>TODO編集</title></head>
<body>
<h1>TODO編集</h1>

<form action="${pageContext.request.contextPath}/todo/update" method="POST">
  <input type="hidden" name="todoId" value="${todoAction.editTodo.id}">
  <p>
    タイトル:
    <input type="text" name="title" size="40" value="<c:out value='${todoAction.editTodo.title}'/>">
  </p>
  <p>
    状態:
    <select name="completed">
      <option value="0" ${todoAction.editTodo.completed == 0 ? 'selected' : ''}>未完了</option>
      <option value="1" ${todoAction.editTodo.completed == 1 ? 'selected' : ''}>完了</option>
    </select>
  </p>
  <p>
    <input type="submit" value="更新">
    <a href="${pageContext.request.contextPath}/todo">キャンセル</a>
  </p>
</form>
</body>
</html>
