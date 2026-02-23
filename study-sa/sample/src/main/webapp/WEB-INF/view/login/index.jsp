<%@page pageEncoding="UTF-8"%>
<html>
<head><title>ログイン</title></head>
<body>
<h1>ログイン</h1>

<html:errors/>
<c:if test="${not empty loginAction.errorMessage}">
  <p style="color:red">${loginAction.errorMessage}</p>
</c:if>

<form action="${pageContext.request.contextPath}/login/submit" method="POST">
  <p>
    ユーザー名: <input type="text" name="username" value="${loginAction.username}">
  </p>
  <p>
    パスワード: <input type="password" name="password">
  </p>
  <p><input type="submit" value="ログイン"></p>
</form>

<p><a href="${pageContext.request.contextPath}/register">新規登録はこちら</a></p>
</body>
</html>
