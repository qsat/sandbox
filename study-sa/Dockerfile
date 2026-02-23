FROM tomcat:8.5.78-jdk8-corretto

# デフォルトのwebappsを削除（不要なアプリを除去）
RUN rm -rf /usr/local/tomcat/webapps/*

# コンテナ起動時にwebappsディレクトリをマウントポイントとして使用
# WARはdocker-compose.ymlのvolumeで提供する
EXPOSE 8080

CMD ["catalina.sh", "run"]
