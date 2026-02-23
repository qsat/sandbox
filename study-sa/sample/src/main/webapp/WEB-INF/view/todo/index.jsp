<%@page pageEncoding="UTF-8"%>
<html>
<head><title>TODO一覧</title></head>
<body>
<h1>TODO一覧</h1>
<p>ようこそ、${sessionScope.loginUser.username} さん &nbsp;
   <a href="${pageContext.request.contextPath}/login">ログアウト</a></p>

<html:errors/>

<h2>新しいTODOを追加</h2>
<form action="${pageContext.request.contextPath}/todo/add" method="POST">
  <input type="text" name="title" size="40" placeholder="タイトルを入力">
  <input type="submit" value="追加">
</form>

<h2>一覧</h2>
<table border="1" cellpadding="5">
  <tr><th>タイトル</th><th>状態</th><th>操作</th></tr>
  <c:forEach var="todo" items="${todoAction.todos}">
    <tr>
      <td><c:out value="${todo.title}"/></td>
      <td>${todo.completed == 1 ? '完了' : '未完了'}</td>
      <td>
        <a href="${pageContext.request.contextPath}/todo/edit?todoId=${todo.id}">編集</a>
      </td>
    </tr>
  </c:forEach>
</table>
</body>
</html>
