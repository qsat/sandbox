<%@page pageEncoding="UTF-8"%>
<html>
<head><title>新規登録</title></head>
<body>
<h1>新規ユーザー登録</h1>

<html:errors/>
<c:if test="${not empty registerAction.errorMessage}">
  <p style="color:red">${registerAction.errorMessage}</p>
</c:if>

<form action="${pageContext.request.contextPath}/register/submit" method="POST">
  <p>
    ユーザー名: <input type="text" name="username" value="${registerAction.username}">
  </p>
  <p>
    パスワード（4文字以上）: <input type="password" name="password">
  </p>
  <p><input type="submit" value="登録"></p>
</form>

<p><a href="${pageContext.request.contextPath}/login">ログインはこちら</a></p>
</body>
</html>
